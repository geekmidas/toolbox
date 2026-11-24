/**
 * GitHub → Google for `gkm deploy:github`: what lets a stage's deploy job
 * sign in to Google Cloud with its own OIDC token, and no key stored
 * anywhere — the counterpart of the AWS role in `github.ts`.
 *
 * In the stage's home project (`--project`, else the first project one of
 * its Google providers works in):
 *
 * 1. the APIs keyless sign-in runs on: IAM, IAM Credentials, STS;
 * 2. a Workload Identity pool, `github`, and in it a provider for this
 *    repository: GitHub's issuer, the token's `sub` as the Google subject,
 *    and an attribute condition that admits this repository's tokens only;
 * 3. a deploy service account for the stage, `gkm-github-<stage>`, that the
 *    stage environment's subject — exactly the `sub` the AWS role trusts —
 *    may act as (`roles/iam.workloadIdentityUser`);
 * 4. the roles the stage's Google providers say a deploy from CI needs
 *    (`ResourceProvider.ciGrants`), and no others: a role the account holds
 *    on a project it is no longer needed in is taken away.
 *
 * The deploy job signs in with `google-github-actions/auth`, given
 * `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_SERVICE_ACCOUNT` from the stage's
 * GitHub environment.
 */

import { createHash } from 'node:crypto';
import { GkmError } from '../errors';
import { stageGoogleGrants } from '../providers/clouds.js';
import {
	finished,
	GoogleApiError,
	type GoogleClient,
} from '../providers/google/client.js';
import { googleProject } from '../providers/google/project.js';
import {
	assertGoogleId,
	CLOUD_RESOURCE_MANAGER,
	enableService,
	ensureServiceAccount,
	IAM,
	serviceAccountEmail,
} from '../providers/google/resources.js';
import type { GoogleCiGrant } from '../providers/types.js';
import type { NormalizedWorkspace } from '../workspace/types.js';

/** The Workload Identity pool every repository's provider is kept in. */
export const WIF_POOL = 'github';

/** Who issues a GitHub Actions job's OIDC token. */
export const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com';

/** The role that lets a federated subject act as a service account. */
export const WORKLOAD_IDENTITY_USER = 'roles/iam.workloadIdentityUser';

/** What keyless sign-in runs on, turned on in the home project. */
export const WIF_SERVICES = [
	'iam.googleapis.com',
	'iamcredentials.googleapis.com',
	'sts.googleapis.com',
] as const;

/** The project to set the trust up in is not there, or not visible. */
export class GoogleCiProjectMissing extends GkmError {
	constructor(
		readonly stage: string,
		readonly project: string,
	) {
		super(
			`The Google Cloud project '${project}' does not exist, or you cannot ` +
				`see it. Deploy '${stage}' once from a terminal first — it creates ` +
				`the project — or name the project it uses with --project.`,
		);
		this.name = 'GoogleCiProjectMissing';
	}
}

/** A service account a role is to be granted on is not there yet. */
export class GoogleCiGrantTargetMissing extends GkmError {
	constructor(
		readonly stage: string,
		readonly serviceAccount: string,
	) {
		super(
			`CI is to read ${serviceAccount}, and it does not exist yet. Deploy ` +
				`'${stage}' once from a terminal first — it creates the account — ` +
				`then run gkm deploy:github --stage ${stage} again.`,
		);
		this.name = 'GoogleCiGrantTargetMissing';
	}
}

/**
 * The pool's provider for one repository: `gh-<repo>-<hash>`, within
 * Google's 4–32 lowercase letters, digits and hyphens. The hash keeps two
 * repositories whose names share a long prefix apart.
 */
export function wifProviderId(repo: string): string {
	const hash = createHash('sha256')
		.update(repo.toLowerCase())
		.digest('hex')
		.slice(0, 6);
	const slug = repo
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 22)
		.replace(/-+$/, '');
	return `gh-${slug}-${hash}`;
}

/** The stage's deploy service account: `gkm-github-<stage>`, within 30. */
export function deployAccountId(stage: string): string {
	const clean = stage
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	const id = `gkm-github-${clean}`.slice(0, 30).replace(/-+$/, '');
	assertGoogleId('service account', id);
	return id;
}

