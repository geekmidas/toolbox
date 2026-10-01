import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	GetRoleCommand,
	IAMClient,
	ListAttachedRolePoliciesCommand,
	ListOpenIDConnectProvidersCommand,
} from '@aws-sdk/client-iam';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initStageSecrets, writeStageSecrets } from '../../secrets/storage';
import {
	DEFAULT_POLICY_ARN,
	deployGithubCommand,
	ensureOidcProvider,
	ensureRole,
	type Gh,
	iamFor,
	roleName,
	SsoSessionExpired,
	trustPolicy,
} from '../github';

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

/** The same workspace, its deployed stages' secrets in a custom store. */
function storedWorkspace(root: string) {
	// A custom store, so what reaches it can be read back here.
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
        async pull() { return null; },
        async push(stage, secrets) {
          (globalThis as any).__pushedSecrets = { stage, secrets };
        },
      },
    },
  },
});
`,
	);
}

/** Records every `gh` call instead of reaching GitHub. */
function recordingGh() {
	const calls: { args: string[]; input?: string }[] = [];
	const gh: Gh = (args, input) => {
		calls.push({ args, input });
		return '';
	};
	return { gh, calls };
}

describe('trustPolicy', () => {
	it("trusts only this repository's environment for the stage", () => {
		const policy = JSON.parse(
			trustPolicy(
				'arn:aws:iam::111:oidc-provider/token.actions.githubusercontent.com',
				'acme/shop',
				'prod',
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
							'repo:acme/shop:environment:prod',
					},
				},
			},
		]);
	});
});

describe('roleName', () => {
	it('is the project and stage, within IAM limits', () => {
		expect(roleName('shop', 'prod')).toBe('shop-github-prod');
		expect(roleName('x'.repeat(80), 'prod')).toHaveLength(64);
	});
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

	it('plans to push a stored stage with the default credentials', async () => {
		storedWorkspace(root);
		await writeStageSecrets(initStageSecrets('prod'), root);
		const { gh } = recordingGh();

		await deployGithubCommand(
			{ stage: 'prod', repo: 'acme/shop', dryRun: true },
			{ gh, cwd: root },
		);

		const output = log.mock.calls.flat().join('\n');
		expect(output).toContain(
			'pushed to the store with the default credentials',
		);
		expect(output).not.toContain('Secrets key:');
	});

	it('says to push a stored stage this machine has no secrets for', async () => {
		storedWorkspace(root);
		const { gh } = recordingGh();

		await deployGithubCommand(
			{ stage: 'prod', repo: 'acme/shop', dryRun: true },
			{ gh, cwd: root },
		);

		expect(log.mock.calls.flat().join('\n')).toContain(
			'none on this machine — gkm secrets:push --stage prod later',
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
		const iam = await iamFor(undefined, 'http://localhost:4566');
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
		endpoint: 'http://localhost:4566',
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
			trustPolicy(provider, 'acme/old', 'prod'),
			DEFAULT_POLICY_ARN,
		);
		const updated = await ensureRole(
			iam,
			name,
			trustPolicy(provider, 'acme/new', 'prod'),
			DEFAULT_POLICY_ARN,
		);

		expect(updated).toBe(created);
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

	it('tells a stored stage with no local secrets to push them', async () => {
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
				'push them: gkm secrets:push --stage prod --profile acme-prod.',
			);
		} finally {
			process.env.HOME = originalHome;
			log.mockRestore();
			rmSync(root, { recursive: true, force: true });
			rmSync(home, { recursive: true, force: true });
		}
	});

	it('pushes a stored stage’s secrets instead of handing GitHub a key', async () => {
		const root = mkdtempSync(join(tmpdir(), 'gkm-github-'));
		const home = mkdtempSync(join(tmpdir(), 'gkm-home-'));
		const originalHome = process.env.HOME;
		process.env.HOME = home;
		workspace(root, home);
		storedWorkspace(root);
		await writeStageSecrets(
			{ ...initStageSecrets('prod'), custom: { STRIPE_KEY: 'sk_live' } },
			root,
		);
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const { gh, calls } = recordingGh();

		try {
			await deployGithubCommand(
				{ stage: 'prod', repo: 'acme/shop', profile: 'acme-prod' },
				{ gh, iam, cwd: root },
			);

			const pushed = (globalThis as any).__pushedSecrets;
			expect(pushed.stage).toBe('prod');
			expect(pushed.secrets.custom).toEqual({ STRIPE_KEY: 'sk_live' });
			expect(JSON.stringify(calls)).not.toContain('GKM_SECRETS_KEY');
			expect(log.mock.calls.flat().join('\n')).toContain(
				'"prod" pushed to the store with profile "acme-prod"',
			);
		} finally {
			delete (globalThis as any).__pushedSecrets;
			process.env.HOME = originalHome;
			log.mockRestore();
			rmSync(root, { recursive: true, force: true });
			rmSync(home, { recursive: true, force: true });
		}
	});
});
