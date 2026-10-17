/**
 * A bucket's changes, delivered — the `s3` provider's half of object events.
 *
 * S3 can tell only AWS services that an object changed, so for each bucket a
 * subscriber watches the deploy creates, in the stage's account:
 *
 * - **a topic**, `<bucket>-events`, that only this bucket may publish to;
 * - **a dead-letter queue**, `<bucket>-events-dlq`, for what SNS gives up
 *   delivering — an outage longer than its retries would otherwise lose
 *   uploads;
 * - **the bucket's notification entry**, `gkm-<id>`, sending every create and
 *   delete to the topic — merged in, so an entry somebody added by hand stays;
 * - **the events key**, `<ID>_EVENTS_CONNECTION_STRING`, signed by the
 *   bucket's own access key, whose policy gains `sns:ConfirmSubscription` on
 *   this one topic and nothing more;
 * - **one HTTP subscription per subscriber**, to its route on its worker's
 *   host. The deploy owns these — the worker cannot subscribe — and records
 *   each ARN for the worker to accept deliveries under.
 *
 * Nothing is deleted except a subscription to the worker's own host that no
 * subscriber wants any more.
 */

import type {
	ConstructManifest,
	ObjectsDeclaration,
} from '@geekmidas/manifest';
import { provideKey } from '@geekmidas/manifest';
import * as s3Url from '@geekmidas/storage/s3-url';
import {
	subscriptionKey,
	subscriptionResource,
} from '../../deploy/snsSubscriptions.js';
import { GkmError } from '../../errors';
import { subscriberRoute } from '../../generators/subscriberRoute.js';
import type { BoundSubscriber } from '../../reconcile/discover.js';
import { eventsEdge } from '../../reconcile/edges.js';
import { NoDomainForStage } from '../../target/dokploy/domain.js';
import { appKey } from '../../workspace/derive.js';
import type { S3ObjectsConfig } from '../../workspace/types.js';
import { type AwsProvisioning, awsClientConfig, awsEndpoint } from '../aws.js';
import { deploysWithCompose } from '../dns.js';
import { identityTags } from '../iam.js';
import type { EnsureContext } from '../types.js';
import { canonicalPolicy, type PolicyDocument } from './policy.js';

type Ctx = EnsureContext<S3ObjectsConfig, AwsProvisioning>;
type SnsModule = typeof import('@aws-sdk/client-sns');
type SqsModule = typeof import('@aws-sdk/client-sqs');
type S3Module = typeof import('@aws-sdk/client-s3');

/** What S3 tells the topic about: every object written, and every removed. */
export const BUCKET_EVENTS = ['s3:ObjectCreated:*', 's3:ObjectRemoved:*'];

/** One subscriber watching a bucket: the worker that runs it, and its export. */
export interface BucketWatcher {
	worker: string;
	name: string;
}

/**
 * Each bucket a subscriber watches, with the subscribers discovery could name.
 *
 * A bucket is watched when a process consumes its events — discovery records
 * the edge, and the subscriber by its export — or when a build put a
 * subscriber in its declaration. Only a named subscriber can be subscribed: a
 * route is named after its export.
 */
export function bucketWatchers(
	manifest: ConstructManifest,
	runnables: Readonly<Record<string, readonly string[]>>,
	subscribers: Readonly<Record<string, readonly BoundSubscriber[]>> = {},
): Map<string, BucketWatcher[]> {
	const watched = new Map<string, BucketWatcher[]>();
	for (const [id, declaration] of Object.entries(manifest)) {
		if (declaration.kind !== 'objects') continue;
		const key = provideKey(id, 'eventsConnectionString');
		const named = Object.entries(subscribers)
			.flatMap(([worker, bound]) =>
				bound
					.filter((s) => s.connectionKey === key)
					.map((s) => ({ worker, name: s.name })),
			)
			.sort((a, b) =>
				`${a.worker}/${a.name}`.localeCompare(`${b.worker}/${b.name}`),
			);
		const edged = Object.values(runnables).some((edges) =>
			edges.includes(eventsEdge(id)),
		);
		const declared =
			((declaration as ObjectsDeclaration).subscribers?.length ?? 0) > 0;
		if (named.length > 0 || edged || declared) watched.set(id, named);
	}
	return watched;
}

