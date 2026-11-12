import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	CreateTopicCommand,
	GetSubscriptionAttributesCommand,
	ListSubscriptionsByTopicCommand,
	SNSClient,
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
import {
	confirmPendingSubscriptions,
	ProvisionedTopicUnsigned,
	TOPIC_TYPE,
	topicConnection,
} from '../../../deploy/snsSubscriptions';
import { createComposeState } from '../../../deploy/state';
import { secretsStoreFor } from '../../../secrets/store';
import type { NormalizedWorkspace } from '../../../workspace/types';
import { composeTarget } from '../index';

/**
 * A topic the stage's providers made — an SES inbox's — whose connection
 * string is signed with the app's own key. That key may only confirm a
 * subscription (#511), so the deploy subscribes the worker's routes with
 * its own credentials, as it does a bucket's.
 *
 * floci does not enforce IAM, but it does put a 12-digit access key in an
 * account of that number: a key from another account cannot see the topic,
 * so it stands in for the app's key here. Subscribing with it fails the
 * deploy with `Topic does not exist`, as AWS fails it with
 * `AuthorizationErrorException`.
 */

const REGION = 'eu-west-1';
const STAGE = 'production';
const DOMAIN = 'mail.example.com';
const KEY = 'ALERTS_PUBLISHER_CONNECTION_STRING';
/** The app's key: from an account that cannot manage the topic. */
const APP_KEY = '111111111111';

const sns = new SNSClient({
	region: REGION,
	endpoint: LOCALSTACK_URL,
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

let dir: string;
let home: string;
let workspace: NormalizedWorkspace;
let topicArn: string;

/** The topic's string as `ensureEventsKey` writes it: the app's key. */
function connectionString(arn: string): string {
	const url = new URL(snsUrl.build({ topicArn: arn, region: REGION }));
	url.searchParams.set('accessKeyId', APP_KEY);
	url.searchParams.set('secretAccessKey', 'app-secret');
	return url.toString();
}

async function stateStore() {
	return createStateStore({
		config: workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
	});
}

async function resources() {
	return (await (await stateStore()).read(STAGE))?.resources ?? {};
}

async function subscriptions(arn = topicArn) {
	const { Subscriptions = [] } = await sns.send(
		new ListSubscriptionsByTopicCommand({ TopicArn: arn }),
	);
	return Subscriptions.filter((s) => s.SubscriptionArn?.startsWith('arn:'));
}

/** One compose deploy of the stage, with nothing but SNS real. */
async function deployStage() {
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
				confirmSubscriptions: async () => [],
			}),
		},
	});
	for await (const _ of run);
	await run.result;
	return readFileSync(join(dir, '.gkm', 'compose', STAGE, 'jobs.env'), 'utf-8');
}

const handed = (env: string): Record<string, string> =>
	JSON.parse(/^GKM_SNS_SUBSCRIPTIONS=(.*)$/m.exec(env)?.[1] ?? '{}');

beforeAll(async () => {
	// The deploy's own credentials: floci's default account.
	vi.stubEnv('AWS_ENDPOINT_URL', LOCALSTACK_URL);
	vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
	vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
	vi.stubEnv('AWS_REGION', REGION);
	vi.stubEnv('AWS_PROFILE', undefined);

	dir = realpathSync(await createTempDir('gkm-compose-owned-topic-'));
	home = realpathSync(await createTempDir('gkm-compose-owned-home-'));
	vi.stubEnv('GKM_HOME', home);
	const name = `otp-${Date.now().toString(36)}`;
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
	events: { 'alert.raised': z.object({ id: z.string() }) },
});
`,
	);
	writeFileSync(
		join(dir, 'apps', 'api', 'queues', 'alerts.ts'),
		`import { alerts } from '../../../constructs/topics.js';
import { worker } from '../../../constructs/worker.js';

export const onAlert = worker
	.topic(alerts)
	.subscribe(['alert.raised'])
	.handle(async () => {});
