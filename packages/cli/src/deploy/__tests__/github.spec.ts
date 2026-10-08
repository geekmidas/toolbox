import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	AttachRolePolicyCommand,
	GetRoleCommand,
	GetRolePolicyCommand,
	IAMClient,
	ListAttachedRolePoliciesCommand,
	ListOpenIDConnectProvidersCommand,
	ListRoleTagsCommand,
} from '@aws-sdk/client-iam';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import { initStageSecrets } from '../../secrets/storage';
import type { StageSecrets } from '../../secrets/types';
import {
	DEFAULT_POLICY_ARN,
	deployGithubCommand,
	ensureOidcProvider,
	ensureRole,
	type Gh,
	iamFor,
	POLICY_TAG,
	roleName,
	SCOPED_POLICY_NAME,
	SsoSessionExpired,
	trustedSubject,
	trustPolicy,
} from '../github';
import { OidcSubjectNotSupported } from '../githubOidc';

/** A workspace deploying `staging` and `prod`, with its keys under `home`. */
function workspace(root: string, home: string) {
	writeFileSync(
		join(root, 'gkm.config.ts'),
		`import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'shop',
  constructs: './src/constructs/**/*.ts',
  stages: { local: 'dev', deployed: ['staging', 'prod'], protected: ['prod'] },
});
`,
	);
	mkdirSync(join(home, '.gkm', 'shop'), { recursive: true });
	writeFileSync(join(home, '.gkm', 'shop', 'prod.key'), 'a1b2c3\n');
}

/** What the custom store below holds, and every write it was asked for. */
interface Held {
	stages: Record<string, StageSecrets>;
	writes: string[];
}

function held(): Held {
	const g = globalThis as { __heldSecrets?: Held };
	g.__heldSecrets ??= { stages: {}, writes: [] };
	return g.__heldSecrets;
}

/** The same workspace, its deployed stages' secrets in a custom store. */
function storedWorkspace(root: string) {
	// A custom store, so what it holds can be set and read back here.
	writeFileSync(
		join(root, 'gkm.config.ts'),
		`import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'shop',
  constructs: './src/constructs/**/*.ts',
  stages: { local: 'dev', deployed: ['staging', 'prod'], protected: ['prod'] },
  secrets: {
    store: {
      provider: {
        name: 'memory',
        async read(stage) {
          return (globalThis as any).__heldSecrets?.stages[stage] ?? null;
        },
        async write(stage, secrets) {
          const held = ((globalThis as any).__heldSecrets ??= { stages: {}, writes: [] });
          held.stages[stage] = secrets;
          held.writes.push(stage);
        },
      },
    },
  },
});
`,
	);
}

/** What GitHub answers for a repository on the default subject. */
const DEFAULT_SUBJECT = { use_default: true };

/** What GitHub answers for a repository on the immutable subject. */
const IMMUTABLE_SUBJECT = {
	use_default: true,
	use_immutable_subject: true,
	sub_claim_prefix: 'repo:acme@1234/shop@5678',
};

/**
 * Records every `gh` call instead of reaching GitHub: the writes in `calls`,
 * the reads (`gh api <path>`) in `reads`, answering the repository's OIDC
 * subject settings with `customization` — or failing, as `gh` does on a 404,
 * when it is null.
 */
function recordingGh(customization: object | null = DEFAULT_SUBJECT) {
	const calls: { args: string[]; input?: string }[] = [];
	const reads: string[] = [];
	const gh: Gh = (args, input) => {
		if (args[0] === 'api' && args[1] !== '--method') {
			reads.push(args[1]!);
			if (args[1]!.endsWith('/actions/oidc/customization/sub')) {
				if (!customization) throw new Error('gh: HTTP 404: Not Found');
				return JSON.stringify(customization);
			}
			throw new Error('gh: HTTP 404: Not Found');
		}
		calls.push({ args, input });
		return '';
	};
	return { gh, calls, reads };
}

