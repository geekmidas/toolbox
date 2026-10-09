/**
 * The `sub` GitHub puts in a deploy job's OIDC token — what the deploy role's
 * trust policy has to match exactly.
 *
 * It is not always `repo:<owner>/<name>:environment:<stage>`. A repository
 * (or its organisation) decides the format, and says which through
 * `GET /repos/{owner}/{repo}/actions/oidc/customization/sub`:
 *
 * - the default: `repo:<owner>/<name>:environment:<stage>`;
 * - the immutable subject — the default for repositories created after
 *   15 July 2026, opt-in before — puts the owner's and the repository's ids in
 *   the `repo` segment: `repo:<owner>@<ownerId>/<name>@<repoId>:environment:<stage>`.
 *   The API hands that segment back as `sub_claim_prefix`;
 * - a custom template (`use_default: false`) builds the `sub` from
 *   `include_claim_keys`, in order, each as `<key>:<value>` joined by `:`,
 *   where `context` is `environment:<stage>` in an environment job.
 *
 * A `:` inside a value is sent as `%3A`.
 *
 * See https://docs.github.com/en/actions/reference/security/oidc.
 */

import { GkmError } from '../errors';
import type { Gh } from './github.js';

/** `GET /repos/{owner}/{repo}/actions/oidc/customization/sub`. */
export interface OidcSubjectCustomization {
	use_default: boolean;
	include_claim_keys?: string[];
	use_immutable_subject?: boolean;
	/** The `repo` segment of the subject, as GitHub will send it. */
	sub_claim_prefix?: string;
}

/** What `GET /repos/{owner}/{repo}` says that a subject may include. */
export interface RepoFacts {
	ownerId: number;
	repoId: number;
	visibility: string;
}

/**
 * Template keys whose values are known for a repository's environment job
 * before the job runs. Anything else — `job_workflow_ref`, `ref`, `sha`,
 * `run_id`, `workflow`, `actor`, a custom property — depends on the run.
 */
export const SUPPORTED_CLAIM_KEYS = [
	'repo',
	'context',
	'environment',
	'repository',
	'repository_owner',
	'repository_owner_id',
	'repository_id',
	'repository_visibility',
] as const;

const NEEDS_FACTS = new Set([
	'repository_owner_id',
	'repository_id',
	'repository_visibility',
]);

/** A `:` inside a claim value is sent as `%3A`. */
function claim(value: string): string {
	return value.replaceAll(':', '%3A');
}

/** Which kind of subject the repository uses, for the output. */
export type OidcSubjectKind = 'default' | 'immutable' | 'custom' | 'assumed';

/** Whether {@link oidcSubject} needs the repository's ids or visibility. */
export function needsRepoFacts(
	customization: OidcSubjectCustomization,
): boolean {
	const immutableWithoutPrefix =
		customization.use_immutable_subject === true &&
		!customization.sub_claim_prefix;
	if (customization.use_default) return immutableWithoutPrefix;

	const keys = customization.include_claim_keys ?? [];
	return keys.some(
		(key) => NEEDS_FACTS.has(key) || (key === 'repo' && immutableWithoutPrefix),
	);
}

/**
 * The exact `sub` of a job in `repo`'s `stage` environment.
 *
 * @throws OidcSubjectNotSupported when a custom template includes a claim
 *   whose value depends on the run, so no one subject can be trusted.
 */
export function oidcSubject(
	repo: string,
	stage: string,
	customization: OidcSubjectCustomization,
	facts?: RepoFacts,
): { subject: string; kind: OidcSubjectKind } {
	const [owner = '', name = ''] = repo.split('/');
	const environment = `environment:${claim(stage)}`;

	const repoSegment = (): string => {
		if (customization.sub_claim_prefix) return customization.sub_claim_prefix;
		if (customization.use_immutable_subject) {
			if (!facts) throw new RepoFactsRequired(repo);
			return `repo:${owner}@${facts.ownerId}/${name}@${facts.repoId}`;
		}
		return `repo:${repo}`;
	};
	const immutable =
		customization.use_immutable_subject === true ||
		customization.sub_claim_prefix !== undefined;

	if (customization.use_default) {
		return {
			subject: `${repoSegment()}:${environment}`,
			kind: immutable ? 'immutable' : 'default',
		};
	}

	const keys = customization.include_claim_keys ?? [];
	const unsupported = keys.filter(
		(key) => !(SUPPORTED_CLAIM_KEYS as readonly string[]).includes(key),
	);
	if (keys.length === 0 || unsupported.length > 0) {
		throw new OidcSubjectNotSupported(repo, keys, unsupported);
	}
	if (keys.some((key) => NEEDS_FACTS.has(key)) && !facts) {
		throw new RepoFactsRequired(repo);
	}

	const parts = keys.map((key) => {
		switch (key) {
			case 'repo':
				return repoSegment();
			case 'context':
			case 'environment':
				return environment;
			case 'repository':
				return `repository:${claim(repo)}`;
			case 'repository_owner':
				return `repository_owner:${claim(owner)}`;
			case 'repository_owner_id':
				return `repository_owner_id:${facts!.ownerId}`;
			case 'repository_id':
				return `repository_id:${facts!.repoId}`;
			default:
				return `repository_visibility:${claim(facts!.visibility)}`;
		}
	});
	return { subject: parts.join(':'), kind: 'custom' };
}

