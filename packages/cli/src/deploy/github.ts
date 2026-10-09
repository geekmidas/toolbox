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
 * S3, SSM or Secrets Manager the deploy job reads them with the role instead, so
 * no key is handed to GitHub, and this checks the stage's store in the same
 * account, with the same profile. Re-running it converges rather than duplicating.
 *
 * The role trusts the exact `sub` GitHub sends for the environment, read from
 * the repository's OIDC subject settings (`githubOidc.ts`) — the default, the
 * immutable subject with the owner's and repository's ids, or a custom
 * template. A re-run rewrites an existing role's trust to it, so running this
 * again repairs a role that trusted the wrong format. What the role may do is
 * `githubPolicy.ts`: `AdministratorAccess` for SST, and for a compose stage
 * only its own secrets (and deploy state, when that is in AWS).
 */

import { execFileSync } from 'node:child_process';
import {
	AttachRolePolicyCommand,
	CreateOpenIDConnectProviderCommand,
	CreateRoleCommand,
	DeleteRolePolicyCommand,
	DetachRolePolicyCommand,
	GetRoleCommand,
	IAMClient,
	type IAMClientConfig,
	ListAttachedRolePoliciesCommand,
	ListOpenIDConnectProvidersCommand,
	ListRoleTagsCommand,
	PutRolePolicyCommand,
	TagRoleCommand,
	UntagRoleCommand,
	UpdateAssumeRolePolicyCommand,
} from '@aws-sdk/client-iam';
import { loadWorkspaceConfig } from '../config.js';
import { GkmError } from '../errors';
import { discover } from '../reconcile/discover.js';
import { constructGlobs } from '../reconcile/workspace.js';
import { getKeyPath, keystoreProject, readKey } from '../secrets/keystore.js';
import { isRemoteStore, secretsStoreFor } from '../secrets/store.js';
import { assertDeployedStage } from '../workspace/stages.js';
import { resolveOidcSubject } from './githubOidc.js';
import {
	accountOf,
	deployAccess,
	SCOPED_POLICY_NAME,
	scopedPolicyDocument,
} from './githubPolicy.js';

export { DEFAULT_POLICY_ARN, SCOPED_POLICY_NAME } from './githubPolicy.js';

const logger = console;

const GITHUB_OIDC_HOST = 'token.actions.githubusercontent.com';
const AUDIENCE = 'sts.amazonaws.com';

/**
 * The tag recording which managed policy gkm attached to the role — so a
 * re-run detaches only what gkm put there, never a policy someone else did.
 */
export const POLICY_TAG = 'gkm:policy-arn';

export interface DeployGithubOptions {
	stage: string;
	/** The AWS profile for the stage's account. */
	profile?: string;
	/** `owner/name`; defaults to the repository `gh` sees here. */
	repo?: string;
	/** The policy the deploy role gets, in place of the default. */
	policyArn?: string;
	dryRun?: boolean;
}

/** Runs `gh` with the given arguments and optional stdin, returning stdout. */
export type Gh = (args: string[], input?: string) => string;

const defaultGh: Gh = (args, input) =>
	execFileSync('gh', args, {
		encoding: 'utf-8',
		// stderr captured, so a read that fails (a 404) is not printed as noise.
		stdio: ['pipe', 'pipe', 'pipe'],
		...(input === undefined ? {} : { input }),
	}).trim();

/** The role a stage deploys as: `<project>-github-<stage>`, within IAM's 64. */
export function roleName(project: string, stage: string): string {
	return `${project}-github-${stage}`
		.toLowerCase()
		.replace(/[^a-z0-9+=,.@_-]/g, '-')
		.slice(0, 64);
}

/**
 * Who may assume the role: a workflow job whose OIDC token carries exactly
 * `subject` — the repository's `<stage>` environment, in the format the
 * repository sends (see `githubOidc.ts`), and nothing else. Not another
 * branch's job, not another environment's: that is what keeps a staging
 * deploy from using the production role.
 */
export function trustPolicy(providerArn: string, subject: string): string {
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
						[`${GITHUB_OIDC_HOST}:sub`]: subject,
					},
				},
			},
		],
	});
}

/**
 * The subject a trust policy trusts, or undefined when it names none. IAM
 * hands documents back URL-encoded.
 */