describe('trustPolicy', () => {
	it("trusts only this repository's environment for the stage", () => {
		const policy = JSON.parse(
			trustPolicy(
				'arn:aws:iam::111:oidc-provider/token.actions.githubusercontent.com',
				'repo:acme@1234/shop@5678:environment:prod',
			),
		);

		expect(policy.Statement).toEqual([
			{
				Effect: 'Allow',
				Principal: {
					Federated:
						'arn:aws:iam::111:oidc-provider/token.actions.githubusercontent.com',
				},
				Action: 'sts:AssumeRoleWithWebIdentity',
				Condition: {
					StringEquals: {
						'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
						// An exact match, not a wildcard: a staging job cannot assume it.
						'token.actions.githubusercontent.com:sub':
							'repo:acme@1234/shop@5678:environment:prod',
					},
				},
			},
		]);
	});

	it('reads back the subject it trusts, URL-encoded as IAM returns it', () => {
		const policy = trustPolicy('arn:x', 'repo:acme/shop:environment:prod');

		expect(trustedSubject(encodeURIComponent(policy))).toBe(
			'repo:acme/shop:environment:prod',
		);
		expect(trustedSubject(policy)).toBe('repo:acme/shop:environment:prod');
		expect(trustedSubject(undefined)).toBeUndefined();
	});
});

describe('roleName', () => {
	it('is the project and stage, within IAM limits', () => {
		expect(roleName('shop', 'prod')).toBe('shop-github-prod');
		expect(roleName('x'.repeat(80), 'prod')).toHaveLength(64);
	});
});

// Keys under each test's own HOME, not the suite's shared GKM_HOME.
beforeEach(() => {
	vi.stubEnv('GKM_HOME', undefined);
});
afterEach(() => {
	vi.unstubAllEnvs();
});

describe('deployGithubCommand', () => {
	let root: string;
	let home: string;
	let log: ReturnType<typeof vi.spyOn>;
	const originalHome = process.env.HOME;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'gkm-github-'));
		home = mkdtempSync(join(tmpdir(), 'gkm-home-'));
		// Keys live under ~/.gkm; never the real one.
		process.env.HOME = home;
		workspace(root, home);
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		delete (globalThis as { __heldSecrets?: Held }).__heldSecrets;
		process.env.HOME = originalHome;
		log.mockRestore();
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	});

	it('refuses a stage the project does not deploy', async () => {
		const { gh, calls } = recordingGh();

		await expect(
			deployGithubCommand(
				{ stage: 'qa', repo: 'acme/shop' },
				{ gh, cwd: root },
			),
		).rejects.toThrow('"qa" is not a deployed stage');
		expect(calls).toEqual([]);
	});

	it('prints the plan and changes nothing on --dry-run', async () => {
		const { gh, calls } = recordingGh();

		await deployGithubCommand(
			{
				stage: 'prod',
				repo: 'acme/shop',
				profile: 'acme-prod',
				dryRun: true,
			},
			{ gh, cwd: root },
		);

		const output = log.mock.calls.flat().join('\n');
		expect(output).toContain('Role:         shop-github-prod');
		expect(output).toContain('AWS profile:  acme-prod');
		expect(output).toContain(`Policy:       ${DEFAULT_POLICY_ARN}`);
		expect(output).toContain('repo:acme/shop:environment:prod only');
		expect(calls).toEqual([]);
	});

	it('plans to read a stored stage with the default credentials', async () => {
		storedWorkspace(root);
		held().stages.prod = initStageSecrets('prod');
		const { gh } = recordingGh();

		await deployGithubCommand(
			{ stage: 'prod', repo: 'acme/shop', dryRun: true },
			{ gh, cwd: root },
		);

		const output = log.mock.calls.flat().join('\n');
		expect(output).toContain(
			'in the store (memory), read with the default credentials',
		);
		expect(output).not.toContain('Secrets key:');
	});

	it('says to set the secrets of a stored stage whose store is empty', async () => {
		storedWorkspace(root);
		const { gh } = recordingGh();

		await deployGithubCommand(
			{ stage: 'prod', repo: 'acme/shop', dryRun: true },
			{ gh, cwd: root },
		);

		expect(log.mock.calls.flat().join('\n')).toContain(
			"none in the store yet — gkm secrets:set <KEY> '…' --stage prod",
		);
	});

	it('says to create the secrets key when the stage has none', async () => {
		const { gh } = recordingGh();

		await deployGithubCommand(
			{ stage: 'staging', repo: 'acme/shop', dryRun: true },
			{ gh, cwd: root },
		);

		expect(log.mock.calls.flat().join('\n')).toContain(
			'run gkm secrets:init --stage staging first',
		);
	});
});