/** What {@link resolveOidcSubject} found. */
export interface ResolvedOidcSubject {
	subject: string;
	kind: OidcSubjectKind;
	/** Set when the format could not be read and the default was assumed. */
	warning?: string;
}

/** The endpoint a repository's subject format is read from. */
export function customizationEndpoint(repo: string): string {
	return `repos/${repo}/actions/oidc/customization/sub`;
}

/**
 * The `sub` GitHub will send for `repo`'s `stage` environment, read from the
 * repository's OIDC settings through `gh`.
 *
 * A repository on a custom template that names no keys of its own uses its
 * organisation's, read from `orgs/{owner}/actions/oidc/customization/sub`.
 * When the settings cannot be read at all — no permission, or a GitHub
 * Enterprise Server without the endpoint — the default format is assumed, with
 * a warning saying where to check it.
 */
export function resolveOidcSubject(
	gh: Gh,
	repo: string,
	stage: string,
): ResolvedOidcSubject {
	const endpoint = customizationEndpoint(repo);
	let customization: OidcSubjectCustomization;
	try {
		customization = JSON.parse(gh(['api', endpoint]));
	} catch {
		return {
			subject: `repo:${repo}:environment:${claim(stage)}`,
			kind: 'assumed',
			warning: `Could not read ${endpoint}, so the default subject format is assumed. Check it with: gh api ${endpoint} — a repository on the immutable subject or a custom template sends a different sub, and the role would not be assumable.`,
		};
	}

	if (
		!customization.use_default &&
		(customization.include_claim_keys ?? []).length === 0
	) {
		// The repository follows its organisation's template.
		const [owner = ''] = repo.split('/');
		const orgEndpoint = `orgs/${owner}/actions/oidc/customization/sub`;
		let org: { include_claim_keys?: string[]; use_immutable_subject?: boolean };
		try {
			org = JSON.parse(gh(['api', orgEndpoint]));
		} catch {
			throw new OrgOidcTemplateUnreadable(repo, orgEndpoint);
		}
		customization = {
			...customization,
			include_claim_keys: org.include_claim_keys ?? [],
			use_immutable_subject:
				customization.use_immutable_subject ?? org.use_immutable_subject,
		};
	}

	const facts = needsRepoFacts(customization)
		? readRepoFacts(gh, repo)
		: undefined;
	return oidcSubject(repo, stage, customization, facts);
}

function readRepoFacts(gh: Gh, repo: string): RepoFacts {
	const raw = JSON.parse(gh(['api', `repos/${repo}`])) as {
		id: number;
		owner: { id: number };
		visibility: string;
	};
	return {
		ownerId: raw.owner.id,
		repoId: raw.id,
		visibility: raw.visibility,
	};
}

/**
 * The repository's custom subject template includes a claim whose value
 * depends on the run — or names none — so no one subject can be trusted.
 */
export class OidcSubjectNotSupported extends GkmError {
	constructor(
		readonly repo: string,
		readonly includeClaimKeys: string[],
		readonly unsupportedKeys: string[],
	) {
		super(
			`${repo} builds its OIDC subject from a custom template, ${JSON.stringify(includeClaimKeys)}, and ${
				unsupportedKeys.length > 0
					? `${unsupportedKeys.join(', ')} depend${unsupportedKeys.length === 1 ? 's' : ''} on the run`
					: 'it names no claims'
			}, so the deploy role cannot trust one exact subject. Set the repository back to the default subject — gh api --method PUT ${customizationEndpoint(repo)} -F use_default=true — (or keep the immutable one by also passing -F use_immutable_subject=true), or use a template built only from ${SUPPORTED_CLAIM_KEYS.join(', ')}; then run this again.`,
		);
		this.name = 'OidcSubjectNotSupported';
	}
}

/** The subject needs the repository's ids, and none were read. */
export class RepoFactsRequired extends GkmError {
	constructor(readonly repo: string) {
		super(
			`The OIDC subject of ${repo} includes its owner and repository ids; read them with gh api repos/${repo} and pass them in.`,
		);
		this.name = 'RepoFactsRequired';
	}
}

/**
 * The repository uses its organisation's subject template, and that template
 * could not be read — so what GitHub sends is unknown, and is not guessed.
 */
export class OrgOidcTemplateUnreadable extends GkmError {
	constructor(
		readonly repo: string,
		readonly endpoint: string,
	) {
		super(
			`${repo} uses its organisation's OIDC subject template, and ${endpoint} could not be read. Run this as an organisation owner (gh auth refresh -s admin:org), or set the repository back to the default subject with gh api --method PUT ${customizationEndpoint(repo)} -F use_default=true; then run this again.`,
		);
		this.name = 'OrgOidcTemplateUnreadable';
	}
}