/** The topic a bucket's changes are published to. */
export function eventsTopicName(bucket: string): string {
	// A bucket name may hold dots; a topic or queue name may not.
	return `${bucket.replaceAll('.', '-')}-events`;
}

/** What SNS gives up delivering, kept. */
export function eventsDeadLetterName(bucket: string): string {
	return `${eventsTopicName(bucket)}-dlq`;
}

/** Only this bucket, in this account, may publish to its topic. */
export function eventsTopicPolicy(
	topicArn: string,
	bucket: string,
	account: string,
): PolicyDocument {
	return {
		Version: '2012-10-17',
		Statement: [
			{
				Sid: 'GkmBucketPublishes',
				Effect: 'Allow',
				Principal: { Service: 's3.amazonaws.com' },
				Action: 'sns:Publish',
				Resource: topicArn,
				Condition: {
					ArnLike: { 'aws:SourceArn': `arn:aws:s3:::${bucket}` },
					StringEquals: { 'aws:SourceAccount': account },
				},
			},
		],
	};
}

/** Only the bucket's topic may send to its dead-letter queue. */
export function eventsDeadLetterPolicy(
	queueArn: string,
	topicArn: string,
): PolicyDocument {
	return {
		Version: '2012-10-17',
		Statement: [
			{
				Sid: 'GkmTopicDeadLetters',
				Effect: 'Allow',
				Principal: { Service: 'sns.amazonaws.com' },
				Action: 'sqs:SendMessage',
				Resource: queueArn,
				Condition: { ArnEquals: { 'aws:SourceArn': topicArn } },
			},
		],
	};
}

/** A bucket's notification entry, as S3 spells it. */
export interface TopicNotification {
	Id?: string;
	TopicArn: string | undefined;
	Events: string[] | undefined;
	Filter?: unknown;
}

/** A bucket's notification configuration, as far as this provider reads it. */
export interface BucketNotifications {
	TopicConfigurations?: TopicNotification[];
	[other: string]: unknown;
}

/** The id this provider's notification entry goes under. */
export const notificationId = (id: string) => `gkm-${id}`;

/**
 * The bucket's notifications with this provider's entry put back, and whether
 * that changed anything. Every other entry — a queue, a function, a topic
 * somebody added by hand — is kept exactly as it was.
 */
export function mergedNotifications(
	current: BucketNotifications,
	id: string,
	topicArn: string,
): { config: BucketNotifications; changed: boolean } {
	const own = notificationId(id);
	const wanted: TopicNotification = {
		Id: own,
		TopicArn: topicArn,
		Events: [...BUCKET_EVENTS],
	};
	const topics = current.TopicConfigurations ?? [];
	const existing = topics.find((t) => t.Id === own);
	const same =
		existing !== undefined &&
		existing.TopicArn === topicArn &&
		JSON.stringify([...(existing.Events ?? [])].sort()) ===
			JSON.stringify([...BUCKET_EVENTS].sort()) &&
		existing.Filter === undefined;
	const { ResponseMetadata: _, ...rest } = current as BucketNotifications & {
		ResponseMetadata?: unknown;
	};
	return {
		config: {
			...rest,
			TopicConfigurations: [...topics.filter((t) => t.Id !== own), wanted],
		},
		changed: !same,
	};
}

/** S3 refused the entry because another one already covers these events. */
export class BucketNotificationsOverlap extends GkmError {
	constructor(
		readonly bucket: string,
		readonly detail: string,
	) {
		super(
			`'${bucket}' already sends object creates or deletes somewhere else, ` +
				`and S3 sends each event to one place only, so the deploy cannot ` +
				`add its own entry. Remove the other notification from the bucket, ` +
				`or give it a prefix, and deploy again. S3 said: ${detail}`,
		);
		this.name = 'BucketNotificationsOverlap';
	}
}

/** The topic and the dead-letter queue a watched bucket publishes through. */
export interface BucketEvents {
	topicArn: string;
	deadLetterArn: string;
}

interface EventsClients {
	SNS: SnsModule;
	SQS: SqsModule;
	sns: InstanceType<SnsModule['SNSClient']>;
	sqs: InstanceType<SqsModule['SQSClient']>;
	account: string;
	region: string;
	/** An emulator's SNS endpoint, when the environment names one. */
	endpoint?: string;
}

/** Clients for a bucket's events, for tests to replace. */
export type EventsClientFactory = (
	credential: AwsProvisioning,
	region: string,
) => Promise<EventsClients>;

