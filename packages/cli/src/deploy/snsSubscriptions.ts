/**
 * The SNS subscriptions a deploy makes for the subscribers it pushes to, and
 * keeps: what both owners of them share.
 *
 * Against SNS itself a worker never subscribes — its credentials can only
 * confirm — so the deploy subscribes each pushed subscriber's route, records
 * the ARN in the stage's state, and hands the worker those ARNs as
 * `GKM_SNS_SUBSCRIPTIONS`. Two places make them: the `s3` provider, for a
 * bucket's subscribers (it created the topic), and the compose target, for a
 * topic whose connection string the stage set by hand. Both record them the
 * same way, so one confirmation pass and one read serve both.
 */

import type {
	HttpSubscriptionSpec,
	SNSConnection,
} from '@geekmidas/events/sns';
import { GkmError } from '../errors';
import {
	type AwsProvisioning,
	awsClientConfig,
	awsEndpoint,
	awsProvisioningCredentials,
} from '../providers/aws.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import type { ResourceInput, ResourceRecord } from './StateStore.js';

/** The type every recorded subscription has in the stage's state. */
export const SUBSCRIPTION_TYPE = 'sns-subscription';

/** The state key a subscriber's SNS subscription is recorded under. */
export const subscriptionKey = (worker: string, name: string) =>
	`${SUBSCRIPTION_TYPE}:${worker}/${name}`;

/** One subscription, as the deploy made it. */
export interface RecordedSubscription {
	worker: string;
	/** The subscriber's export. */
	name: string;
	topicArn: string;
	endpoint: string;
	deadLetterQueueArn?: string;
	/** The `type` filter of a topic subscriber; absent for a bucket's. */
	events?: readonly string[];
	/**
	 * The stage secret whose connection string the subscription was made
	 * with — a topic set by hand, whose credentials are its own. Absent for a
	 * bucket's, made with the deploy's provisioning credentials.
	 */
	connectionKey?: string;
	/** SNS still waits for the worker to confirm it. */
	pending: boolean;
}

/** What a recorded subscription is written to the stage's state as. */
export function subscriptionResource(
	subscription: RecordedSubscription,
	arn: string,
): ResourceInput {
	const { name, ...data } = subscription;
	return {
		key: subscriptionKey(subscription.worker, name),
		type: SUBSCRIPTION_TYPE,
		id: arn,
		status: 'ready',
		data: { ...data, ...(data.events ? { events: [...data.events] } : {}) },
	};
}

/** The subscription a record holds, as an endpoint to reconcile. */
function specOf(record: ResourceRecord): HttpSubscriptionSpec {
	const events = record.data?.events;
	return {
		name: record.key.split('/').pop()!,
		endpoint: String(record.data?.endpoint),
		...(record.data?.deadLetterQueueArn
			? { deadLetterQueueArn: String(record.data.deadLetterQueueArn) }
			: {}),
		...(Array.isArray(events) ? { events: events.map(String) } : {}),
	};
}

/**
 * The subscriptions the deploy recorded, by worker and export — what each
 * worker is handed as `GKM_SNS_SUBSCRIPTIONS`.
 */
export function recordedPushSubscriptions(
	resources: Readonly<Record<string, ResourceRecord>> | undefined,
): Record<string, Record<string, string>> {
	const byWorker: Record<string, Record<string, string>> = {};
	for (const record of Object.values(resources ?? {})) {
		if (record.type !== SUBSCRIPTION_TYPE || !record.id) continue;
		const [worker, name] = record.key
			.slice(`${SUBSCRIPTION_TYPE}:`.length)
			.split('/');
		if (!worker || !name) continue;
		byWorker[worker] = { ...byWorker[worker], [name]: record.id };
	}
	return byWorker;
}

/** A topic connection string the deploy cannot sign with. */
export class TopicSubscriptionUnsigned extends GkmError {
	constructor(readonly connectionKey: string) {
		super(
			`'${connectionKey}' carries no keys, and the deploy found no AWS ` +
				`credentials of its own to subscribe the worker's routes with. Put ` +
				`accessKeyId and secretAccessKey in it — keys allowed ` +
				`sns:Subscribe, sns:ListSubscriptionsByTopic, ` +
				`sns:GetSubscriptionAttributes, sns:SetSubscriptionAttributes and ` +
				`sns:Unsubscribe on the topic — or sign in with \`gkm login\`.`,
		);
		this.name = 'TopicSubscriptionUnsigned';
	}
}

/**
 * A connection to the topic a stage's connection string names, signed with
 * its own keys — or, carrying none, the deploy's.
 *
 * The emulator the environment points the SDK at stands in for SNS, as it
 * does for every provider: a string with no `endpoint` is SNS itself.
 *
 * @throws {TopicSubscriptionUnsigned} with no keys from either
 */
export async function topicConnection(input: {
	connectionKey: string;
	connectionString: string;
	stage: string;
	env: NodeJS.ProcessEnv;
	home?: string;
}): Promise<SNSConnection> {
	const { SNSConnection, snsUrl } = await import('@geekmidas/events/sns');
	const { topicArn, region, endpoint } = snsUrl.parse(input.connectionString);
	const params = new URL(input.connectionString).searchParams;
	const accessKeyId = params.get('accessKeyId');
	const secretAccessKey = params.get('secretAccessKey');
	// The topic's own region, read off its ARN where the string names none.
	const where = region ?? topicArn.split(':')[3];

	let credentials: SNSConnectionCredentials | undefined;
	if (accessKeyId && secretAccessKey) {
		const sessionToken = params.get('sessionToken');
		credentials = {
			accessKeyId,
			secretAccessKey,
			...(sessionToken ? { sessionToken } : {}),
		};
	} else {
		const provisioning = await awsProvisioningCredentials({
			stage: input.stage,
			env: input.env,
			...(input.home ? { home: input.home } : {}),
		});
		if (!provisioning) throw new TopicSubscriptionUnsigned(input.connectionKey);
		credentials = (await awsClientConfig(provisioning, where ?? 'us-east-1'))
			.credentials;
	}

	const override = endpoint ?? awsEndpoint(input.env, 'SNS');
	return new SNSConnection({
		topicArn,
		...(where ? { region: where } : {}),
		...(override ? { endpoint: override } : {}),
		...(credentials ? { credentials } : {}),
	});
}