export function trustedSubject(
	document: string | undefined,
): string | undefined {
	if (!document) return undefined;
	let parsed: {
		Statement?: { Condition?: Record<string, Record<string, unknown>> }[];
	};
	try {
		parsed = JSON.parse(safeDecode(document));
	} catch {
		return undefined;
	}
	for (const statement of parsed.Statement ?? []) {
		for (const operator of Object.values(statement.Condition ?? {})) {
			const value = operator[`${GITHUB_OIDC_HOST}:sub`];
			if (typeof value === 'string') return value;
			if (Array.isArray(value)) return value.join(', ');
		}
	}
	return undefined;
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
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

/**
 * What the role is given: a managed policy, attached; or an inline policy
 * document — null for none at all.
 */
export type RoleAccess = { managed: string } | { inline: string | null };

/** What {@link ensureRole} did. */
export interface RoleOutcome {
	arn: string;
	created: boolean;
	/** The subject the role trusted before, when it existed. */
	previousSubject?: string;
	/** Managed policies gkm had attached and detached now. */
	detached: string[];
	/**
	 * Managed policies still attached that the role no longer needs, which gkm
	 * did not record attaching — left alone, for a person to detach.
	 */
	leftAttached: string[];
}

function isNoSuchEntity(error: unknown): boolean {
	return (error as { name?: string }).name === 'NoSuchEntityException';
}

/**
 * The deploy role, created or brought back to this trust and access.
 *
 * Converges: re-running rewrites the trust, and moves the role from one access
 * to another — detaching a managed policy only when the role's
 * {@link POLICY_TAG} says gkm attached it.
 */
export async function ensureRole(
	iam: IAMClient,
	name: string,
	trust: string,
	access: RoleAccess,
): Promise<RoleOutcome> {
	let arn: string;
	let created = false;
	let previousSubject: string | undefined;
	let recorded: string | undefined;
	try {
		const { Role } = await iam.send(new GetRoleCommand({ RoleName: name }));
		previousSubject = trustedSubject(Role!.AssumeRolePolicyDocument);
		await iam.send(
			new UpdateAssumeRolePolicyCommand({
				RoleName: name,
				PolicyDocument: trust,
			}),
		);
		arn = Role!.Arn!;
		const { Tags = [] } = await iam.send(
			new ListRoleTagsCommand({ RoleName: name }),
		);
		recorded = Tags.find((tag) => tag.Key === POLICY_TAG)?.Value;
	} catch (error) {
		if (!isNoSuchEntity(error)) throw error;
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
		created = true;
	}

	const detached: string[] = [];
	const leftAttached: string[] = [];
	const detach = async (policyArn: string) => {
		try {
			await iam.send(
				new DetachRolePolicyCommand({ RoleName: name, PolicyArn: policyArn }),
			);
			detached.push(policyArn);
		} catch (error) {
			// Already gone — by hand, or a run that stopped halfway.
			if (!isNoSuchEntity(error)) throw error;
		}
	};
	const deleteInline = async () => {
		try {
			await iam.send(
				new DeleteRolePolicyCommand({
					RoleName: name,
					PolicyName: SCOPED_POLICY_NAME,
				}),
			);
		} catch (error) {
			if (!isNoSuchEntity(error)) throw error;
		}
	};

	if ('managed' in access) {
		// Attaching an attached policy is a no-op, so this converges too.
		await iam.send(
			new AttachRolePolicyCommand({
				RoleName: name,
				PolicyArn: access.managed,
			}),
		);
		if (recorded && recorded !== access.managed) await detach(recorded);
		if (recorded !== access.managed) {
			await iam.send(
				new TagRoleCommand({
					RoleName: name,
					Tags: [{ Key: POLICY_TAG, Value: access.managed }],
				}),
			);
		}
		if (!created) await deleteInline();
		return { arn, created, previousSubject, detached, leftAttached };
	}

	if (access.inline) {
		await iam.send(
			new PutRolePolicyCommand({
				RoleName: name,
				PolicyName: SCOPED_POLICY_NAME,
				PolicyDocument: access.inline,
			}),
		);
	} else if (!created) {
		await deleteInline();
	}
	if (created) return { arn, created, previousSubject, detached, leftAttached };

	if (recorded) {
		await detach(recorded);
		await iam.send(
			new UntagRoleCommand({ RoleName: name, TagKeys: [POLICY_TAG] }),
		);
	}
	// A role from before gkm recorded what it attached: what is attached may
	// be gkm's or someone's own, so it is named, not detached.
	const { AttachedPolicies = [] } = await iam.send(
		new ListAttachedRolePoliciesCommand({ RoleName: name }),
	);
	for (const policy of AttachedPolicies) {
		if (policy.PolicyArn && !detached.includes(policy.PolicyArn)) {
			leftAttached.push(policy.PolicyArn);
		}
	}
	return { arn, created, previousSubject, detached, leftAttached };
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
): Promise<{ roleArn?: string; repo: string; subject: string }> {
	const gh = deps.gh ?? defaultGh;
	const { workspace } = await loadWorkspaceConfig(deps.cwd);
	assertDeployedStage(workspace.stages, options.stage);

	const repo =
		options.repo ??
		gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
	const role = roleName(workspace.name, options.stage);
	// The exact subject GitHub will send — read from the repository's OIDC
	// settings, before anything is changed, so a format no role can trust
	// fails here.
	const oidc = resolveOidcSubject(gh, repo, options.stage);
	// The buckets an s3 provider creates are named after their constructs,
	// and a stage with a database is backed up: the role is scoped to
	// exactly those.
	const manifest = await discover({
		patterns: constructGlobs(workspace),
		cwd: workspace.root,
	});
	const access = deployAccess(
		workspace,
		options.stage,
		options.policyArn,
		manifest,
	);
	// Read through the keystore so a key still at the place keys used to be kept
	// is found, and copied to where it is kept now.
	const key = await readKey(options.stage, keystoreProject(workspace));
	const keyPath = getKeyPath(options.stage, keystoreProject(workspace));
	const hasKey = key !== null;
	// A stage whose secrets are in a store is read from there by the deploy job,
	// with the role; it needs no key on GitHub.
	const remote = isRemoteStore(workspace, options.stage);
	// Read from the stage's own store, with the same credentials the role is
	// created with: what the deploy job will find there.
	const store = await secretsStoreFor(workspace, options.stage, {
		...(options.profile ? { profile: options.profile } : {}),
	});
	const hasSecrets = remote && (await store.read(options.stage)) !== null;
	const via = options.profile
		? `profile "${options.profile}"`
		: 'the default credentials';

	logger.log(`\n🔐 GitHub → AWS for stage "${options.stage}"\n`);
	logger.log(`  Repository:   ${repo}`);
	logger.log(`  AWS profile:  ${options.profile ?? '(default credentials)'}`);
	logger.log(`  Role:         ${role}`);
	if (access.kind === 'managed') {
		logger.log(`  Policy:       ${access.policyArn}  (${access.reason})`);
	} else if (access.describe.length > 0) {
		logger.log(
			`  Policy:       inline "${SCOPED_POLICY_NAME}", scoped to the compose deploy — only:`,
		);
		for (const line of access.describe) logger.log(`                  ${line}`);
	} else {
		logger.log(
			'  Policy:       none — a compose deploy with file secrets and local state reads nothing from AWS',
		);
	}
	logger.log(
		`  Trusted by:   ${oidc.subject} only  (${SUBJECT_KINDS[oidc.kind]})`,
	);
	if (oidc.warning) logger.log(`  ⚠ ${oidc.warning}`);
	if (remote) {
		logger.log(
			`  Secrets:      ${hasSecrets ? `in the store (${store.name}), read with ${via}` : `none in the store yet — gkm secrets:set <KEY> '…' --stage ${options.stage}`}`,
		);
	} else {
		logger.log(
			`  Secrets key:  ${hasKey ? keyPath : `none at ${keyPath} — run gkm secrets:init --stage ${options.stage} first`}`,
		);
	}

	if (options.dryRun) {
		if (access.kind === 'scoped') {
			const document = scopedPolicyDocument(access.statements('<account>'));
			if (document) {
				logger.log(
					`\n  Inline policy:\n${JSON.stringify(JSON.parse(document), null, 2).replace(/^/gm, '    ')}`,
				);
			}
		}
		logger.log('\n  --dry-run: nothing changed.\n');
		return { repo, subject: oidc.subject };
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
	const outcome = await ensureRole(
		iam,
		role,
		trustPolicy(providerArn, oidc.subject),
		access.kind === 'managed'
			? { managed: access.policyArn }
			: {
					inline: scopedPolicyDocument(
						access.statements(accountOf(providerArn)),
					),
				},
	);
	const roleArn = outcome.arn;
	logger.log(`\n  ✓ AWS: ${roleArn}${outcome.created ? ' (created)' : ''}`);
	if (!outcome.created) {
		logger.log(
			outcome.previousSubject === oidc.subject
				? `  ✓ Trust: unchanged, ${oidc.subject}`
				: `  ✓ Trust: ${outcome.previousSubject ?? '(no subject)'} → ${oidc.subject}`,
		);
	}
	for (const detached of outcome.detached) {
		logger.log(`  ✓ Detached ${detached} (attached by gkm, no longer needed)`);
	}
	if (access.kind === 'scoped') {
		for (const attached of outcome.leftAttached) {
			logger.log(
				`  ⚠ ${attached} is still attached to ${role}. gkm has no record of attaching it, so it is left; the compose deploy does not need it. Detach it with: aws iam detach-role-policy --role-name ${role} --policy-arn ${attached}${options.profile ? ` --profile ${options.profile}` : ''}`,
			);
		}
	}

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
		// Nothing to send: the deploy job reads the stage's store itself.
		if (!hasSecrets) {
			logger.log(
				`  ⚠ The "${options.stage}" store holds no secrets yet; set them with gkm secrets:set <KEY> '…' --stage ${options.stage}${options.profile ? ` (AWS_PROFILE=${options.profile})` : ''}.`,
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
			key!,
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
	return { roleArn, repo, subject: oidc.subject };
}

const SUBJECT_KINDS = {
	default: "the repository's default subject",
	immutable: "the repository's immutable subject",
	custom: "the repository's custom subject template",
	assumed: 'assumed: the default format',
} as const;

/** The profile's SSO login has lapsed; the fix is one command away. */
export class SsoSessionExpired extends GkmError {
	constructor(readonly profile: string) {
		super(
			`The SSO session for profile "${profile}" has expired or is invalid. Run: aws sso login --profile ${profile}`,
		);
		this.name = 'SsoSessionExpired';
	}
}