describe('iamFor', () => {
	it("points at the endpoint it is given, with the emulator's keys", async () => {
		const iam = await iamFor(undefined, LOCALSTACK_URL);
		const endpoint = await iam.config.endpoint!();

		expect(endpoint.hostname).toBe('localhost');
		expect(await iam.config.credentials()).toMatchObject({
			accessKeyId: 'test',
		});
	});
});

describe('an expired SSO login', () => {
	it('names the profile and the command that fixes it', async () => {
		const root = mkdtempSync(join(tmpdir(), 'gkm-github-'));
		const home = mkdtempSync(join(tmpdir(), 'gkm-home-'));
		const originalHome = process.env.HOME;
		process.env.HOME = home;
		workspace(root, home);
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		// What the SDK raises from the first call once the SSO token lapses.
		const iam = {
			send: async () => {
				throw new Error(
					'The SSO session associated with this profile has expired.',
				);
			},
		} as unknown as IAMClient;

		try {
			const run = deployGithubCommand(
				{ stage: 'prod', repo: 'acme/shop', profile: 'acme-prod' },
				{ gh: recordingGh().gh, iam, cwd: root },
			);
			await expect(run).rejects.toThrow(SsoSessionExpired);
			await expect(run).rejects.toThrow('aws sso login --profile acme-prod');
		} finally {
			process.env.HOME = originalHome;
			log.mockRestore();
			rmSync(root, { recursive: true, force: true });
			rmSync(home, { recursive: true, force: true });
		}
	});
});

/**
 * Against the AWS emulator (`docker compose up`), like the backup
 * provisioner's IAM tests.
 */
