/**
 * The SNS subscriptions a compose deploy makes for a topic whose connection
 * string the stage set by hand.
 *
 * On a compose stage a topic is pg-boss unless the stage says otherwise; one
 * that names an SNS topic is the stage's own, made somewhere this deploy does
 * not provision. Its subscribers are still pushed to — the worker answers on
 * its host — and the worker cannot subscribe itself, so the deploy does: with
 * the connection string's own keys, one subscription per subscriber, filtered
 * on the event types it names, each ARN recorded for the worker to accept
 * deliveries under. A bucket's subscriptions are the `s3` provider's.
 */

import type { ConstructManifest } from '@geekmidas/manifest';
import { provideKey } from '@geekmidas/manifest';
import type { ComposeStack } from '../../compose/stack.js';
import type { ResourceInput, ResourceRecord } from '../../deploy/StateStore.js';
import {
	SUBSCRIPTION_TYPE,
	subscriptionKey,
	subscriptionResource,
	topicConnection,
} from '../../deploy/snsSubscriptions.js';

/** One topic subscriber SNS pushes to, as the deploy subscribes it. */
export interface TopicPush {
	/** The worker's construct id — what its subscriptions are recorded under. */
	worker: string;
	/** The subscriber's export. */
	name: string;
	/** `https://<worker host>/__gkm/subscribers/<name>` */
	endpoint: string;
	/** The topic's connection string's key, and its value on this stage. */
	connectionKey: string;
	connectionString: string;
	/** The event types it names: its subscription's filter. */
	events?: readonly string[];
}

/**
 * Every topic subscriber the stack pushes to: a subscriber whose connection
 * key is a topic's publisher string — a bucket's events key is not — and
 * whose value on this stage is an SNS one.
 */
export function topicPushes(
	stack: Pick<ComposeStack, 'workers'>,
	manifest: ConstructManifest,
): TopicPush[] {
	const topicKeys = new Set(
		Object.values(manifest)
			.filter((declaration) => declaration.kind === 'topic')
			.map((topic) => provideKey(topic.id, 'publisherConnectionString')),
	);

	const pushes: TopicPush[] = [];
	for (const worker of stack.workers) {
		for (const subscriber of worker.push?.subscribers ?? []) {
			if (!topicKeys.has(subscriber.connectionKey)) continue;
			const connectionString = worker.env?.[subscriber.connectionKey];
			if (!connectionString?.startsWith('sns:')) continue;
			pushes.push({
				worker: worker.id,
				name: subscriber.name,
				endpoint: subscriber.endpoint,
				connectionKey: subscriber.connectionKey,
				connectionString,
				...(subscriber.events ? { events: subscriber.events } : {}),
			});
		}
	}
	return pushes;
}

/** The subscriptions recorded for hand-set topics: those with a key. */
export function recordedTopicSubscriptions(
	resources: Readonly<Record<string, ResourceRecord>> | undefined,
): ResourceRecord[] {
	return Object.values(resources ?? {}).filter(
		(record) =>
			record.type === SUBSCRIPTION_TYPE &&
			typeof record.data?.connectionKey === 'string',
	);
}

/**
 * Converge each hand-set topic's subscriptions on the subscribers pushed to:
 * subscribe, bring filters up to date, unsubscribe a route on the worker's
 * host no subscriber wants any more — and record each ARN, forgetting what
 * was removed.
 *
 * @returns each worker's subscriptions, by export — what it is handed
 */
export async function ensureTopicSubscriptions(input: {
	pushes: readonly TopicPush[];
	recorded: Readonly<Record<string, ResourceRecord>> | undefined;
	/** The stage's secrets: a topic only removed subscribers still name. */
	secrets: Readonly<Record<string, string>>;
	stage: string;
	env: NodeJS.ProcessEnv;
	record: (resource: ResourceInput) => Promise<void>;
	forget: (key: string) => Promise<void>;
	log: (line: string) => void;
}): Promise<Record<string, Record<string, string>>> {
	const { snsUrl, reconcileHttpSubscriptions } = await import(
		'@geekmidas/events/sns'
	);

	// One reconcile per topic and worker host: what it is not handed on that
	// host is unsubscribed, so it is handed every subscriber there.
	type Group = {
		topicArn: string;
		host: string;
		connectionKey: string;
		connectionString?: string;
		pushes: TopicPush[];
		recorded: ResourceRecord[];
	};
	const groups = new Map<string, Group>();
	const group = (
		topicArn: string,
		host: string,
		connectionKey: string,
	): Group => {
		const id = `${topicArn}|${host}`;
		const found = groups.get(id);
		if (found) return found;
		const created: Group = {
			topicArn,
			host,
			connectionKey,
			pushes: [],
			recorded: [],
		};
		groups.set(id, created);
		return created;
	};

	for (const push of input.pushes) {
		const { topicArn } = snsUrl.parse(push.connectionString);
		const into = group(
			topicArn,
			new URL(push.endpoint).host,
			push.connectionKey,
		);
		into.connectionString = push.connectionString;
		into.pushes.push(push);
	}
	for (const record of recordedTopicSubscriptions(input.recorded)) {
		group(
			String(record.data?.topicArn),
			new URL(String(record.data?.endpoint)).host,
			String(record.data?.connectionKey),
		).recorded.push(record);
	}

	const wanted = new Set(
		input.pushes.map(({ worker, name }) => subscriptionKey(worker, name)),
	);
	const arns: Record<string, Record<string, string>> = {};
	for (const { topicArn, host, connectionKey, ...members } of groups.values()) {
		// Forgotten only when no subscriber wants the key on any topic: one
		// the stage moved to another topic is recorded again there.
		const stale = members.recorded.filter((r) => !wanted.has(r.key));

		// A topic only removed subscribers name is reached as the stage now
		// names it, at the topic they were subscribed to.
		const named = members.connectionString ?? input.secrets[connectionKey];
		if (!named?.startsWith('sns:')) {
			for (const record of stale) {
				input.log(
					`   – forgot ${record.data?.endpoint}: '${connectionKey}' no longer names an SNS topic to unsubscribe it from`,
				);
				await input.forget(record.key);
			}
			continue;
		}
		const address = new URL(named);
		address.searchParams.set('topicArn', topicArn);

		const connection = await topicConnection({
			connectionKey,
			connectionString: address.toString(),
			stage: input.stage,
			env: input.env,
		});
		const result = await reconcileHttpSubscriptions(connection, {
			endpoints: members.pushes.map((push) => ({
				name: push.name,
				endpoint: push.endpoint,
				...(push.events ? { events: push.events } : {}),
			})),
			ownedHost: host,
		});
		await connection.close();

		for (const push of members.pushes) {
			const arn = result.subscriptions[push.name]!;
			const key = subscriptionKey(push.worker, push.name);
			if (input.recorded?.[key]?.id !== arn) {
				input.log(
					`   ✓ '${push.name}' subscribed to ${topicArn.split(':').pop()} at ${push.endpoint}`,
				);
			}
			await input.record(
				subscriptionResource(
					{
						worker: push.worker,
						name: push.name,
						topicArn,
						endpoint: push.endpoint,
						connectionKey: push.connectionKey,
						pending: result.pending.includes(push.name),
						...(push.events ? { events: push.events } : {}),
					},
					arn,
				),
			);
			arns[push.worker] = { ...arns[push.worker], [push.name]: arn };
		}
		for (const arn of result.removed) {
			input.log(`   – unsubscribed ${arn}: no subscriber wants it any more`);
		}
		for (const record of stale) await input.forget(record.key);
	}
	return arns;
}
