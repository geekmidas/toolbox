import { realpathSync } from 'node:fs';
import {
	GetUserPolicyCommand,
	IAMClient,
	ListAccessKeysCommand,
} from '@aws-sdk/client-iam';
import {
	GetIdentityVerificationAttributesCommand,
	SESClient,
} from '@aws-sdk/client-ses';
import type { ConstructManifest } from '@geekmidas/manifest';
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
import { secretsStoreFor } from '../../secrets/store';
import type { NormalizedWorkspace } from '../../workspace/types';
import { provisionStage } from '../index';
import { emailUserName } from '../ses/config';
import { SEND_POLICY_NAME, sesEmailProvider } from '../ses/email';
import { EmailNotProvisioned } from '../ses/errors';
import { smtpHost, smtpUser } from '../ses/smtp';

/**
 * A mail construct on a deployed stage whose `deploy.email` names `ses`,
 * against the AWS emulator: the sender's domain as an SES identity, a user
 * allowed to send as it alone, its key as an `smtp://` URL — all real calls —
 * and a URL the stage already held left alone.
 *
 * The domain has no `dns` config, so its DKIM records come back as what to
 * create by hand: the DNS layer's own path, asserted by its own specs.
 */

const REGION = 'eu-west-1';
const STAGE = 'production';
const DOMAIN = 'sendwell.example';

const admin = {
	region: REGION,
	endpoint: LOCALSTACK_URL,
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
};
const iam = new IAMClient(admin);
const ses = new SESClient(admin);

const manifest: ConstructManifest = {
	Mail: { kind: 'email', id: 'Mail', provides: ['MAIL_URL', 'MAIL_FROM'] },
} as never;

let dir: string;
let home: string;
let name: string;
let workspace: NormalizedWorkspace;
const lines: string[] = [];

const stateStore = () =>
	createStateStore({
		config: workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
	});

async function secretsStore() {
	return secretsStoreFor(workspace, STAGE, { home });
}

const provision = async (
	options: Partial<Parameters<typeof provisionStage>[0]> = {},
) => {
	const store = await secretsStore();
	return provisionStage({
		workspace,
		stage: STAGE,
		manifest,
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
	const store = await secretsStore();
	return (await store.read(STAGE))?.custom ?? {};
}

async function setSecrets(values: Record<string, string | undefined>) {
	const store = await secretsStore();
	const stored = (await store.read(STAGE))!;
	const custom = { ...stored.custom, ...values };
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) delete custom[key];
	}
	await store.write(STAGE, { ...stored, custom: custom as never });
}

const userName = () => emailUserName(name, STAGE, 'Mail');

beforeAll(async () => {
	vi.stubEnv('AWS_ENDPOINT_URL', LOCALSTACK_URL);
	vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
	vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
	vi.stubEnv('AWS_REGION', REGION);
	vi.stubEnv('AWS_PROFILE', undefined);

	dir = realpathSync(await createTempDir('gkm-provider-ses-email-'));
	home = realpathSync(await createTempDir('gkm-provider-home-'));
	vi.stubEnv('GKM_HOME', home);
	name = `eml-${Date.now().toString(36)}`;
	writeComposeApp(dir, {
		name,
		target: 'compose',
		domain: DOMAIN,
		deployed: [STAGE],
		domains: { [STAGE]: DOMAIN },
		deployEmail: { [STAGE]: { provider: 'ses', region: REGION } },
	});
	({ workspace } = await loadWorkspaceConfig(dir));
}, 120_000);

beforeEach(() => {
	lines.length = 0;
});

afterAll(async () => {
	vi.unstubAllEnvs();
	await cleanupDir(dir);
	await cleanupDir(home);
});