describe('against IAM', () => {
	const iam = new IAMClient({
		region: 'us-east-1',
		endpoint: LOCALSTACK_URL,
		credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
	});

	it('creates the GitHub provider once', async () => {
		const first = await ensureOidcProvider(iam);
		const second = await ensureOidcProvider(iam);

		expect(first).toMatch(
			/oidc-provider\/token\.actions\.githubusercontent\.com$/,
		);
		expect(second).toBe(first);
		const { OpenIDConnectProviderList = [] } = await iam.send(
			new ListOpenIDConnectProvidersCommand({}),
		);
		expect(
			OpenIDConnectProviderList.filter((p) => p.Arn === first),
		).toHaveLength(1);
	});

	it('creates the role, and brings it back to the trust on a re-run', async () => {
		const provider = await ensureOidcProvider(iam);
		const name = `test-github-${Date.now()}`;

		const created = await ensureRole(
			iam,
			name,
			trustPolicy(provider, 'repo:acme/old:environment:prod'),
			{ managed: DEFAULT_POLICY_ARN },
		);
		const updated = await ensureRole(
			iam,
			name,
			trustPolicy(provider, 'repo:acme/new:environment:prod'),
			{ managed: DEFAULT_POLICY_ARN },
		);

		expect(created.created).toBe(true);
		expect(updated.arn).toBe(created.arn);
		expect(updated.created).toBe(false);
		expect(updated.previousSubject).toBe('repo:acme/old:environment:prod');
		const { Role } = await iam.send(new GetRoleCommand({ RoleName: name }));
		expect(decodeURIComponent(Role!.AssumeRolePolicyDocument!)).toContain(
			'repo:acme/new:environment:prod',
		);
		const { AttachedPolicies = [] } = await iam.send(
			new ListAttachedRolePoliciesCommand({ RoleName: name }),
		);
		expect(AttachedPolicies.map((p) => p.PolicyArn)).toEqual([
			DEFAULT_POLICY_ARN,
		]);
	});

	it('gives the GitHub environment the role and the stage key', async () => {
		const root = mkdtempSync(join(tmpdir(), 'gkm-github-'));
		const home = mkdtempSync(join(tmpdir(), 'gkm-home-'));
		const originalHome = process.env.HOME;
		process.env.HOME = home;
		workspace(root, home);
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const { gh, calls } = recordingGh();

		try {
			const { roleArn } = await deployGithubCommand(
				{ stage: 'prod', repo: 'acme/shop' },
				{ gh, iam, cwd: root },
			);

			expect(calls).toEqual([
				{
					args: ['api', '--method', 'PUT', 'repos/acme/shop/environments/prod'],
					input: undefined,
				},
				{
					args: [
						'variable',
						'set',
						'AWS_ROLE_ARN',
						'--env',
						'prod',
						'--repo',
						'acme/shop',
						'--body',
						roleArn!,
					],
					input: undefined,
				},
				// The key through stdin, never as an argument.
				{
					args: [
						'secret',
						'set',
						'GKM_SECRETS_KEY',
						'--env',
						'prod',
						'--repo',
						'acme/shop',
					],
					input: 'a1b2c3',
				},
			]);
		} finally {
			process.env.HOME = originalHome;
			log.mockRestore();
			rmSync(root, { recursive: true, force: true });
			rmSync(home, { recursive: true, force: true });
		}
	});

	it('tells a stored stage with an empty store to set its secrets', async () => {
		const root = mkdtempSync(join(tmpdir(), 'gkm-github-'));
		const home = mkdtempSync(join(tmpdir(), 'gkm-home-'));
		const originalHome = process.env.HOME;
		process.env.HOME = home;
		workspace(root, home);
		storedWorkspace(root);
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const { gh, calls } = recordingGh();

		try {
			await deployGithubCommand(
				{ stage: 'prod', repo: 'acme/shop', profile: 'acme-prod' },
				{ gh, iam, cwd: root },
			);

			expect(JSON.stringify(calls)).not.toContain('GKM_SECRETS_KEY');
			expect(log.mock.calls.flat().join('\n')).toContain(
				`⚠ The "prod" store holds no secrets yet; set them with gkm secrets:set <KEY> '…' --stage prod (AWS_PROFILE=acme-prod).`,
			);
			expect(held().writes).toEqual([]);
		} finally {
			delete (globalThis as { __heldSecrets?: Held }).__heldSecrets;
			process.env.HOME = originalHome;
			log.mockRestore();
			rmSync(root, { recursive: true, force: true });
			rmSync(home, { recursive: true, force: true });
		}
	});

	it('leaves a stored stage’s secrets in its store, handing GitHub no key', async () => {
		const root = mkdtempSync(join(tmpdir(), 'gkm-github-'));
		const home = mkdtempSync(join(tmpdir(), 'gkm-home-'));
		const originalHome = process.env.HOME;
		process.env.HOME = home;
		workspace(root, home);
		storedWorkspace(root);
		held().stages.prod = {
			...initStageSecrets('prod'),
			custom: { STRIPE_KEY: 'sk_live' },
		};
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const { gh, calls } = recordingGh();

		try {
			await deployGithubCommand(
				{ stage: 'prod', repo: 'acme/shop', profile: 'acme-prod' },
				{ gh, iam, cwd: root },
			);

			// Nothing is sent anywhere: the deploy job reads the store itself.
			expect(held().writes).toEqual([]);
			expect(held().stages.prod?.custom).toEqual({ STRIPE_KEY: 'sk_live' });
			expect(JSON.stringify(calls)).not.toContain('GKM_SECRETS_KEY');
			const output = log.mock.calls.flat().join('\n');
			expect(output).toContain(
				'in the store (memory), read with profile "acme-prod"',
			);
			expect(output).not.toContain('store holds no secrets yet');
		} finally {
			delete (globalThis as { __heldSecrets?: Held }).__heldSecrets;
			process.env.HOME = originalHome;
			log.mockRestore();
			rmSync(root, { recursive: true, force: true });
			rmSync(home, { recursive: true, force: true });
		}
	});
});

/** A workspace of its own name, so roles in the shared emulator never collide. */
function namedWorkspace(root: string, name: string, config: string) {
	writeFileSync(
		join(root, 'gkm.config.ts'),
		`import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: '${name}',
  constructs: './src/constructs/**/*.ts',
  stages: { local: 'dev', deployed: ['staging', 'prod'], protected: ['prod'] },
  ${config}
});
`,
	);
}

