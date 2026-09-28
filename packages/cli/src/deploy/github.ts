/**
 * `gkm deploy:github` — let GitHub Actions deploy one stage, with no keys.
 *
 * A stage usually lives in its own AWS account — staging in one, production in
 * another — so this runs once per stage, with that account's profile:
 *
 *   gkm deploy:github --stage staging --profile acme-dev
 *   gkm deploy:github --stage prod    --profile acme-prod
 *
 * In the stage's account it makes sure GitHub's OIDC provider exists, and a
 * role that only this repository's `<stage>` environment can assume. On
 * GitHub it creates that environment and gives it what the generated deploy
 * workflow reads: `AWS_ROLE_ARN`, and — when the stage's secrets are kept in
 * the local file — its key as `GKM_SECRETS_KEY`. With `secrets.store` set to
 * SSM the deploy job pulls them with the role instead, so no key is handed to
 * GitHub, and this pushes the stage's local secrets to SSM in the same account,
 * with the same profile. Re-running it converges rather than duplicating.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {
	AttachRolePolicyCommand,
	CreateOpenIDConnectProviderCommand,
	CreateRoleCommand,
	GetRoleCommand,
	IAMClient,
	type IAMClientConfig,
	ListOpenIDConnectProvidersCommand,
	UpdateAssumeRolePolicyCommand,
} from '@aws-sdk/client-iam';
import { loadWorkspaceConfig } from '../config.js';
import { getKeyPath } from '../secrets/keystore.js';
import { secretsExist } from '../secrets/storage.js';
import { isRemoteStore } from '../secrets/store.js';
import { pushStageSecrets } from '../secrets/transfer.js';
import { assertDeployedStage } from '../workspace/stages.js';

const logger = console;

const GITHUB_OIDC_HOST = 'token.actions.githubusercontent.com';
const AUDIENCE = 'sts.amazonaws.com';

/**
 * What SST needs to create a stack is most of AWS, so this is the default —
 * said out loud in the output, and replaceable with `--policy-arn`.
 */
export const DEFAULT_POLICY_ARN = 'arn:aws:iam::aws:policy/AdministratorAccess';

export interface DeployGithubOptions {
	stage: string;
	/** The AWS profile for the stage's account. */
	profile?: string;
	/** `owner/name`; defaults to the repository `gh` sees here. */
	repo?: string;
	/** The policy the deploy role gets. */
	policyArn?: string;
	dryRun?: boolean;
}

/** Runs `gh` with the given arguments and optional stdin, returning stdout. */
export type Gh = (args: string[], input?: string) => string;

const defaultGh: Gh = (args, input) =>
	execFileSync('gh', args, {
		encoding: 'utf-8',
		...(input === undefined
			? {}
			: { input, stdio: ['pipe', 'pipe', 'pipe'] as const }),
	}).trim();

/** The role a stage deploys as: `<project>-github-<stage>`, within IAM's 64. */
export function roleName(project: string, stage: string): string {
	return `${project}-github-${stage}`
		.toLowerCase()
		.replace(/[^a-z0-9+=,.@_-]/g, '-')
		.slice(0, 64);
}

/**
 * Who may assume the role: a workflow job running in this repository's
 * `<stage>` environment, and nothing else — not another branch's job, not
 * another environment's. That is what keeps a staging deploy from using the
 * production role.
 */
export function trustPolicy(
	providerArn: string,
	repo: string,
	stage: string,
): string {
	return JSON.stringify({
		Version: '2012-10-17',
		Statement: [
			{
				Effect: 'Allow',
				Principal: { Federated: providerArn },
				Action: 'sts:AssumeRoleWithWebIdentity',
				Condition: {
					StringEquals: {
						[`${GITHUB_OIDC_HOST}:aud`]: AUDIENCE,
						[`${GITHUB_OIDC_HOST}:sub`]: `repo:${repo}:environment:${stage}`,
					},
				},
			},
		],
	});
}

/** GitHub's OIDC provider in this account, created if it is not there. */
export async function ensureOidcProvider(iam: IAMClient): Promise<string> {
	const { OpenIDConnectProviderList = [] } = await iam.send(
		new ListOpenIDConnectProvidersCommand({}),
	);
	const existing = OpenIDConnectProviderList.find((p) =>
		p.Arn?.endsWith(`oidc-provider/${GITHUB_OIDC_HOST}`),
	)?.Arn;
	if (existing) return existing;

	const created = await iam.send(
		new CreateOpenIDConnectProviderCommand({
			Url: `https://${GITHUB_OIDC_HOST}`,
			ClientIDList: [AUDIENCE],
		}),
	);
	return created.OpenIDConnectProviderArn!;
}

/** The deploy role, created or brought back to this trust and policy. */
export async function ensureRole(
	iam: IAMClient,
	name: string,
	trust: string,
	policyArn: string,
): Promise<string> {
	let arn: string;
	try {
		const { Role } = await iam.send(new GetRoleCommand({ RoleName: name }));
		await iam.send(
			new UpdateAssumeRolePolicyCommand({
				RoleName: name,
				PolicyDocument: trust,
			}),
		);
		arn = Role!.Arn!;
	} catch (error) {
		if ((error as { name?: string }).name !== 'NoSuchEntityException') {
			throw error;
		}
		const { Role } = await iam.send(
			new CreateRoleCommand({
				RoleName: name,
				AssumeRolePolicyDocument: trust,
				Description: 'Deploys from GitHub Actions (gkm deploy:github)',
				// SST deploys can run long; the default hour is tight.
				MaxSessionDuration: 3600 * 2,
			}),
		);
		arn = Role!.Arn!;
	}

	// Attaching an attached policy is a no-op, so this converges too.
	await iam.send(
		new AttachRolePolicyCommand({ RoleName: name, PolicyArn: policyArn }),
	);
	return arn;
}

