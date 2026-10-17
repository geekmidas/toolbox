import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	CreateTopicCommand,
	GetSubscriptionAttributesCommand,
	ListSubscriptionsByTopicCommand,
	SNSClient,
	SubscribeCommand,
} from '@aws-sdk/client-sns';
import { snsUrl } from '@geekmidas/events/sns';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LOCALSTACK_URL } from '../../../../../testkit/test/ports';
import { cleanupDir, createTempDir } from '../../../__tests__/test-helpers';
import {
	resolvesHere,
	serveFrom,
	writeComposeApp,
} from '../../../compose/__tests__/__helpers__/composeApp';
import {
	answering,
	fakeDocker,
	fakeServer,
} from '../../../compose/__tests__/__helpers__/fakeDocker';
import { loadWorkspaceConfig } from '../../../config';
import { deploy } from '../../../deploy/deploy';
import { createStateStore } from '../../../deploy/StateStore';
import { confirmPendingSubscriptions } from '../../../deploy/snsSubscriptions';
import { secretsStoreFor } from '../../../secrets/store';
import type { NormalizedWorkspace } from '../../../workspace/types';
import { composeTarget } from '../index';

/**
 * A topic a compose stage set to SNS by hand: the deploy subscribes each of
 * its subscribers' routes on the worker's host, and the worker is handed the
 * ARNs — it never subscribes against SNS itself, so without this it would
 * mount no route and the stack would refuse to compose.
 *
 * floci stands in for SNS the way it does for every provider: the
 * environment points the SDK at it, and the connection string names no
 * `endpoint`, which is what makes it SNS rather than an emulator to the
 * worker.
 */

const REGION = 'eu-west-1';
const STAGE = 'production';
const DOMAIN = 'shop.example.com';
const KEY = 'ALERTS_PUBLISHER_CONNECTION_STRING';