/** A unique, IAM-safe project name. */
function uniqueName(prefix: string): string {
	return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

describe('the OIDC subject', () => {
	let root: string;
	let home: string;
	let log: ReturnType<typeof vi.spyOn>;
	const originalHome = process.env.HOME;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'gkm-github-'));
		home = mkdtempSync(join(tmpdir(), 'gkm-home-'));
		process.env.HOME = home;
		workspace(root, home);
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		process.env.HOME = originalHome;
		log.mockRestore();
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	});

	it('prints the immutable subject on --dry-run, reading only', async () => {
		const { gh, calls, reads } = recordingGh(IMMUTABLE_SUBJECT);

		const { subject } = await deployGithubCommand(
			{ stage: 'prod', repo: 'acme/shop', dryRun: true },
			{ gh, cwd: root },
		);

		expect(subject).toBe('repo:acme@1234/shop@5678:environment:prod');
		expect(log.mock.calls.flat().join('\n')).toContain(
			"Trusted by:   repo:acme@1234/shop@5678:environment:prod only  (the repository's immutable subject)",
		);
		expect(reads).toEqual(['repos/acme/shop/actions/oidc/customization/sub']);
		expect(calls).toEqual([]);
	});

	it('warns, naming the endpoint, when the settings cannot be read', async () => {
		const { gh } = recordingGh(null);

		await deployGithubCommand(
			{ stage: 'prod', repo: 'acme/shop', dryRun: true },
			{ gh, cwd: root },
		);

		const output = log.mock.calls.flat().join('\n');
		expect(output).toContain(
			'Trusted by:   repo:acme/shop:environment:prod only  (assumed: the default format)',
		);
		expect(output).toContain(
			'⚠ Could not read repos/acme/shop/actions/oidc/customization/sub',
		);
	});

	it('changes nothing for a template whose claims depend on the run', async () => {
		const { gh, calls } = recordingGh({
			use_default: false,
			include_claim_keys: ['repo', 'context', 'job_workflow_ref'],
		});

		await expect(
			deployGithubCommand(
				{ stage: 'prod', repo: 'acme/shop' },
				{ gh, cwd: root },
			),
		).rejects.toThrow(OidcSubjectNotSupported);
		expect(calls).toEqual([]);
	});
});

/**
 * The deploy role in the AWS emulator: the trust it gets, and what it may do.
 * The stores read through the SDK's standard endpoint variable.
 */