/** The pool's resource name, by project number. */
export function poolName(projectNumber: string): string {
	return `projects/${projectNumber}/locations/global/workloadIdentityPools/${WIF_POOL}`;
}

/** The federated principal a job's `sub` is in the pool. */
export function principalFor(projectNumber: string, subject: string): string {
	return `principal://iam.googleapis.com/${poolName(projectNumber)}/subject/${subject}`;
}

/** The condition that admits this repository's tokens and no other's. */
export function repositoryCondition(repo: string): string {
	return `assertion.repository == '${repo}'`;
}

/** How a token's claims become the Google subject and attributes. */
export const ATTRIBUTE_MAPPING = {
	'google.subject': 'assertion.sub',
	'attribute.repository': 'assertion.repository',
} as const;

/** What `deploy:github` sets up in Google for a stage. */
export interface GoogleTrustPlan {
	/** Where the pool and the deploy account live. */
	project: string;
	providerId: string;
	condition: string;
	account: string;
	email: string;
	grants: readonly GoogleCiGrant[];
}

/** The plan for `stage`, from its Google providers. */
export function planGoogleTrust(input: {
	workspace: NormalizedWorkspace;
	stage: string;
	repo: string;
	/** `--project`. */
	project?: string;
}): GoogleTrustPlan {
	const grants = stageGoogleGrants(input.workspace, input.stage, input.project);
	const project =
		input.project ??
		grants[0]?.project ??
		googleProject({ workspace: input.workspace.name, stage: input.stage });
	assertGoogleId('project', project);
	const account = deployAccountId(input.stage);
	return {
		project,
		providerId: wifProviderId(input.repo),
		condition: repositoryCondition(input.repo),
		account,
		email: serviceAccountEmail(project, account),
		grants,
	};
}

/** An IAM policy, as `getIamPolicy` answers it. */
export interface IamPolicy {
	version?: number;
	etag?: string;
	bindings?: IamBinding[];
}

export interface IamBinding {
	role: string;
	members: string[];
	condition?: unknown;
}

/**
 * `policy` with `member` holding exactly `roles` among its unconditional
 * bindings: added where missing, taken off every other role. What it added
 * and removed, so a caller knows whether to write it.
 */
export function withMemberRoles(
	policy: IamPolicy,
	member: string,
	roles: readonly string[],
): { policy: IamPolicy; added: string[]; removed: string[] } {
	const wanted = new Set(roles);
	const added: string[] = [];
	const removed: string[] = [];
	const bindings: IamBinding[] = [];
	const held = new Set<string>();
	for (const binding of policy.bindings ?? []) {
		if (binding.condition !== undefined) {
			bindings.push(binding);
			continue;
		}
		const has = binding.members.includes(member);
		if (has && !wanted.has(binding.role)) {
			removed.push(binding.role);
			const members = binding.members.filter((m) => m !== member);
			if (members.length > 0) bindings.push({ ...binding, members });
			continue;
		}
		if (wanted.has(binding.role)) {
			held.add(binding.role);
			if (!has) {
				added.push(binding.role);
				bindings.push({ ...binding, members: [...binding.members, member] });
				continue;
			}
		}
		bindings.push(binding);
	}
	for (const role of [...wanted].sort()) {
		if (held.has(role)) continue;
		added.push(role);
		bindings.push({ role, members: [member] });
	}
	return { policy: { ...policy, bindings }, added, removed };
}

/**
 * `policy` with `principal` the one subject of the pool that may act as the
 * account: another subject of the same pool — the stage's previous
 * environment subject — is replaced, a member from elsewhere kept. The
 * subjects it replaced.
 */
export function withPoolSubject(
	policy: IamPolicy,
	pool: string,
	principal: string,
): { policy: IamPolicy; replaced: string[]; changed: boolean } {
	const prefix = `principal://iam.googleapis.com/${pool}/subject/`;
	let found = false;
	let changed = false;
	const replaced: string[] = [];
	const bindings = (policy.bindings ?? []).map((binding) => {
		if (binding.role !== WORKLOAD_IDENTITY_USER || binding.condition) {
			return binding;
		}
		found = true;
		const kept = binding.members.filter((member) => {
			if (!member.startsWith(prefix) || member === principal) return true;
			replaced.push(member.slice(prefix.length));
			return false;
		});
		if (!kept.includes(principal)) kept.push(principal);
		if (kept.length !== binding.members.length || replaced.length > 0) {
			changed = true;
		}
		return { ...binding, members: kept };
	});
	if (!found) {
		bindings.push({ role: WORKLOAD_IDENTITY_USER, members: [principal] });
		changed = true;
	}
	return { policy: { ...policy, bindings }, replaced, changed };
}