describe('the ses mail provider', { timeout: 120_000 }, () => {
	it('says what it would create on a dry run, and creates nothing', async () => {
		const reports = await provision({ dryRun: true });

		expect(reports.find((r) => r.kind === 'email')).toMatchObject({
			mode: 'provider',
			provider: 'ses',
			planned: ['MAIL_URL', 'MAIL_FROM'],
		});
		expect(lines.join('\n')).toContain(
			`would verify with DKIM — SES identity ${DOMAIN}`,
		);
		expect(await secretsOf()).toEqual({});
	});

	it("creates the sender: the domain's identity, a user that sends as it alone, and its SMTP URL", async () => {
		await provision();

		const secrets = await secretsOf();
		expect(secrets.MAIL_FROM).toBe(`noreply@${DOMAIN}`);
		const url = new URL(secrets.MAIL_URL!);
		expect(url.protocol).toBe('smtp:');
		expect(url.host).toBe(`${smtpHost(REGION)}:587`);

		// The URL's user is the key IAM issued to the stage's sending user.
		const keys = await iam.send(
			new ListAccessKeysCommand({ UserName: userName() }),
		);
		expect(keys.AccessKeyMetadata?.map((k) => k.AccessKeyId)).toEqual([
			smtpUser(secrets.MAIL_URL!),
		]);
		const policy = await iam.send(
			new GetUserPolicyCommand({
				UserName: userName(),
				PolicyName: SEND_POLICY_NAME,
			}),
		);
		expect(
			JSON.parse(decodeURIComponent(policy.PolicyDocument!)).Statement,
		).toEqual([
			expect.objectContaining({
				Action: 'ses:SendRawEmail',
				Resource: expect.stringMatching(
					new RegExp(`^arn:aws:ses:${REGION}:\\d+:identity/${DOMAIN}$`),
				),
			}),
		]);

		const identity = await ses.send(
			new GetIdentityVerificationAttributesCommand({ Identities: [DOMAIN] }),
		);
		expect(identity.VerificationAttributes?.[DOMAIN]).toBeDefined();
		// Its DKIM records, through the stage's DNS — by hand here.
		expect(lines.join('\n')).toMatch(/_domainkey\.sendwell\.example CNAME /);
		// The emulator's account is a new one: the sandbox is said, not failed on.
		expect(lines.join('\n')).toContain('sandbox');
	});

	it('keeps the key it issued on the next run', async () => {
		const before = (await secretsOf()).MAIL_URL;

		await provision();

		expect((await secretsOf()).MAIL_URL).toBe(before);
		expect(lines.join('\n')).not.toMatch(/access key/);
	});

	it('issues a successor key and password on --rotate-keys, keeping the old one until the stage deploys', async () => {
		const before = smtpUser((await secretsOf()).MAIL_URL!);

		await provision({ rotateKeys: true });

		const after = (await secretsOf()).MAIL_URL!;
		expect(smtpUser(after)).not.toBe(before);
		const keys = await iam.send(
			new ListAccessKeysCommand({ UserName: userName() }),
		);
		expect(keys.AccessKeyMetadata?.map((k) => k.AccessKeyId).sort()).toEqual(
			[before, smtpUser(after)].sort(),
		);

		await provision({ retireOldKeys: true });

		const left = await iam.send(
			new ListAccessKeysCommand({ UserName: userName() }),
		);
		expect(left.AccessKeyMetadata?.map((k) => k.AccessKeyId)).toEqual([
			smtpUser(after),
		]);
	});

	it('sends from the address the stage names, on its own domain', async () => {
		const from = `hello@notify.${DOMAIN}`;

		await provision({
			workspace: {
				...workspace,
				deploy: {
					...workspace.deploy,
					email: { [STAGE]: { provider: 'ses', region: REGION, from } },
				},
			} as NormalizedWorkspace,
		});

		expect((await secretsOf()).MAIL_FROM).toBe(from);
		const policy = await iam.send(
			new GetUserPolicyCommand({
				UserName: userName(),
				PolicyName: SEND_POLICY_NAME,
			}),
		);
		expect(policy.PolicyDocument).toContain(`notify.${DOMAIN}`);
	});

	it('leaves a URL the stage already held alone, and creates nothing for it', async () => {
		const own = 'smtp://someone:secret@smtp.example.com:587';
		await setSecrets({ MAIL_URL: own });

		const reports = await provision();

		expect((await secretsOf()).MAIL_URL).toBe(own);
		expect(reports.find((r) => r.kind === 'email')?.actions).toEqual([]);
		expect(lines.join('\n')).toContain(
			"MAIL_URL is set in the stage's secrets — it sends with that",
		);
	});

	it("refuses a stage whose secrets hold no URL, from every deploy's check", async () => {
		const refused = sesEmailProvider.verify({
			workspace,
			manifest,
			stage: STAGE,
			config: { provider: 'ses', region: REGION },
			secrets: { MAIL_FROM: `noreply@${DOMAIN}` },
		});

		await expect(refused).rejects.toBeInstanceOf(EmailNotProvisioned);
		await expect(refused).rejects.toThrow(/'Mail' has no MAIL_URL/);
	});
});