/**
 * An IAM client for the stage's account.
 *
 * `fromIni` for a named profile, deliberately: it resolves exactly that
 * profile — keys, assume-role, `credential_process` or SSO, whichever
 * ~/.aws/config says — and never falls back to AWS_* in the environment. The
 * provider chain checks the environment first, so exported staging keys would
 * quietly win over `--profile prod` and the production role would land in the
 * staging account.
 */
export async function iamFor(
	profile?: string,
	endpoint?: string,
): Promise<IAMClient> {
	const config: IAMClientConfig = { region: 'us-east-1' };
	if (profile) {
		const { fromIni } = await import('@aws-sdk/credential-providers');
		config.credentials = fromIni({ profile });
	}
	if (endpoint) {
		config.endpoint = endpoint;
		config.credentials = { accessKeyId: 'test', secretAccessKey: 'test' };
	}
	return new IAMClient(config);
}

export async function deployGithubCommand(
	options: DeployGithubOptions,
	deps: { iam?: IAMClient; gh?: Gh; cwd?: string } = {},
): Promise<{ roleArn?: string; repo: string }> {
	const gh = deps.gh ?? defaultGh;
	const { workspace } = await loadWorkspaceConfig(deps.cwd);
	assertDeployedStage(workspace.stages, options.stage);

	const repo =
		options.repo ??
		gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
	const role = roleName(workspace.name, options.stage);
	const policyArn = options.policyArn ?? DEFAULT_POLICY_ARN;
	const keyPath = getKeyPath(options.stage, workspace.name);
	const hasKey = existsSync(keyPath);
	// A stage whose secrets are in a store is read from there by the deploy job,
	// with the role; it needs no key on GitHub.
	const remote = isRemoteStore(workspace, options.stage);
	const hasSecrets = secretsExist(options.stage, workspace.root);
	const via = options.profile
		? `profile "${options.profile}"`
		: 'the default credentials';

	logger.log(`\n🔐 GitHub → AWS for stage "${options.stage}"\n`);
	logger.log(`  Repository:   ${repo}`);
	logger.log(`  AWS profile:  ${options.profile ?? '(default credentials)'}`);
	logger.log(`  Role:         ${role}`);
	logger.log(
		`  Policy:       ${policyArn}${options.policyArn ? '' : '  (default; --policy-arn to narrow)'}`,
	);
	logger.log(`  Trusted by:   repo:${repo}:environment:${options.stage} only`);
	if (remote) {
		logger.log(
			`  Secrets:      ${hasSecrets ? `pushed to the store with ${via}` : `none on this machine — gkm secrets:push --stage ${options.stage} later`}`,
		);
	} else {
		logger.log(
			`  Secrets key:  ${hasKey ? keyPath : `none at ${keyPath} — run gkm secrets:init --stage ${options.stage} first`}`,
		);
	}

	if (options.dryRun) {
		logger.log('\n  --dry-run: nothing changed.\n');
		return { repo };
	}

	const iam = deps.iam ?? (await iamFor(options.profile));
	const providerArn = await ensureOidcProvider(iam).catch((error) => {
		// The first AWS call is where an expired SSO login surfaces; the SDK's
		// message does not say which profile, and this command knows.
		if (/SSO session/i.test(String(error?.message)) && options.profile) {
			throw new SsoSessionExpired(options.profile);
		}
		throw error;
	});
	const roleArn = await ensureRole(
		iam,
		role,
		trustPolicy(providerArn, repo, options.stage),
		policyArn,
	);
	logger.log(`\n  ✓ AWS: ${roleArn}`);

	// The environment the generated deploy workflow runs the stage in.
	gh(['api', '--method', 'PUT', `repos/${repo}/environments/${options.stage}`]);
	gh([
		'variable',
		'set',
		'AWS_ROLE_ARN',
		'--env',
		options.stage,
		'--repo',
		repo,
		'--body',
		roleArn,
	]);
	logger.log(`  ✓ GitHub: environment "${options.stage}", AWS_ROLE_ARN`);

	if (remote) {
		if (hasSecrets) {
			await pushStageSecrets(workspace, options.stage, {
				...(options.profile ? { profile: options.profile } : {}),
			});
			logger.log(
				`  ✓ Secrets: "${options.stage}" pushed to the store with ${via}`,
			);
		} else {
			logger.log(
				`  ⚠ No secrets for "${options.stage}" on this machine; the deploy job pulls them from the store, so push them: gkm secrets:push --stage ${options.stage}${options.profile ? ` --profile ${options.profile}` : ''}.`,
			);
		}
	} else if (hasKey) {
		// Through stdin, so the key is never an argument a process list shows.
		gh(
			[
				'secret',
				'set',
				'GKM_SECRETS_KEY',
				'--env',
				options.stage,
				'--repo',
				repo,
			],
			readFileSync(keyPath, 'utf-8').trim(),
		);
		logger.log('  ✓ GitHub: GKM_SECRETS_KEY');
	} else {
		logger.log(
			`  ⚠ No secrets key for "${options.stage}"; run gkm secrets:init --stage ${options.stage}, then this again.`,
		);
	}

	logger.log(
		`\n  Protect it: add required reviewers to the "${options.stage}" environment in the repository settings.\n`,
	);
	return { roleArn, repo };
}

/** The profile's SSO login has lapsed; the fix is one command away. */
export class SsoSessionExpired extends Error {
	constructor(readonly profile: string) {
		super(
			`The SSO session for profile "${profile}" has expired or is invalid. Run: aws sso login --profile ${profile}`,
		);
		this.name = 'SsoSessionExpired';
	}
}