/** What setting the trust up came to. */
export interface GoogleTrustOutcome {
	/** `projects/<number>/locations/global/workloadIdentityPools/github/providers/<id>`. */
	provider: string;
	serviceAccount: string;
	/** One line per change made. */
	changes: string[];
}

interface Operation {
	name?: string;
	done?: boolean;
	error?: { message?: string };
}

interface WifResource {
	name: string;
	state?: string;
	attributeCondition?: string;
	attributeMapping?: Record<string, string>;
}

const notFound = (error: unknown) =>
	error instanceof GoogleApiError && error.status === 404;

async function read<T>(
	client: GoogleClient,
	url: string,
): Promise<T | undefined> {
	try {
		return await client.request<T>('GET', url);
	} catch (error) {
		if (notFound(error)) return undefined;
		throw error;
	}
}

/**
 * Sets the trust up for `subject`: every step finds what is there before it
 * makes anything, so a second run changes only what drifted.
 *
 * @throws {GoogleCiProjectMissing}
 * @throws {GoogleCiGrantTargetMissing}
 */
export async function ensureGoogleTrust(
	clients: {
		/** Without a quota project: projects and Service Usage. */
		bare: GoogleClient;
		/** Sending the home project as the quota project. */
		project: GoogleClient;
	},
	input: { stage: string; plan: GoogleTrustPlan; subject: string },
	options: { intervalMs?: number } = {},
): Promise<GoogleTrustOutcome> {
	const { plan, stage, subject } = input;
	const { bare, project: client } = clients;
	const wait = options.intervalMs !== undefined ? options : {};
	const changes: string[] = [];

	let number: string;
	try {
		const found = await bare.request<{ name: string }>(
			'GET',
			`${CLOUD_RESOURCE_MANAGER}/projects/${plan.project}`,
		);
		number = found.name.replace(/^projects\//, '');
	} catch (error) {
		if (
			error instanceof GoogleApiError &&
			(error.status === 403 || error.status === 404)
		) {
			throw new GoogleCiProjectMissing(stage, plan.project);
		}
		throw error;
	}

	for (const service of WIF_SERVICES) {
		await enableService(bare, plan.project, service, wait);
	}

	// The pool. A deleted pool keeps its id for 30 days: brought back.
	const poolPath = `${IAM}/projects/${plan.project}/locations/global/workloadIdentityPools`;
	const pool = await read<WifResource>(client, `${poolPath}/${WIF_POOL}`);
	if (!pool) {
		const operation = await client.request<Operation>(
			'POST',
			`${poolPath}?workloadIdentityPoolId=${WIF_POOL}`,
			{ displayName: 'GitHub Actions', description: 'gkm deploy:github' },
		);
		await finished(client, IAM, operation, wait);
		changes.push(`pool ${WIF_POOL} (created)`);
	} else if (pool.state === 'DELETED') {
		const operation = await client.request<Operation>(
			'POST',
			`${poolPath}/${WIF_POOL}:undelete`,
			{},
		);
		await finished(client, IAM, operation, wait);
		changes.push(`pool ${WIF_POOL} (restored)`);
	}

	// The repository's provider in it.
	const providerPath = `${poolPath}/${WIF_POOL}/providers`;
	const wanted = {
		displayName: plan.providerId,
		attributeMapping: { ...ATTRIBUTE_MAPPING },
		attributeCondition: plan.condition,
		oidc: { issuerUri: GITHUB_ISSUER },
	};
	const provider = await read<WifResource>(
		client,
		`${providerPath}/${plan.providerId}`,
	);
	if (!provider) {
		const operation = await client.request<Operation>(
			'POST',
			`${providerPath}?workloadIdentityPoolProviderId=${plan.providerId}`,
			wanted,
		);
		await finished(client, IAM, operation, wait);
		changes.push(`provider ${plan.providerId} (created)`);
	} else {
		if (provider.state === 'DELETED') {
			const operation = await client.request<Operation>(
				'POST',
				`${providerPath}/${plan.providerId}:undelete`,
				{},
			);
			await finished(client, IAM, operation, wait);
			changes.push(`provider ${plan.providerId} (restored)`);
		}
		const mapping = provider.attributeMapping ?? {};
		const drifted =
			provider.attributeCondition !== plan.condition ||
			Object.entries(ATTRIBUTE_MAPPING).some(
				([key, value]) => mapping[key] !== value,
			) ||
			Object.keys(mapping).length !== Object.keys(ATTRIBUTE_MAPPING).length;
		if (drifted) {
			const operation = await client.request<Operation>(
				'PATCH',
				`${providerPath}/${plan.providerId}?updateMask=attributeCondition,attributeMapping`,
				wanted,
			);
			await finished(client, IAM, operation, wait);
			changes.push(`provider ${plan.providerId} (condition and mapping reset)`);
		}
	}

	// The deploy account, and who may act as it.
	const email = await ensureServiceAccount(
		client,
		plan.project,
		plan.account,
		`GitHub deploy of ${stage} (gkm)`,
	);
	const accountPath = `${IAM}/projects/${plan.project}/serviceAccounts/${email}`;
	const accountPolicy = await client.request<IamPolicy>(
		'POST',
		`${accountPath}:getIamPolicy`,
		{},
	);
	const trust = withPoolSubject(
		accountPolicy,
		poolName(number),
		principalFor(number, subject),
	);
	if (trust.changed) {
		await client.request('POST', `${accountPath}:setIamPolicy`, {
			policy: trust.policy,
		});
		changes.push(
			trust.replaced.length > 0
				? `trust ${trust.replaced.join(', ')} → ${subject}`
				: `trust ${subject}`,
		);
	}

	// The project roles: exactly what the providers need, by project. The
	// home project is always read, so a role no provider needs any more is
	// taken off there even when nothing is granted in it now.
	const member = `serviceAccount:${email}`;
	const byProject = new Map<string, string[]>([[plan.project, []]]);
	for (const grant of plan.grants) {
		if (grant.serviceAccount) continue;
		const roles = byProject.get(grant.project) ?? [];
		if (!roles.includes(grant.role)) roles.push(grant.role);
		byProject.set(grant.project, roles);
	}
	for (const [project, roles] of byProject) {
		const url = `${CLOUD_RESOURCE_MANAGER}/projects/${project}`;
		const policy = await bare.request<IamPolicy>(
			'POST',
			`${url}:getIamPolicy`,
			{
				options: { requestedPolicyVersion: 3 },
			},
		);
		const next = withMemberRoles(policy, member, roles);
		if (next.added.length === 0 && next.removed.length === 0) continue;
		await bare.request('POST', `${url}:setIamPolicy`, {
			policy: { ...next.policy, version: 3 },
		});
		for (const role of next.added) changes.push(`${project}: ${role}`);
		for (const role of next.removed) {
			changes.push(`${project}: ${role} (no longer needed, removed)`);
		}
	}

	// Roles on one account — never the project's every account.
	for (const grant of plan.grants) {
		if (!grant.serviceAccount) continue;
		const url = `${IAM}/projects/${grant.project}/serviceAccounts/${grant.serviceAccount}`;
		let policy: IamPolicy;
		try {
			policy = await client.request<IamPolicy>(
				'POST',
				`${url}:getIamPolicy`,
				{},
			);
		} catch (error) {
			if (notFound(error)) {
				throw new GoogleCiGrantTargetMissing(stage, grant.serviceAccount);
			}
			throw error;
		}
		const binding = policy.bindings?.find(
			(b) => b.role === grant.role && !b.condition,
		);
		if (binding?.members.includes(member)) continue;
		const bindings = binding
			? (policy.bindings ?? []).map((b) =>
					b === binding ? { ...b, members: [...b.members, member] } : b,
				)
			: [...(policy.bindings ?? []), { role: grant.role, members: [member] }];
		await client.request('POST', `${url}:setIamPolicy`, {
			policy: { ...policy, bindings },
		});
		changes.push(`${grant.serviceAccount}: ${grant.role}`);
	}

	return {
		provider: `${poolName(number)}/providers/${plan.providerId}`,
		serviceAccount: email,
		changes,
	};
}
