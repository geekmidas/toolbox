import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GetBucketPolicyCommand, S3Client } from '@aws-sdk/client-s3';
import {
	DescribeActiveReceiptRuleSetCommand,
	DescribeReceiptRuleSetCommand,
	SESClient,
} from '@aws-sdk/client-ses';
import { GetTopicAttributesCommand, SNSClient } from '@aws-sdk/client-sns';
import type { ConstructManifest } from '@geekmidas/manifest';
import * as s3Url from '@geekmidas/storage/s3-url';
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
import { writeComposeApp } from '../../compose/__tests__/__helpers__/composeApp';
import { loadWorkspaceConfig } from '../../config';
import { createStateStore } from '../../deploy/StateStore';
import { type BoundSubscriber, discover } from '../../reconcile/discover';
import { constructGlobs } from '../../reconcile/workspace';
import { secretsStoreFor } from '../../secrets/store';
import type { NormalizedWorkspace } from '../../workspace/types';
import { provisionStage } from '../index';
import { SesReceivingUnsupported } from '../ses/errors';
import { receiptRuleName, sesProvider } from '../ses/index';

/**
 * An inbox on a deployed stage whose `deploy.inbox` names `ses`, against the
 * AWS emulator: its own bucket and key, its topic and that topic's signed
 * address, the domain's DKIM and MX records, and a receipt rule in the
 * region's active rule set — all real calls, and a removed inbox's rule
 * deleted on the next run.
 *
 * The domain has no `dns` config, so its records come back as what to
 * create by hand: the DNS layer's own path, asserted by its own specs.
 */

const REGION = 'eu-west-1';
const STAGE = 'production';
const DOMAIN = 'fixwell.example';

const admin = {
	region: REGION,
	endpoint: LOCALSTACK_URL,
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
};
const s3 = new S3Client({ ...admin, forcePathStyle: true });
const sns = new SNSClient(admin);
const ses = new SESClient(admin);

let dir: string;
let home: string;
let name: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let subscribers: Record<string, BoundSubscriber[]>;
const lines: string[] = [];

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

async function rules() {
	const active = await ses.send(new DescribeActiveReceiptRuleSetCommand({}));
	const set = await ses.send(
		new DescribeReceiptRuleSetCommand({ RuleSetName: active.Metadata!.Name! }),
	);
	return set.Rules ?? [];
}

beforeAll(async () => {
	vi.stubEnv('AWS_ENDPOINT_URL', LOCALSTACK_URL);
	vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
	vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
	vi.stubEnv('AWS_REGION', REGION);
	vi.stubEnv('AWS_PROFILE', undefined);

	dir = realpathSync(await createTempDir('gkm-provider-ses-'));
	home = realpathSync(await createTempDir('gkm-provider-home-'));
	vi.stubEnv('GKM_HOME', home);
	name = `inb-${Date.now().toString(36)}`;
	writeComposeApp(dir, {
		name,
		target: 'compose',
		domain: DOMAIN,
		deployed: [STAGE],
		domains: { [STAGE]: DOMAIN },
		deployInbox: { [STAGE]: { provider: 'ses', region: REGION } },
	});
	writeFileSync(
		join(dir, 'constructs', 'inbox.ts'),
		`import { Inbox } from '@geekmidas/constructs/inbox';

export const requests = new Inbox('Requests', { addresses: ['requests'], subdomains: true });
`,
	);
	writeFileSync(
		join(dir, 'apps', 'api', 'queues', 'requests.ts'),
		`import { worker } from '../../../constructs/worker.js';
import { requests } from '../../../constructs/inbox.js';

export const onRequest = worker.inbox(requests).handle(async () => {});
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

describe('the ses provider', { timeout: 120_000 }, () => {
	it('creates the inbox: its bucket, its topic, the domain and a receipt rule', async () => {
		await provision();

		const secrets = await secretsOf();
		// Its own bucket, reached by a key of its own.
		const url = s3Url.parse(secrets.REQUESTS_URL!);
		expect(url.bucket).toContain('requests-mail');
		expect(url.accessKeyId).toBeTruthy();
		// The topic's signed address — what its subscribers are pushed from.
		const topic = secrets.REQUESTS_MAIL_PUBLISHER_CONNECTION_STRING!;
		expect(topic).toMatch(/^sns:\/\//);
		const topicArn = new URL(topic).searchParams.get('topicArn') ?? '';

		// SES alone publishes to the topic, and writes only under messages/.
		const attributes = await sns.send(
			new GetTopicAttributesCommand({
				TopicArn:
					topicArn ||
					`arn:aws:sns:${REGION}:000000000000:gkm-${name}-${STAGE}-requests-mail`,
			}),
		);
		expect(JSON.parse(attributes.Attributes!.Policy!).Statement).toEqual([
			expect.objectContaining({
				Principal: { Service: 'ses.amazonaws.com' },
				Action: 'sns:Publish',
			}),
		]);
		const policy = await s3.send(
			new GetBucketPolicyCommand({ Bucket: url.bucket }),
		);
		expect(JSON.parse(policy.Policy!).Statement).toContainEqual(
			expect.objectContaining({
				Sid: 'GkmSesWritesMail',
				Principal: { Service: 'ses.amazonaws.com' },
				Action: 's3:PutObject',
				Resource: `arn:aws:s3:::${url.bucket}/messages/*`,
			}),
		);

		// The rule: every tenant's subdomain, stored and announced.
		const rule = (await rules()).find(
			(r) => r.Name === receiptRuleName(name, STAGE, 'Requests'),
		);
		expect(rule).toMatchObject({
			Enabled: true,
			Recipients: [`.${DOMAIN}`],
			Actions: [
				{
					S3Action: {
						BucketName: url.bucket,
						ObjectKeyPrefix: 'messages/',
					},
				},
			],
		});

		// The domain's records, through the stage's DNS — by hand here.
		expect(lines.join('\n')).toContain(
			`*.${DOMAIN} MX 10 inbound-smtp.${REGION}.amazonaws.com`,
		);
		expect(lines.join('\n')).toMatch(/_domainkey\.fixwell\.example CNAME /);
	});

	it('changes nothing on a second run', async () => {
		await provision();

		expect(lines.join('\n')).not.toMatch(/SES receipt rule .* create/);
		expect(lines.join('\n')).not.toMatch(/receive at /);
	});

	it("deletes a removed inbox's rule on the next run, and nothing else", async () => {
		const ruleName = receiptRuleName(name, STAGE, 'Requests');
		const without = Object.fromEntries(
			Object.entries(manifest).filter(
				([, d]) =>
					d.kind !== 'inbox' &&
					!(d.kind === 'topic' && d.id === 'RequestsMail'),
			),
		) as ConstructManifest;
		const other = (await rules()).filter((r) => r.Name !== ruleName);

		await provision({ manifest: without });

		const after = await rules();
		expect(after.map((r) => r.Name)).not.toContain(ruleName);
		expect(after.map((r) => r.Name)).toEqual(other.map((r) => r.Name));
	});

	it('refuses a region SES does not receive mail in, naming the ones it does', async () => {
		const refused = sesProvider.verify({
			workspace,
			manifest,
			stage: STAGE,
			config: { provider: 'ses', region: 'eu-central-2' },
			secrets: {},
		});

		await expect(refused).rejects.toBeInstanceOf(SesReceivingUnsupported);
		await expect(refused).rejects.toThrow(/eu-west-1/);
	});
});