`,
	);
	({ workspace } = await loadWorkspaceConfig(dir));

	const { TopicArn } = await sns.send(
		new CreateTopicCommand({ Name: `${name}-inbound` }),
	);
	topicArn = TopicArn!;
	await serveFrom(dir, STAGE, undefined, home);

	// What the `ses` provider leaves behind before the compose target runs:
	// the topic, recorded as the stage's, and its string, signed by the app.
	const state = await stateStore();
	await state.write(STAGE, createComposeState(STAGE), {
		expectedVersion: null,
	});
	await state.putResource(STAGE, {
		key: `${TOPIC_TYPE}:Alerts`,
		type: TOPIC_TYPE,
		id: topicArn,
		status: 'ready',
	});
	const store = await secretsStoreFor(workspace, STAGE, { home });
	const stored = (await store.read(STAGE))!;
	await store.write(STAGE, {
		...stored,
		custom: { ...stored.custom, [KEY]: connectionString(topicArn) },
	});
}, 120_000);

afterAll(async () => {
	vi.unstubAllEnvs();
	await cleanupDir(dir);
	await cleanupDir(home);
});

describe('a compose stage whose topic its providers made', () => {
	it('subscribes the worker’s routes with the deploy’s credentials, not the app’s key', async () => {
		const env = await deployStage();

		const onAlert = (await resources())['sns-subscription:Jobs/onAlert']!;
		expect(onAlert.data).toMatchObject({
			worker: 'Jobs',
			topicArn,
			endpoint: `https://jobs.${DOMAIN}/__gkm/subscribers/onAlert`,
			connectionKey: KEY,
		});
		expect(handed(env)).toEqual({ onAlert: onAlert.id });
		// The app is still handed its own key: it confirms with it.
		expect(env).toContain(`${KEY}=${connectionString(topicArn)}`);
		expect((await subscriptions()).map((s) => s.Endpoint)).toEqual([
			`https://jobs.${DOMAIN}/__gkm/subscribers/onAlert`,
		]);
	}, 120_000);

	it('changes nothing on a second run', async () => {
		const before = (await resources())['sns-subscription:Jobs/onAlert']!;
		const env = await deployStage();

		expect(handed(env)).toEqual({ onAlert: before.id });
		expect(await subscriptions()).toHaveLength(1);
	}, 120_000);

	it('resends a pending confirmation with the deploy’s credentials', async () => {
		const recorded = await resources();
		const onAlert = recorded['sns-subscription:Jobs/onAlert']!;
		const pending = {
			...recorded,
			[onAlert.key]: { ...onAlert, data: { ...onAlert.data, pending: true } },
		};

		// floci confirms nothing: there is no worker to answer it. Reached
		// with the app's key, the topic would not be found at all.
		const left = await confirmPendingSubscriptions({
			workspace,
			stage: STAGE,
			resources: pending,
			secrets: { [KEY]: connectionString(topicArn) },
			home,
			timeoutMs: 0,
		});
		expect(left).toEqual([onAlert.data?.endpoint]);
		const { Attributes = {} } = await sns.send(
			new GetSubscriptionAttributesCommand({ SubscriptionArn: onAlert.id }),
		);
		expect(JSON.parse(Attributes.FilterPolicy ?? '{}')).toEqual({
			type: ['alert.raised'],
		});
	}, 60_000);
});

describe('topicConnection', () => {
	it('signs a topic the stage made with the deploy’s credentials', async () => {
		const connection = await topicConnection({
			connectionKey: KEY,
			connectionString: connectionString(topicArn),
			stage: STAGE,
			env: process.env,
			home,
			provisioned: true,
		});
		const credentials = await connection.snsClient.config.credentials();
		expect(credentials.accessKeyId).toBe('test');
		await connection.close();
	});

	it('signs a hand-set topic with its own string’s keys', async () => {
		const connection = await topicConnection({
			connectionKey: KEY,
			connectionString: connectionString(topicArn),
			stage: STAGE,
			env: process.env,
			home,
		});
		const credentials = await connection.snsClient.config.credentials();
		expect(credentials.accessKeyId).toBe(APP_KEY);
		await connection.close();
	});

	it('refuses a topic the stage made when the deploy has no credentials', async () => {
		const empty = realpathSync(await createTempDir('gkm-owned-no-creds-'));
		// Nothing for the SDK's own chain to find either.
		vi.stubEnv('AWS_ACCESS_KEY_ID', undefined);
		vi.stubEnv('AWS_SECRET_ACCESS_KEY', undefined);
		vi.stubEnv('AWS_CONFIG_FILE', join(empty, 'config'));
		vi.stubEnv('AWS_SHARED_CREDENTIALS_FILE', join(empty, 'credentials'));
		vi.stubEnv('AWS_EC2_METADATA_DISABLED', 'true');
		try {
			await expect(
				topicConnection({
					connectionKey: KEY,
					connectionString: connectionString(topicArn),
					stage: STAGE,
					env: {},
					home: empty,
					provisioned: true,
				}),
			).rejects.toBeInstanceOf(ProvisionedTopicUnsigned);
		} finally {
			vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
			vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
			await cleanupDir(empty);
		}
	});
});
