import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { GetUserPolicyCommand, IAMClient } from '@aws-sdk/client-iam';
import {
	GetBucketNotificationConfigurationCommand,
	PutBucketNotificationConfigurationCommand,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import {
	CreateTopicCommand,
	GetSubscriptionAttributesCommand,
	GetTopicAttributesCommand,
	ListSubscriptionsByTopicCommand,
	SNSClient,
} from '@aws-sdk/client-sns';
import {
	GetQueueAttributesCommand,
	GetQueueUrlCommand,
	SQSClient,
} from '@aws-sdk/client-sqs';
import { ObjectStorage } from '@geekmidas/constructs/object-storage';
import { SnsPushSubscriberAdaptor } from '@geekmidas/constructs/subscribers';
import { Worker } from '@geekmidas/constructs/worker';
import { EnvironmentParser } from '@geekmidas/envkit';
import {
	confirmSubscription,
	reconcileHttpSubscriptions,
	SNSConnection,
} from '@geekmidas/events/sns';
import type {
	ConstructManifest,
	ObjectsDeclaration,
} from '@geekmidas/manifest';
import type { ObjectEvent } from '@geekmidas/storage/events';
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	resolvesHere,
	SERVER_IPV4,
	writeComposeApp,
} from '../../compose/__tests__/__helpers__/composeApp';
import {
	answering,
	fakeDocker,
	fakeServer,
} from '../../compose/__tests__/__helpers__/fakeDocker';
import { loadWorkspaceConfig } from '../../config';
import { deploy } from '../../deploy/deploy';
import type { DeployEvent } from '../../deploy/events';
import { createStateStore } from '../../deploy/StateStore';
import {
	confirmPendingSubscriptions,
	recordedPushSubscriptions,
} from '../../deploy/snsSubscriptions';
import { type BoundSubscriber, discover } from '../../reconcile/discover';
import { constructGlobs } from '../../reconcile/workspace';
import { secretsStoreFor } from '../../secrets/store';
import { composeTarget } from '../../target/compose/index';
import type { NormalizedWorkspace } from '../../workspace/types';
import { provisionStage } from '../index';
import { eventsDeadLetterName, eventsTopicName } from '../s3/events';
import { bucketName, iamUserName } from '../s3/naming';

/**
 * A watched bucket on an `s3` stage, against the AWS emulator (floci): the
 * topic, its policy, the dead-letter queue, the bucket's notification entry,
 * the events key and the subscriptions are all real calls — and so is the
 * whole way back: an object put in the bucket, published by S3, pushed by SNS
 * to an HTTP server on this machine, read by the worker's adaptor.
 *
 * floci enforces no policy, so the topic's and the queue's are asserted as
 * documents.
 */

const REGION = 'eu-west-1';
const STAGE = 'production';
const DOMAIN = 'shop.example.com';

const admin = {
	region: REGION,
	endpoint: LOCALSTACK_URL,
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
};
const s3 = new S3Client({ ...admin, forcePathStyle: true });
const sns = new SNSClient(admin);
const sqs = new SQSClient(admin);
const iam = new IAMClient(admin);

let dir: string;
let home: string;
let name: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let subscribers: Record<string, BoundSubscriber[]>;
const lines: string[] = [];

const bucket = () => bucketName({ scope: name, stage: STAGE, id: 'uploads' });

const stateStore = () =>
	createStateStore({
		config: workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
	});

const provision = async (
	options: Partial<Parameters<typeof provisionStage>[0]> = {},
) => {
	const store = await secretsStoreFor(workspace, STAGE, { home });
	return provisionStage({
		workspace,
		stage: STAGE,
		manifest,
		subscribers,
		home,
		secrets: {
			read: () => store.read(STAGE),
			write: (secrets) => store.write(STAGE, secrets),
		},
		state: await stateStore(),
		log: (line) => lines.push(line),
		...options,
	});
};

async function secretsOf() {
	const store = await secretsStoreFor(workspace, STAGE, { home });
	return (await store.read(STAGE))?.custom ?? {};
}

async function resources() {
	return (await (await stateStore()).read(STAGE))?.resources ?? {};
}