const sns = new SNSClient({
	region: REGION,
	endpoint: LOCALSTACK_URL,
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

let dir: string;
let home: string;
let workspace: NormalizedWorkspace;
let topicArn: string;

/** The stage's own topic, as `gkm secrets:set` stores it: keys, no endpoint. */
function connectionString(arn: string): string {
	const url = new URL(snsUrl.build({ topicArn: arn, region: REGION }));
	url.searchParams.set('accessKeyId', 'test');
	url.searchParams.set('secretAccessKey', 'test');
	return url.toString();
}

async function setSecret(key: string, value: string): Promise<void> {
	const store = await secretsStoreFor(workspace, STAGE, { home });
	const stored = (await store.read(STAGE))!;
	await store.write(STAGE, {
		...stored,
		custom: { ...stored.custom, [key]: value },
	});
}

async function resources() {
	const store = await createStateStore({
		config: workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
	});
	return (await store.read(STAGE))?.resources ?? {};
}

async function subscriptions(arn = topicArn) {
	const { Subscriptions = [] } = await sns.send(
		new ListSubscriptionsByTopicCommand({ TopicArn: arn }),
	);
	return Subscriptions.filter((s) => s.SubscriptionArn?.startsWith('arn:'));
}

/** Write the subscribers the worker runs, replacing what was there. */
function subscribe(names: readonly string[]): void {
	writeFileSync(
		join(dir, 'apps', 'api', 'queues', 'alerts.ts'),
		`import { alerts } from '../../../constructs/topics.js';
import { worker } from '../../../constructs/worker.js';
${names
	.map(
		(name) => `
export const ${name} = worker
	.topic(alerts)
	.subscribe(['alert.raised'])
	.handle(async () => {});
`,
	)
	.join('')}`,
	);
}

/** One compose deploy of the stage, with nothing but SNS real. */
async function deployStage() {
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
	for await (const _ of run);
	await run.result;
	const env = readFileSync(
		join(dir, '.gkm', 'compose', STAGE, 'jobs.env'),
		'utf-8',
	);
	return { asked, env };
}

const handed = (env: string): Record<string, string> =>
	JSON.parse(/^GKM_SNS_SUBSCRIPTIONS=(.*)$/m.exec(env)?.[1] ?? '{}');

beforeAll(async () => {
	// The stage's backups are provisioned on floci too, with these.
	vi.stubEnv('AWS_ENDPOINT_URL', LOCALSTACK_URL);
	vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
	vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
	vi.stubEnv('AWS_REGION', REGION);
	vi.stubEnv('AWS_PROFILE', undefined);

	dir = realpathSync(await createTempDir('gkm-compose-topic-subs-'));
	home = realpathSync(await createTempDir('gkm-compose-topic-home-'));
	vi.stubEnv('GKM_HOME', home);
	const name = `tps-${Date.now().toString(36)}`;
	writeComposeApp(dir, {
		name,
		target: 'compose',
		domain: DOMAIN,
		deployed: [STAGE],
		domains: { [STAGE]: DOMAIN },
	});
	writeFileSync(
		join(dir, 'constructs', 'topics.ts'),
		`import { Topic } from '@geekmidas/constructs/topic';
import { z } from 'zod';

export const alerts = new Topic('Alerts', {
	events: {
		'alert.raised': z.object({ id: z.string() }),
		'alert.cleared': z.object({ id: z.string() }),
	},
});
`,
	);
	subscribe(['onAlert', 'onAlertAudit']);
	({ workspace } = await loadWorkspaceConfig(dir));

	const { TopicArn } = await sns.send(
		new CreateTopicCommand({ Name: `${name}-alerts` }),
	);
	topicArn = TopicArn!;
	await serveFrom(dir, STAGE, undefined, home);
	await setSecret(KEY, connectionString(topicArn));
}, 120_000);

afterAll(async () => {
	vi.unstubAllEnvs();
	await cleanupDir(dir);
	await cleanupDir(home);
});

describe('a compose stage whose topic is set to SNS by hand', () => {
	it('subscribes each subscriber at its route on the worker’s host, and hands the worker the ARNs', async () => {
		const { asked, env } = await deployStage();

		const recorded = await resources();
		const onAlert = recorded['sns-subscription:Jobs/onAlert']!;
		const audit = recorded['sns-subscription:Jobs/onAlertAudit']!;
		expect(onAlert.data).toMatchObject({
			worker: 'Jobs',
			topicArn,
			endpoint: `https://jobs.${DOMAIN}/__gkm/subscribers/onAlert`,
			connectionKey: KEY,
			events: ['alert.raised'],
		});
		expect(handed(env)).toEqual({
			onAlert: onAlert.id,
			onAlertAudit: audit.id,
		});
		expect(env).toContain(`${KEY}=${connectionString(topicArn)}`);

		// Filtered on the `type` attribute the topic's publisher sets.
		const { Attributes = {} } = await sns.send(
			new GetSubscriptionAttributesCommand({ SubscriptionArn: onAlert.id }),
		);
		expect(JSON.parse(Attributes.FilterPolicy ?? '{}')).toEqual({
			type: ['alert.raised'],
		});
		expect(Attributes.FilterPolicyScope).toBe('MessageAttributes');

		// Once the workers answered, these are confirmed with the secrets the
		// topic's string is read from.
		expect(asked).toHaveLength(1);
		expect(asked[0]?.secrets?.[KEY]).toBe(connectionString(topicArn));
		expect(asked[0]?.resources?.['sns-subscription:Jobs/onAlert']?.id).toBe(
			onAlert.id,
		);
	}, 120_000);

	it('resends a pending confirmation with the topic’s own keys, keeping its filter', async () => {
		const recorded = await resources();
		const onAlert = recorded['sns-subscription:Jobs/onAlert']!;
		// floci confirms nothing: there is no worker to answer it.
		const pending = { ...recorded };
		pending[onAlert.key] = {
			...onAlert,
			data: { ...onAlert.data, pending: true },
		};

		const left = await confirmPendingSubscriptions({
			workspace,
			stage: STAGE,
			resources: pending,
			secrets: { [KEY]: connectionString(topicArn) },
			timeoutMs: 0,
		});
		expect(left).toContain(onAlert.data?.endpoint);
		const { Attributes = {} } = await sns.send(
			new GetSubscriptionAttributesCommand({ SubscriptionArn: onAlert.id }),
		);
		expect(JSON.parse(Attributes.FilterPolicy ?? '{}')).toEqual({
			type: ['alert.raised'],
		});

		// Without the topic's string there is nothing to reach it with.
		expect(
			await confirmPendingSubscriptions({
				workspace,
				stage: STAGE,
				resources: pending,
				secrets: {},
				timeoutMs: 0,
			}),
		).toContain(onAlert.data?.endpoint);
	}, 60_000);

	it('changes nothing on a second run', async () => {
		const before = await resources();
		const { env } = await deployStage();

		expect(handed(env)).toEqual({
			onAlert: before['sns-subscription:Jobs/onAlert']!.id,
			onAlertAudit: before['sns-subscription:Jobs/onAlertAudit']!.id,
		});
		expect(await subscriptions()).toHaveLength(2);
	}, 120_000);

	it('unsubscribes a subscriber that is gone, and forgets it', async () => {
		// Somebody else's subscription on another host is not ours to remove.
		await sns.send(
			new SubscribeCommand({
				TopicArn: topicArn,
				Protocol: 'https',
				Endpoint: 'https://elsewhere.example.com/hook',
			}),
		);
		subscribe(['onAlert']);
		const { env } = await deployStage();

		const recorded = await resources();
		expect(recorded).not.toHaveProperty('sns-subscription:Jobs/onAlertAudit');
		expect(Object.keys(handed(env))).toEqual(['onAlert']);
		const endpoints = (await subscriptions()).map((s) => s.Endpoint).sort();
		expect(endpoints).toContain(
			`https://jobs.${DOMAIN}/__gkm/subscribers/onAlert`,
		);
		expect(endpoints).not.toContain(
			`https://jobs.${DOMAIN}/__gkm/subscribers/onAlertAudit`,
		);
	}, 120_000);

	it('moves the subscriptions when the stage names another topic', async () => {
		const old = topicArn;
		const { TopicArn } = await sns.send(
			new CreateTopicCommand({ Name: `${old.split(':').pop()}-next` }),
		);
		await setSecret(KEY, connectionString(TopicArn!));
		const { env } = await deployStage();

		const onAlert = (await resources())['sns-subscription:Jobs/onAlert']!;
		expect(onAlert.data?.topicArn).toBe(TopicArn);
		expect(handed(env)).toEqual({ onAlert: onAlert.id });
		expect((await subscriptions(TopicArn)).map((s) => s.Endpoint)).toContain(
			`https://jobs.${DOMAIN}/__gkm/subscribers/onAlert`,
		);
		topicArn = TopicArn!;
	}, 120_000);
});