describe('the deploy role, against IAM', () => {
	const iam = new IAMClient({
		region: 'us-east-1',
		endpoint: LOCALSTACK_URL,
		credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
	});
	let root: string;
	let home: string;
	let log: ReturnType<typeof vi.spyOn>;
	const originalHome = process.env.HOME;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'gkm-github-'));
		home = mkdtempSync(join(tmpdir(), 'gkm-home-'));
		process.env.HOME = home;
		vi.stubEnv('AWS_ENDPOINT_URL', LOCALSTACK_URL);
		vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
		vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
		vi.stubEnv('AWS_PROFILE', undefined);
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		process.env.HOME = originalHome;
		log.mockRestore();
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	});

	const output = () => log.mock.calls.flat().join('\n');

	async function trustOf(role: string) {
		const { Role } = await iam.send(new GetRoleCommand({ RoleName: role }));
		return trustedSubject(Role!.AssumeRolePolicyDocument);
	}

	async function attached(role: string) {
		const { AttachedPolicies = [] } = await iam.send(
			new ListAttachedRolePoliciesCommand({ RoleName: role }),
		);
		return AttachedPolicies.map((policy) => policy.PolicyArn);
	}

	async function inline(role: string) {
		const { PolicyDocument } = await iam.send(
			new GetRolePolicyCommand({
				RoleName: role,
				PolicyName: SCOPED_POLICY_NAME,
			}),
		);
		return JSON.parse(decodeURIComponent(PolicyDocument!));
	}

	it('trusts the subject GitHub sends on a new role', async () => {
		const name = uniqueName('new');
		namedWorkspace(root, name, "deploy: { default: 'sst' },");

		await deployGithubCommand(
			{ stage: 'prod', repo: 'acme/shop' },
			{ gh: recordingGh(IMMUTABLE_SUBJECT).gh, iam, cwd: root },
		);

		expect(await trustOf(`${name}-github-prod`)).toBe(
			'repo:acme@1234/shop@5678:environment:prod',
		);
		expect(output()).toContain('(created)');
	});

	it("rewrites an existing role's trust, and says from what", async () => {
		const name = uniqueName('fix');
		namedWorkspace(root, name, "deploy: { default: 'sst' },");
		const role = `${name}-github-prod`;
		// The role an earlier gkm made, trusting the default format.
		const provider = await ensureOidcProvider(iam);
		await ensureRole(
			iam,
			role,
			trustPolicy(provider, 'repo:acme/shop:environment:prod'),
			{ managed: DEFAULT_POLICY_ARN },
		);

		await deployGithubCommand(
			{ stage: 'prod', repo: 'acme/shop' },
			{ gh: recordingGh(IMMUTABLE_SUBJECT).gh, iam, cwd: root },
		);

		expect(await trustOf(role)).toBe(
			'repo:acme@1234/shop@5678:environment:prod',
		);
		expect(output()).toContain(
			'✓ Trust: repo:acme/shop:environment:prod → repo:acme@1234/shop@5678:environment:prod',
		);

		// Again: nothing left to change.
		log.mockClear();
		await deployGithubCommand(
			{ stage: 'prod', repo: 'acme/shop' },
			{ gh: recordingGh(IMMUTABLE_SUBJECT).gh, iam, cwd: root },
		);
		expect(output()).toContain(
			'✓ Trust: unchanged, repo:acme@1234/shop@5678:environment:prod',
		);
	});

	it('keeps AdministratorAccess for an SST stage, recorded as gkm’s', async () => {
		const name = uniqueName('sst');
		namedWorkspace(root, name, "deploy: { default: 'sst' },");
		const role = `${name}-github-prod`;

		await deployGithubCommand(
			{ stage: 'prod', repo: 'acme/shop' },
			{ gh: recordingGh().gh, iam, cwd: root },
		);

		expect(await attached(role)).toEqual([DEFAULT_POLICY_ARN]);
		const { Tags = [] } = await iam.send(
			new ListRoleTagsCommand({ RoleName: role }),
		);
		expect(Tags).toContainEqual({ Key: POLICY_TAG, Value: DEFAULT_POLICY_ARN });
		expect(output()).toContain(
			`Policy:       ${DEFAULT_POLICY_ARN}  (the sst target deploys infrastructure; --policy-arn to narrow)`,
		);
	});

	it('scopes a compose stage to its SSM parameter', async () => {
		const name = uniqueName('ssm');
		namedWorkspace(
			root,
			name,
			"deploy: { default: 'compose' },\n  secrets: { store: { provider: 'ssm', region: 'eu-west-1' } },",
		);
		const role = `${name}-github-prod`;

		await deployGithubCommand(
			{ stage: 'prod', repo: 'acme/shop' },
			{ gh: recordingGh().gh, iam, cwd: root },
		);

		expect(await attached(role)).toEqual([]);
		expect((await inline(role)).Statement).toEqual([
			{
				Sid: 'StageSecrets',
				Effect: 'Allow',
				Action: ['ssm:GetParameter', 'ssm:PutParameter'],
				Resource: `arn:aws:ssm:eu-west-1:000000000000:parameter/gkm/${name}/prod/secrets`,
			},
		]);
		expect(output()).toContain(
			`Policy:       inline "gkm-deploy", scoped to the compose deploy — only:`,
		);
		expect(output()).toContain(
			`read and update /gkm/${name}/prod/secrets (SSM, eu-west-1)`,
		);
	});

	it('scopes a compose stage to its Secrets Manager secret', async () => {
		const name = uniqueName('sm');
		namedWorkspace(
			root,
			name,
			"deploy: { default: 'compose' },\n  secrets: { store: { provider: 'secrets-manager', region: 'us-east-1' } },",
		);
		const role = `${name}-github-prod`;

		await deployGithubCommand(
			{ stage: 'prod', repo: 'acme/shop' },
			{ gh: recordingGh().gh, iam, cwd: root },
		);

		expect(await attached(role)).toEqual([]);
		expect((await inline(role)).Statement).toEqual([
			{
				Sid: 'StageSecrets',
				Effect: 'Allow',
				Action: [
					'secretsmanager:GetSecretValue',
					'secretsmanager:PutSecretValue',
					'secretsmanager:CreateSecret',
				],
				Resource: `arn:aws:secretsmanager:us-east-1:000000000000:secret:gkm/${name}/prod/secrets-??????`,
			},
		]);
	});

	it('moves a compose role off the AdministratorAccess gkm attached', async () => {
		const name = uniqueName('mv');
		const role = `${name}-github-prod`;
		// First as SST: gkm attaches AdministratorAccess and records it.
		namedWorkspace(root, name, "deploy: { default: 'sst' },");
		await deployGithubCommand(
			{ stage: 'prod', repo: 'acme/shop' },
			{ gh: recordingGh().gh, iam, cwd: root },
		);

		// Then as compose — in a checkout of its own, as a loaded config is
		// cached by path.
		const composeRoot = mkdtempSync(join(tmpdir(), 'gkm-github-'));
		namedWorkspace(
			composeRoot,
			name,
			"deploy: { default: 'compose' },\n  secrets: { store: { provider: 'ssm', region: 'us-east-1' } },",
		);
		log.mockClear();
		try {
			await deployGithubCommand(
				{ stage: 'prod', repo: 'acme/shop' },
				{ gh: recordingGh().gh, iam, cwd: composeRoot },
			);
		} finally {
			rmSync(composeRoot, { recursive: true, force: true });
		}

		expect(await attached(role)).toEqual([]);
		expect((await inline(role)).Statement).toHaveLength(1);
		const { Tags = [] } = await iam.send(
			new ListRoleTagsCommand({ RoleName: role }),
		);
		expect(Tags.map((tag) => tag.Key)).not.toContain(POLICY_TAG);
		expect(output()).toContain(
			`✓ Detached ${DEFAULT_POLICY_ARN} (attached by gkm, no longer needed)`,
		);
	});

	it('names, but leaves, AdministratorAccess gkm has no record of', async () => {
		const name = uniqueName('old');
		const role = `${name}-github-prod`;
		namedWorkspace(
			root,
			name,
			"deploy: { default: 'compose' },\n  secrets: { store: { provider: 'ssm', region: 'us-east-1' } },",
		);
		// A role from before gkm recorded what it attached.
		const provider = await ensureOidcProvider(iam);
		await ensureRole(
			iam,
			role,
			trustPolicy(provider, 'repo:acme/shop:environment:prod'),
			{ inline: null },
		);
		await iam.send(
			new AttachRolePolicyCommand({
				RoleName: role,
				PolicyArn: DEFAULT_POLICY_ARN,
			}),
		);

		await deployGithubCommand(
			{ stage: 'prod', repo: 'acme/shop' },
			{ gh: recordingGh().gh, iam, cwd: root },
		);

		expect(await attached(role)).toEqual([DEFAULT_POLICY_ARN]);
		expect((await inline(role)).Statement).toHaveLength(1);
		expect(output()).toContain(
			`⚠ ${DEFAULT_POLICY_ARN} is still attached to ${role}. gkm has no record of attaching it, so it is left; the compose deploy does not need it. Detach it with: aws iam detach-role-policy --role-name ${role} --policy-arn ${DEFAULT_POLICY_ARN}`,
		);
	});

	it('attaches --policy-arn in place of the scoped policy', async () => {
		const name = uniqueName('arn');
		const role = `${name}-github-prod`;
		namedWorkspace(
			root,
			name,
			"deploy: { default: 'compose' },\n  secrets: { store: { provider: 'ssm', region: 'us-east-1' } },",
		);
		const readOnly = 'arn:aws:iam::aws:policy/ReadOnlyAccess';

		await deployGithubCommand(
			{ stage: 'prod', repo: 'acme/shop' },
			{ gh: recordingGh().gh, iam, cwd: root },
		);
		await deployGithubCommand(
			{ stage: 'prod', repo: 'acme/shop', policyArn: readOnly },
			{ gh: recordingGh().gh, iam, cwd: root },
		);

		expect(await attached(role)).toEqual([readOnly]);
		await expect(inline(role)).rejects.toMatchObject({
			name: 'NoSuchEntityException',
		});
	});
});