beforeAll(async () => {
	vi.stubEnv('AWS_ENDPOINT_URL', LOCALSTACK_URL);
	vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
	vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
	vi.stubEnv('AWS_REGION', REGION);
	vi.stubEnv('AWS_PROFILE', undefined);

	dir = realpathSync(await createTempDir('gkm-provider-s3-events-'));
	home = realpathSync(await createTempDir('gkm-provider-home-'));
	vi.stubEnv('GKM_HOME', home);
	name = `evt-${Date.now().toString(36)}`;
	writeComposeApp(dir, {
		name,
		target: 'compose',
		domain: DOMAIN,
		deployed: [STAGE],
		domains: { [STAGE]: DOMAIN },
		deployObjects: { [STAGE]: { provider: 's3', region: REGION } },
	});
	writeFileSync(
		join(dir, 'constructs', 'storage.ts'),
		`import { ObjectStorage } from '@geekmidas/constructs/object-storage';

export const uploads = new ObjectStorage('Uploads');
`,
	);
	writeFileSync(
		join(dir, 'apps', 'api', 'queues', 'avatars.ts'),
		`import { worker } from '../../../constructs/worker.js';
import { uploads } from '../../../constructs/storage.js';

export const onAvatar = worker
	.objects(uploads)
	.on(['object.created'], { prefix: 'avatars/' })
	.handle(async () => {});
`,
	);
	({ workspace } = await loadWorkspaceConfig(dir));
	subscribers = {};
	manifest = await discover({
		patterns: constructGlobs(workspace),
		cwd: workspace.root,
		subscribers,
	});
}, 120_000);

beforeEach(() => {
	lines.length = 0;
});

afterAll(async () => {
	vi.unstubAllEnvs();
	await cleanupDir(dir);
	await cleanupDir(home);
});

