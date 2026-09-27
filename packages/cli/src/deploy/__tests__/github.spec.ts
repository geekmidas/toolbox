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
import {
	DEFAULT_POLICY_ARN,
	deployGithubCommand,
	ensureOidcProvider,
	ensureRole,
	type Gh,
	roleName,
	trustPolicy,
} from '../github';

/** A workspace deploying `staging` and `prod`, with its keys under `home`. */
function workspace(root: string, home: string) {
	writeFileSync(
		join(root, 'gkm.config.ts'),
		`import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'beetlefit',
  stages: { local: 'dev', deployed: ['staging', 'prod'], protected: ['prod'] },
});
`,
	);
	mkdirSync(join(home, '.gkm', 'beetlefit'), { recursive: true });
	writeFileSync(join(home, '.gkm', 'beetlefit', 'prod.key'), 'a1b2c3\n');
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
				'acme/beetlefit',
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
							'repo:acme/beetlefit:environment:prod',
					},
				},
			},
		]);
	});
});

describe('roleName', () => {
	it('is the project and stage, within IAM limits', () => {
		expect(roleName('beetlefit', 'prod')).toBe('beetlefit-github-prod');
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
				{ stage: 'qa', repo: 'acme/beetlefit' },
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
				repo: 'acme/beetlefit',
				profile: 'acme-prod',
				dryRun: true,
			},
			{ gh, cwd: root },
		);

		const output = log.mock.calls.flat().join('\n');
		expect(output).toContain('Role:         beetlefit-github-prod');
		expect(output).toContain('AWS profile:  acme-prod');
		expect(output).toContain(`Policy:       ${DEFAULT_POLICY_ARN}`);
		expect(output).toContain('repo:acme/beetlefit:environment:prod only');
		expect(calls).toEqual([]);
	});

	it('says to create the secrets key when the stage has none', async () => {
		const { gh } = recordingGh();

		await deployGithubCommand(
			{ stage: 'staging', repo: 'acme/beetlefit', dryRun: true },
			{ gh, cwd: root },
		);

		expect(log.mock.calls.flat().join('\n')).toContain(
			'run gkm secrets:init --stage staging first',
		);
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
				{ stage: 'prod', repo: 'acme/beetlefit' },
				{ gh, iam, cwd: root },
			);

			expect(calls).toEqual([
				{
					args: [
						'api',
						'--method',
						'PUT',
						'repos/acme/beetlefit/environments/prod',
					],
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
						'acme/beetlefit',
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
						'acme/beetlefit',
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
});
