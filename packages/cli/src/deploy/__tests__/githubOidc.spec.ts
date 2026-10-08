import { describe, expect, it } from 'vitest';
import type { Gh } from '../github';
import {
	OidcSubjectNotSupported,
	OrgOidcTemplateUnreadable,
	oidcSubject,
	resolveOidcSubject,
} from '../githubOidc';

/**
 * A `gh` that answers `gh api <path>` from a table, as GitHub would, and
 * fails — like `gh` on a 404 or a 403 — for any path it has no answer for.
 */
function ghAnswering(answers: Record<string, unknown>) {
	const asked: string[] = [];
	const gh: Gh = (args) => {
		const path = args[1]!;
		asked.push(path);
		if (args[0] !== 'api' || !(path in answers)) {
			throw new Error(
				`gh: HTTP 404: Not Found (https://api.github.com/${path})`,
			);
		}
		return JSON.stringify(answers[path]);
	};
	return { gh, asked };
}

const ENDPOINT = 'repos/acme/shop/actions/oidc/customization/sub';

describe('oidcSubject', () => {
	it('is repo:<owner>/<name>:environment:<stage> by default', () => {
		expect(oidcSubject('acme/shop', 'prod', { use_default: true })).toEqual({
			subject: 'repo:acme/shop:environment:prod',
			kind: 'default',
		});
	});

	it('uses the immutable prefix GitHub hands back', () => {
		// What GitHub answers for a repository on the immutable subject.
		const customization = {
			use_default: true,
			use_immutable_subject: true,
			sub_claim_prefix: 'repo:acme@1234/shop@5678',
		};

		expect(oidcSubject('acme/shop', 'prod', customization)).toEqual({
			subject: 'repo:acme@1234/shop@5678:environment:prod',
			kind: 'immutable',
		});
	});

	it('builds the immutable prefix from the ids when none is handed back', () => {
		expect(
			oidcSubject(
				'acme/shop',
				'prod',
				{ use_default: true, use_immutable_subject: true },
				{ ownerId: 1234, repoId: 5678, visibility: 'private' },
			).subject,
		).toBe('repo:acme@1234/shop@5678:environment:prod');
	});

	it('builds a custom template from known claims, in its order', () => {
		const result = oidcSubject(
			'acme/shop',
			'prod',
			{
				use_default: false,
				include_claim_keys: [
					'repository_owner_id',
					'repository_visibility',
					'context',
				],
			},
			{ ownerId: 1234, repoId: 5678, visibility: 'private' },
		);

		expect(result).toEqual({
			subject:
				'repository_owner_id:1234:repository_visibility:private:environment:prod',
			kind: 'custom',
		});
	});

	it('rebuilds the default from a ["repo", "context"] template', () => {
		expect(
			oidcSubject('acme/shop', 'prod', {
				use_default: false,
				include_claim_keys: ['repo', 'context'],
			}).subject,
		).toBe('repo:acme/shop:environment:prod');
	});

	it('escapes a colon in a value as %3A', () => {
		expect(
			oidcSubject('acme/shop', 'prod:eu', { use_default: true }).subject,
		).toBe('repo:acme/shop:environment:prod%3Aeu');
	});

	it('refuses a template whose claims depend on the run', () => {
		const customization = {
			use_default: false,
			include_claim_keys: ['repo', 'context', 'job_workflow_ref'],
		};

		expect(() => oidcSubject('acme/shop', 'prod', customization)).toThrow(
			OidcSubjectNotSupported,
		);
		try {
			oidcSubject('acme/shop', 'prod', customization);
		} catch (error) {
			const refused = error as OidcSubjectNotSupported;
			expect(refused.unsupportedKeys).toEqual(['job_workflow_ref']);
			expect(refused.message).toContain(
				'["repo","context","job_workflow_ref"]',
			);
			expect(refused.message).toContain(
				`gh api --method PUT ${ENDPOINT} -F use_default=true`,
			);
		}
	});
});

describe('resolveOidcSubject', () => {
	it('reads the immutable subject from the repository', () => {
		const { gh, asked } = ghAnswering({
			[ENDPOINT]: {
				use_default: true,
				use_immutable_subject: true,
				sub_claim_prefix: 'repo:acme@1234/shop@5678',
			},
		});

		expect(resolveOidcSubject(gh, 'acme/shop', 'prod')).toEqual({
			subject: 'repo:acme@1234/shop@5678:environment:prod',
			kind: 'immutable',
		});
		// The prefix carries the ids; the repository itself is not read.
		expect(asked).toEqual([ENDPOINT]);
	});

	it('reads the ids a custom template needs', () => {
		const { gh } = ghAnswering({
			[ENDPOINT]: {
				use_default: false,
				include_claim_keys: ['repository_id', 'context'],
			},
			'repos/acme/shop': {
				id: 5678,
				owner: { id: 1234 },
				visibility: 'public',
			},
		});

		expect(resolveOidcSubject(gh, 'acme/shop', 'prod').subject).toBe(
			'repository_id:5678:environment:prod',
		);
	});

	it("follows the organisation's template when the repository names none", () => {
		const { gh } = ghAnswering({
			[ENDPOINT]: { use_default: false },
			'orgs/acme/actions/oidc/customization/sub': {
				include_claim_keys: ['repository_owner', 'context'],
			},
		});

		expect(resolveOidcSubject(gh, 'acme/shop', 'prod').subject).toBe(
			'repository_owner:acme:environment:prod',
		);
	});

	it('does not guess an organisation template it cannot read', () => {
		const { gh } = ghAnswering({ [ENDPOINT]: { use_default: false } });

		expect(() => resolveOidcSubject(gh, 'acme/shop', 'prod')).toThrow(
			OrgOidcTemplateUnreadable,
		);
	});

	it('assumes the default, with a warning naming the endpoint, when it cannot read it', () => {
		const { gh } = ghAnswering({});

		const resolved = resolveOidcSubject(gh, 'acme/shop', 'prod');

		expect(resolved.subject).toBe('repo:acme/shop:environment:prod');
		expect(resolved.kind).toBe('assumed');
		expect(resolved.warning).toContain(`Could not read ${ENDPOINT}`);
		expect(resolved.warning).toContain(`gh api ${ENDPOINT}`);
	});
});