describe('a watched bucket on an s3 stage', () => {
	const topicArn = () =>
		`arn:aws:sns:${REGION}:000000000000:${eventsTopicName(bucket())}`;

	it('creates the topic, the dead-letter queue and the notification entry, and the events key', async () => {
		await provision();

		// The topic only the bucket may publish to.
		const topic = await sns.send(
			new GetTopicAttributesCommand({ TopicArn: topicArn() }),
		);
		expect(JSON.parse(topic.Attributes!.Policy!)).toEqual({
			Version: '2012-10-17',
			Statement: [
				{
					Sid: 'GkmBucketPublishes',
					Effect: 'Allow',
					Principal: { Service: 's3.amazonaws.com' },
					Action: 'sns:Publish',
					Resource: topicArn(),
					Condition: {
						ArnLike: { 'aws:SourceArn': `arn:aws:s3:::${bucket()}` },
						StringEquals: { 'aws:SourceAccount': '000000000000' },
					},
				},
			],
		});

		// The dead-letter queue only the topic may send to.
		const { QueueUrl } = await sqs.send(
			new GetQueueUrlCommand({ QueueName: eventsDeadLetterName(bucket()) }),
		);
		const queue = await sqs.send(
			new GetQueueAttributesCommand({
				QueueUrl,
				AttributeNames: ['Policy', 'MessageRetentionPeriod'],
			}),
		);
		expect(queue.Attributes?.MessageRetentionPeriod).toBe('1209600');
		expect(JSON.parse(queue.Attributes!.Policy!).Statement[0]).toMatchObject({
			Principal: { Service: 'sns.amazonaws.com' },
			Action: 'sqs:SendMessage',
			Condition: { ArnEquals: { 'aws:SourceArn': topicArn() } },
		});

		// Every create and delete, to the topic.
		const notifications = await s3.send(
			new GetBucketNotificationConfigurationCommand({ Bucket: bucket() }),
		);
		expect(notifications.TopicConfigurations).toEqual([
			{
				Id: 'gkm-Uploads',
				TopicArn: topicArn(),
				Events: ['s3:ObjectCreated:*', 's3:ObjectRemoved:*'],
			},
		]);

		// The bucket's key may confirm subscriptions to the topic, and no more.
		const policy = await iam.send(
			new GetUserPolicyCommand({
				UserName: iamUserName({ scope: name, stage: STAGE, id: 'uploads' }),
				PolicyName: 'gkm-bucket',
			}),
		);
		expect(
			JSON.parse(decodeURIComponent(policy.PolicyDocument!)).Statement,
		).toContainEqual({
			Sid: 'GkmEvents',
			Effect: 'Allow',
			Action: 'sns:ConfirmSubscription',
			Resource: topicArn(),
		});

		// The events key: the topic, signed by the bucket's own key.
		const secrets = await secretsOf();
		const events = new URL(secrets.UPLOADS_EVENTS_CONNECTION_STRING!);
		const bucketUrl = new URL(secrets.UPLOADS_URL!);
		expect(events.protocol).toBe('sns:');
		expect(events.searchParams.get('topicArn')).toBe(topicArn());
		expect(events.searchParams.get('accessKeyId')).toBe(
			decodeURIComponent(bucketUrl.username),
		);
		expect(events.searchParams.get('secretAccessKey')).toBe(
			decodeURIComponent(bucketUrl.password),
		);
	});

	it('subscribes each subscriber at its route on its worker’s host, and records the ARN', async () => {
		const recorded = await resources();
		const subscription = recorded['sns-subscription:Jobs/onAvatar'];

		expect(subscription).toMatchObject({
			type: 'sns-subscription',
			status: 'ready',
			data: {
				worker: 'Jobs',
				topicArn: topicArn(),
				endpoint: `https://jobs.${DOMAIN}/__gkm/subscribers/onAvatar`,
			},
		});
		expect(subscription?.id).toMatch(
			new RegExp(`^${topicArn().replaceAll('.', '\\.')}:`),
		);
		expect(recordedPushSubscriptions(recorded)).toEqual({
			Jobs: { onAvatar: subscription!.id },
		});

		const attributes = await sns.send(
			new GetSubscriptionAttributesCommand({
				SubscriptionArn: subscription!.id!,
			}),
		);
		// Unfiltered — the subscriber filters — and failing over to the queue.
		expect(attributes.Attributes?.FilterPolicy).toBeUndefined();
		expect(JSON.parse(attributes.Attributes!.RedrivePolicy!)).toEqual({
			deadLetterTargetArn: `arn:aws:sqs:${REGION}:000000000000:${eventsDeadLetterName(bucket())}`,
		});
	});

	it('changes nothing on a second run', async () => {
		const before = await resources();
		const reports = await provision();

		expect(reports.flatMap((r) => r.actions)).toEqual([]);
		expect((await resources())['sns-subscription:Jobs/onAvatar']?.id).toBe(
			before['sns-subscription:Jobs/onAvatar']?.id,
		);
	});

	it('keeps a notification entry somebody else added', async () => {
		const { TopicArn: other } = await sns.send(
			new CreateTopicCommand({ Name: `${bucket()}-audit` }),
		);
		const current = await s3.send(
			new GetBucketNotificationConfigurationCommand({ Bucket: bucket() }),
		);
		// Theirs replaces ours, as a hand-made PUT would.
		await s3.send(
			new PutBucketNotificationConfigurationCommand({
				Bucket: bucket(),
				NotificationConfiguration: {
					TopicConfigurations: [
						{
							Id: 'audit',
							TopicArn: other,
							Events: ['s3:ReducedRedundancyLostObject'],
						},
					],
				},
			}),
		);
		expect(current.TopicConfigurations).toHaveLength(1);

		await provision();

		const after = await s3.send(
			new GetBucketNotificationConfigurationCommand({ Bucket: bucket() }),
		);
		expect(after.TopicConfigurations?.map((t) => t.Id).sort()).toEqual([
			'audit',
			'gkm-Uploads',
		]);
	});

	it('unsubscribes a route no subscriber wants any more', async () => {
		const arn = (await resources())['sns-subscription:Jobs/onAvatar']!.id!;

		// The same worker, now with a subscriber of another name.
		const uploads = manifest.Uploads as ObjectsDeclaration;
		await provision({
			manifest: {
				...manifest,
				Uploads: {
					...uploads,
					subscribers: (uploads.subscribers ?? []).map((s) => ({
						...s,
						id: 'onPhoto',
					})),
				},
			},
			subscribers: {
				Jobs: [
					{
						name: 'onPhoto',
						connectionKey: 'UPLOADS_EVENTS_CONNECTION_STRING',
					},
				],
			},
		});

		const listed = await sns.send(
			new ListSubscriptionsByTopicCommand({ TopicArn: topicArn() }),
		);
		const endpoints = (listed.Subscriptions ?? []).map((s) => s.Endpoint);
		expect(endpoints).toContain(
			`https://jobs.${DOMAIN}/__gkm/subscribers/onPhoto`,
		);
		expect(endpoints).not.toContain(
			`https://jobs.${DOMAIN}/__gkm/subscribers/onAvatar`,
		);
		expect(listed.Subscriptions?.map((s) => s.SubscriptionArn)).not.toContain(
			arn,
		);

		// Back as it was, for what follows.
		await provision();
	});
});