export const defaultEventsClients: EventsClientFactory = async (
	credential,
	region,
) => {
	const SNS = await import('@aws-sdk/client-sns');
	const SQS = await import('@aws-sdk/client-sqs');
	const { STSClient, GetCallerIdentityCommand } = await import(
		'@aws-sdk/client-sts'
	);
	const config = await awsClientConfig(credential, region);
	const endpoint = awsEndpoint(process.env, 'SNS');
	const sts = new STSClient({
		...config,
		...(awsEndpoint(process.env, 'STS')
			? { endpoint: awsEndpoint(process.env, 'STS') }
			: {}),
	});
	const { Account } = await sts.send(new GetCallerIdentityCommand({}));
	sts.destroy();
	return {
		SNS,
		SQS,
		sns: new SNS.SNSClient({ ...config, ...(endpoint ? { endpoint } : {}) }),
		sqs: new SQS.SQSClient({
			...config,
			...(awsEndpoint(process.env, 'SQS')
				? { endpoint: awsEndpoint(process.env, 'SQS') }
				: {}),
		}),
		account: Account!,
		region,
		...(endpoint ? { endpoint } : {}),
	};
};

let makeEventsClients: EventsClientFactory = defaultEventsClients;

/** Replace the client factory — a test intercepting a call. Returns the old one. */
export function useEventsClients(
	factory: EventsClientFactory,
): EventsClientFactory {
	const previous = makeEventsClients;
	makeEventsClients = factory;
	return previous;
}

function errorName(error: unknown): string {
	const e = error as { name?: string; Code?: string; code?: string };
	return e?.name ?? e?.Code ?? e?.code ?? '';
}

async function readOr<T>(
	read: () => Promise<T>,
	missing: readonly string[],
): Promise<T | undefined> {
	try {
		return await read();
	} catch (error) {
		if (missing.includes(errorName(error))) return undefined;
		throw error;
	}
}

/**
 * The topic, its policy, the dead-letter queue and the bucket's notification
 * entry for one watched bucket — created where missing, put back where they
 * drifted.
 */