type SNSConnectionCredentials = NonNullable<
	ConstructorParameters<typeof SNSConnection>[0]['credentials']
>;

/** A subscription still waiting to be confirmed once its worker is up. */
export class PushSubscriptionsUnconfirmed extends GkmError {
	constructor(readonly endpoints: readonly string[]) {
		super(
			`SNS still waits for ${endpoints.join(', ')} to confirm ${endpoints.length === 1 ? 'its subscription' : 'their subscriptions'}, ` +
				`so nothing is pushed there yet. Check the worker's logs for the ` +
				`confirmation it refused, and that its host answers from the internet; ` +
				`the next deploy sends the confirmation again.`,
		);
		this.name = 'PushSubscriptionsUnconfirmed';
	}
}

/**
 * Once the workers are up: every subscription recorded as pending is
 * subscribed again — SNS resends its confirmation to a worker now there to
 * answer it — and waited on until confirmed.
 *
 * The first deploy needs it: the subscription is made before the worker
 * starts, so SNS's first confirmation finds nobody.
 *
 * A bucket's subscriptions are reached with the deploy's provisioning
 * credentials; a hand-set topic's with the connection string they were made
 * with, read from the stage's secrets.
 *
 * @returns what is still pending when the wait ran out — none, normally.
 */
export async function confirmPendingSubscriptions(input: {
	workspace: NormalizedWorkspace;
	stage: string;
	resources: Readonly<Record<string, ResourceRecord>> | undefined;
	/** The stage's secrets — a hand-set topic's connection string. */
	secrets?: Readonly<Record<string, string>>;
	env?: NodeJS.ProcessEnv;
	home?: string;
	/** How long to wait for confirmations, in milliseconds. */
	timeoutMs?: number;
	record?: (record: ResourceRecord) => Promise<void>;
	log?: (line: string) => void;
}): Promise<string[]> {
	const env = input.env ?? process.env;
	const records = Object.values(input.resources ?? {}).filter(
		(r) => r.type === SUBSCRIPTION_TYPE && r.id,
	);
	if (!records.some((r) => r.data?.pending === true)) return [];

	const { SNSConnection, reconcileHttpSubscriptions } = await import(
		'@geekmidas/events/sns'
	);
	const { GetSubscriptionAttributesCommand } = await import(
		'@aws-sdk/client-sns'
	);
	const endpoint = awsEndpoint(env, 'SNS');
	let provisioning: AwsProvisioning | undefined | null = null;

	// Every subscription to the same topic on the same host, not only the
	// pending ones: the reconcile removes what it is not handed.
	const groups = new Map<string, ResourceRecord[]>();
	for (const record of records) {
		const host = new URL(String(record.data?.endpoint)).host;
		const group = `${record.data?.topicArn}|${host}`;
		groups.set(group, [...(groups.get(group) ?? []), record]);
	}

	const left: string[] = [];
	for (const [group, members] of groups) {
		const pending = members.filter((r) => r.data?.pending === true);
		if (pending.length === 0) continue;
		const [topicArn, host] = group.split('|') as [string, string];
		const unreachable = () =>
			left.push(...pending.map((r) => String(r.data?.endpoint)));

		let connection: SNSConnection;
		const connectionKey = members[0]!.data?.connectionKey;
		if (typeof connectionKey === 'string') {
			const connectionString = input.secrets?.[connectionKey];
			if (!connectionString?.startsWith('sns:')) {
				unreachable();
				continue;
			}
			connection = await topicConnection({
				connectionKey,
				connectionString,
				stage: input.stage,
				env,
				...(input.home ? { home: input.home } : {}),
			});
		} else {
			if (provisioning === null) {
				provisioning = await awsProvisioningCredentials({
					stage: input.stage,
					env,
					...(input.home ? { home: input.home } : {}),
				});
			}
			if (!provisioning) {
				unreachable();
				continue;
			}
			// The topic's own region, read off its ARN: a bucket may be elsewhere.
			const region = topicArn.split(':')[3]!;
			const { credentials } = await awsClientConfig(provisioning, region);
			connection = new SNSConnection({
				topicArn,
				region,
				...(endpoint ? { endpoint } : {}),
				...(credentials ? { credentials } : {}),
			});
		}

		await reconcileHttpSubscriptions(connection, {
			endpoints: members.map(specOf),
			ownedHost: host,
		});

		const deadline = Date.now() + (input.timeoutMs ?? 60_000);
		for (const record of pending) {
			let confirmed = false;
			while (!confirmed) {
				const { Attributes = {} } = await connection.snsClient.send(
					new GetSubscriptionAttributesCommand({
						SubscriptionArn: record.id!,
					}),
				);
				confirmed = Attributes.PendingConfirmation !== 'true';
				if (confirmed || Date.now() > deadline) break;
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
			if (confirmed) {
				input.log?.(`   ✓ ${record.data?.endpoint} confirmed its subscription`);
				await input.record?.({
					...record,
					data: { ...record.data, pending: false },
				});
			} else {
				left.push(String(record.data?.endpoint));
			}
		}
		await connection.close();
	}
	return left;
}