describe('an object put in a watched bucket', () => {
	let server: Server;

	afterAll(() => {
		server?.close();
	});

	it('reaches the worker’s handler as an object event', async () => {
		const secrets = await secretsOf();
		const eventsUrl = secrets.UPLOADS_EVENTS_CONNECTION_STRING!;
		const topicArn = new URL(eventsUrl).searchParams.get('topicArn')!;

		const handled: ObjectEvent[] = [];
		const subscriber = new Worker('Jobs')
			.objects(new ObjectStorage('Uploads'))
			.on(['object.created'], { prefix: 'avatars/' })
			.handle(async ({ objects }) => {
				handled.push(...objects);
			});

		// The worker's half: it confirms with the bucket's own key — what the
		// events key carries — and accepts only the subscription recorded.
		const workerConnection =
			await SNSConnection.fromConnectionString(eventsUrl);
		let recorded: string | undefined;
		const adaptor = () =>
			new SnsPushSubscriberAdaptor(new EnvironmentParser({}), subscriber, {
				topicArn,
				verify: false,
				...(recorded ? { subscriptionArn: recorded } : {}),
				confirm: (message) => confirmSubscription(workerConnection, message),
			});
		server = createServer((req, res) => {
			let body = '';
			req.on('data', (chunk) => {
				body += chunk;
			});
			req.on('end', async () => {
				const header = req.headers['x-amz-sns-subscription-arn'];
				const response = await adaptor().handle(JSON.parse(body), {
					subscriptionArn: typeof header === 'string' ? header : undefined,
				});
				res.writeHead(response.status, { 'content-type': 'application/json' });
				res.end(JSON.stringify(response.body));
			});
		});
		await new Promise<void>((resolve) => server.listen(0, resolve));
		const port = (server.address() as { port: number }).port;
		// floci runs in Docker: this machine is host.docker.internal there.
		const endpoint = `http://host.docker.internal:${port}/__gkm/subscribers/onAvatar`;

		// The deploy's half: subscribed before the worker answers, recorded…
		const deploy = new SNSConnection({
			topicArn,
			region: REGION,
			endpoint: LOCALSTACK_URL,
			credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
		});
		const { subscriptions } = await reconcileHttpSubscriptions(deploy, {
			endpoints: [{ name: 'onAvatar', endpoint }],
			ownedHost: `host.docker.internal:${port}`,
		});
		recorded = subscriptions.onAvatar;

		// …and confirmed once it does.
		const left = await confirmPendingSubscriptions({
			workspace,
			stage: STAGE,
			resources: {
				'sns-subscription:Jobs/onAvatar': {
					key: 'sns-subscription:Jobs/onAvatar',
					type: 'sns-subscription',
					status: 'ready',
					id: recorded,
					data: { topicArn, endpoint, pending: true },
					updatedAt: new Date().toISOString(),
				},
			},
			timeoutMs: 15_000,
			home,
		});
		expect(left).toEqual([]);

		await s3.send(
			new PutObjectCommand({
				Bucket: bucket(),
				Key: 'avatars/a b.png',
				Body: 'png',
			}),
		);
		await s3.send(
			new PutObjectCommand({ Bucket: bucket(), Key: 'other/x.txt', Body: 'x' }),
		);

		await vi.waitFor(
			() => {
				expect(handled).toHaveLength(1);
			},
			{ timeout: 15_000, interval: 250 },
		);
		// Decoded, and only what it watches.
		expect(handled[0]).toMatchObject({
			bucket: bucket(),
			key: 'avatars/a b.png',
		});
		await workerConnection.close();
		await deploy.close();
	}, 60_000);
});

describe('a compose deploy of a stage with a watched bucket', () => {
	it('hands the worker the subscriptions it recorded, and has them confirmed once it is up', async () => {
		const store = await secretsStoreFor(workspace, STAGE, { home });
		const stored = (await store.read(STAGE))!;
		await store.write(STAGE, {
			...stored,
			custom: { ...stored.custom, GKM_SERVER_IPV4: SERVER_IPV4 },
		});

		const asked: Parameters<typeof confirmPendingSubscriptions>[0][] = [];
		const fake = fakeDocker();
		const run = deploy({
			cwd: dir,
			stage: STAGE,
			target: 'compose',
			home,
			targets: {
				compose: composeTarget({
					revision: async () => 'abc1234',
					sql: () => ({ query: async () => [] }),
					logins: async ({ login }) => ({
						service: 'postgres',
						status: 'current',
						login,
					}),
					migrate: async () => [],
					seed: async () => [],
					healthIntervalMs: 0,
					lookup: resolvesHere,
					docker: fake.docker,
					server: fakeServer([]),
					probe: answering(fake.calls),
					confirmSubscriptions: async (input) => {
						asked.push(input);
						return [];
					},
				}),
			},
		});
		const seen: DeployEvent[] = [];
		for await (const event of run) seen.push(event);
		await run.result;

		const arn = (await resources())['sns-subscription:Jobs/onAvatar']!.id!;
		const env = readFileSync(
			join(dir, '.gkm', 'compose', STAGE, 'jobs.env'),
			'utf-8',
		);
		expect(env).toContain(
			`GKM_SNS_SUBSCRIPTIONS=${JSON.stringify({ onAvatar: arn })}`,
		);
		expect(env).toMatch(/^UPLOADS_EVENTS_CONNECTION_STRING=sns:/m);
		// The bucket's events, not the bucket.
		expect(env).not.toMatch(/^UPLOADS_URL=/m);

		// Once the workers answered: the recorded subscriptions, to confirm.
		expect(asked).toHaveLength(1);
		expect(asked[0]?.resources?.['sns-subscription:Jobs/onAvatar']?.id).toBe(
			arn,
		);
		expect(
			seen.some((e) => e.type === 'phase.finished' && e.phase === 'verify'),
		).toBe(true);
	}, 120_000);
});