export async function ensureBucketEvents(
	ctx: Ctx,
	s3: { S3: S3Module; s3: InstanceType<S3Module['S3Client']> },
	input: { id: string; bucket: string; region: string },
): Promise<BucketEvents> {
	const { id, bucket, region } = input;
	const clients = await makeEventsClients(ctx.credential, region);
	const { SNS, SQS, sns, sqs, account } = clients;

	const topicName = eventsTopicName(bucket);
	const topicArn = `arn:aws:sns:${region}:${account}:${topicName}`;
	const topicEntry = { key: `sns-topic:${id}`, type: 'sns-topic' };
	const topic = await readOr(
		() => sns.send(new SNS.GetTopicAttributesCommand({ TopicArn: topicArn })),
		['NotFound', 'NotFoundException'],
	);
	if (topic) {
		await ctx.state.ready(topicEntry, topicArn);
	} else {
		await ctx.change(
			{ construct: id, resource: `SNS topic ${topicName}`, change: 'create' },
			async () => {
				await ctx.state.pending(topicEntry);
				await sns.send(
					new SNS.CreateTopicCommand({
						Name: topicName,
						Tags: identityTags(ctx, id),
					}),
				);
				await ctx.state.ready(topicEntry, topicArn);
			},
		);
	}

	const topicPolicy = eventsTopicPolicy(topicArn, bucket, account);
	const currentTopicPolicy = topic?.Attributes?.Policy;
	if (
		!currentTopicPolicy ||
		canonicalPolicy(JSON.parse(currentTopicPolicy)) !==
			canonicalPolicy(topicPolicy)
	) {
		await ctx.change(
			{
				construct: id,
				resource: `SNS topic ${topicName}`,
				change: `publishable by '${bucket}' only`,
			},
			async () => {
				await sns.send(
					new SNS.SetTopicAttributesCommand({
						TopicArn: topicArn,
						AttributeName: 'Policy',
						AttributeValue: JSON.stringify(topicPolicy),
					}),
				);
			},
		);
	}

	const queueName = eventsDeadLetterName(bucket);
	const deadLetterArn = `arn:aws:sqs:${region}:${account}:${queueName}`;
	const queueEntry = { key: `sqs-queue:${id}-events-dlq`, type: 'sqs-queue' };
	const queue = await readOr(
		() => sqs.send(new SQS.GetQueueUrlCommand({ QueueName: queueName })),
		['QueueDoesNotExist', 'AWS.SimpleQueueService.NonExistentQueue'],
	);
	let queueUrl = queue?.QueueUrl;
	if (queueUrl) {
		await ctx.state.ready(queueEntry, deadLetterArn);
	} else {
		await ctx.change(
			{ construct: id, resource: `SQS queue ${queueName}`, change: 'create' },
			async () => {
				await ctx.state.pending(queueEntry);
				const created = await sqs.send(
					new SQS.CreateQueueCommand({
						QueueName: queueName,
						// The longest SQS keeps anything: a dead letter is read by a
						// person, later.
						Attributes: { MessageRetentionPeriod: '1209600' },
						tags: Object.fromEntries(
							identityTags(ctx, id).map((t) => [t.Key, t.Value]),
						),
					}),
				);
				queueUrl = created.QueueUrl;
				await ctx.state.ready(queueEntry, deadLetterArn);
			},
		);
	}

	const queuePolicy = eventsDeadLetterPolicy(deadLetterArn, topicArn);
	const currentQueuePolicy = queue?.QueueUrl
		? (
				await sqs.send(
					new SQS.GetQueueAttributesCommand({
						QueueUrl: queue.QueueUrl,
						AttributeNames: ['Policy'],
					}),
				)
			).Attributes?.Policy
		: undefined;
	if (
		!currentQueuePolicy ||
		canonicalPolicy(JSON.parse(currentQueuePolicy)) !==
			canonicalPolicy(queuePolicy)
	) {
		await ctx.change(
			{
				construct: id,
				resource: `SQS queue ${queueName}`,
				change: `receives what ${topicName} cannot deliver`,
			},
			async () => {
				await sqs.send(
					new SQS.SetQueueAttributesCommand({
						QueueUrl: queueUrl!,
						Attributes: { Policy: JSON.stringify(queuePolicy) },
					}),
				);
			},
		);
	}

	// The bucket tells the topic last: S3 checks it may publish when the entry
	// is written, which the topic's policy above is what allows.
	const current = (await readOr(
		() =>
			s3.s3.send(
				new s3.S3.GetBucketNotificationConfigurationCommand({ Bucket: bucket }),
			),
		['NoSuchBucket'],
	)) as BucketNotifications | undefined;
	const merged = mergedNotifications(current ?? {}, id, topicArn);
	if (merged.changed) {
		await ctx.change(
			{
				construct: id,
				resource: `bucket ${bucket}`,
				change: `send object creates and deletes to ${topicName}`,
			},
			async () => {
				try {
					await s3.s3.send(
						new s3.S3.PutBucketNotificationConfigurationCommand({
							Bucket: bucket,
							NotificationConfiguration: merged.config as never,
						}),
					);
				} catch (error) {
					const message = (error as Error).message ?? '';
					if (/overlap/i.test(message)) {
						throw new BucketNotificationsOverlap(bucket, message);
					}
					throw error;
				}
			},
		);
	}

	sns.destroy();
	sqs.destroy();
	return { topicArn, deadLetterArn };
}

/**
 * The events key: the topic's address, signed by the bucket's own access key
 * — read off the bucket's URL, so a rotated key rotates this one with it.
 */
export async function ensureEventsKey(
	ctx: Ctx,
	input: { id: string; topicArn: string; region: string },
): Promise<void> {
	const { id, topicArn, region } = input;
	const key = provideKey(id, 'eventsConnectionString');
	const url = ctx.secrets[provideKey(id, 'url')];
	let parsed: s3Url.S3Address | undefined;
	try {
		parsed = url ? s3Url.parse(url) : undefined;
	} catch {
		parsed = undefined;
	}
	if (!parsed?.accessKeyId || !parsed.secretAccessKey) {
		// Only a dry run gets here: the key is issued above, before this.
		await ctx.change(
			{ construct: id, resource: key, change: 'set to the topic’s address' },
			async () => {},
		);
		return;
	}

	const { snsUrl } = await import('@geekmidas/events/sns');
	const endpoint = awsEndpoint(process.env, 'SNS');
	const address = new URL(
		snsUrl.build({ topicArn, region, ...(endpoint ? { endpoint } : {}) }),
	);
	address.searchParams.set('accessKeyId', parsed.accessKeyId);
	address.searchParams.set('secretAccessKey', parsed.secretAccessKey);
	const value = address.toString();

	const entry = { key: `events-key:${id}`, type: 'url' };
	if (ctx.secrets[key] === value) {
		await ctx.state.ready(entry, topicArn);
		return;
	}
	await ctx.change(
		{ construct: id, resource: key, change: `set to ${topicArn}` },
		async () => {
			await ctx.writeSecrets({ [key]: value });
			await ctx.state.ready(entry, topicArn);
		},
	);
}

/** Where SNS pushes to a worker: its own host on the stage's domain. */
export function workerPushHost(worker: string, domain: string): string {
	return `${appKey(worker)}.${domain}`;
}

/**
 * One HTTP subscription per subscriber to the bucket's topic, at its route on
 * its worker's host, with the bucket's dead-letter queue — and each ARN
 * recorded, which is what the worker accepts deliveries under.
 *
 * Unfiltered: a bucket's notifications carry no `type` attribute, and the
 * subscriber's own filter — events, prefix, suffix — is what decides. Only a
 * compose stage pushes to a worker; any other is told so and left alone.
 */
export async function ensurePushSubscriptions(
	ctx: Ctx,
	input: {
		id: string;
		events: BucketEvents;
		region: string;
		watchers: readonly BucketWatcher[];
	},
): Promise<void> {
	const { id, events, region, watchers } = input;
	if (!deploysWithCompose(ctx.workspace)) {
		ctx.log(
			`   '${id}' is watched, and only a compose stage pushes a bucket's changes to a worker: its subscribers receive nothing on '${ctx.stage}'`,
		);
		return;
	}
	if (watchers.length === 0) return;
	const domain = ctx.workspace.domains?.[ctx.stage];
	if (!domain) throw new NoDomainForStage(ctx.stage);

	const { SNSConnection, reconcileHttpSubscriptions } = await import(
		'@geekmidas/events/sns'
	);
	const { credentials } = await awsClientConfig(ctx.credential, region);
	const endpoint = awsEndpoint(process.env, 'SNS');

	const byWorker = new Map<string, BucketWatcher[]>();
	for (const watcher of watchers) {
		byWorker.set(watcher.worker, [
			...(byWorker.get(watcher.worker) ?? []),
			watcher,
		]);
	}

	for (const [worker, own] of byWorker) {
		const host = workerPushHost(worker, domain);
		const endpoints = own.map(({ name }) => ({
			name,
			endpoint: `https://${host}${subscriberRoute(name)}`,
			deadLetterQueueArn: events.deadLetterArn,
		}));
		const unrecorded = own.filter(
			({ name }) =>
				ctx.state.record(subscriptionKey(worker, name))?.status !== 'ready',
		);
		if (ctx.dryRun) {
			if (unrecorded.length > 0) {
				await ctx.change(
					{
						construct: id,
						resource: `SNS subscriptions on ${host}`,
						change: `subscribe ${unrecorded.map((w) => w.name).join(', ')}`,
					},
					async () => {},
				);
			}
			continue;
		}

		const connection = new SNSConnection({
			topicArn: events.topicArn,
			region,
			...(endpoint ? { endpoint } : {}),
			...(credentials ? { credentials } : {}),
		});
		const result = await reconcileHttpSubscriptions(connection, {
			endpoints,
			ownedHost: host,
		});
		await connection.close();

		for (const spec of endpoints) {
			const arn = result.subscriptions[spec.name]!;
			const pending = result.pending.includes(spec.name);
			const recorded = ctx.state.record(subscriptionKey(worker, spec.name));
			if (recorded?.id !== arn) {
				ctx.log(
					`   ✓ '${spec.name}' subscribed to ${events.topicArn.split(':').pop()} at ${spec.endpoint}`,
				);
			}
			const { key, type, data } = subscriptionResource(
				{
					worker,
					name: spec.name,
					topicArn: events.topicArn,
					endpoint: spec.endpoint,
					deadLetterQueueArn: events.deadLetterArn,
					pending,
				},
				arn,
			);
			await ctx.state.ready({ key, type, ...(data ? { data } : {}) }, arn);
		}
		for (const arn of result.removed) {
			ctx.log(`   – unsubscribed ${arn}: no subscriber wants it any more`);
		}
	}
}
