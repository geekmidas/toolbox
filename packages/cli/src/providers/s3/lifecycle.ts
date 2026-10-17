/**
 * A bucket's lifecycle, as the constructs declare it: one expiry rule per
 * prefix, merged into whatever else the bucket's lifecycle already holds.
 *
 * S3 — and MinIO, which speaks the same API — keeps one lifecycle document
 * per bucket, and a write replaces all of it. So gkm owns only the rules it
 * names (`gkm-…`): every other rule is read and put back as it was, a rule of
 * gkm's that is no longer declared is dropped, and nothing is written when
 * gkm's rules already say what the manifest does.
 *
 * Shared by the `s3` provider and the MinIO a local or compose stack runs,
 * so a prefix expires the same way on both.
 */

import { createHash } from 'node:crypto';
import type { LifecycleRule } from '@aws-sdk/client-s3';

/** The id every rule gkm writes starts with — and the only ones it touches. */
export const GKM_RULE_PREFIX = 'gkm-';

/**
 * The rule id for one prefix: readable, and unique however the prefix is
 * spelled — `a/b` and `a-b` read alike once sanitised, so a short hash of the
 * prefix itself follows.
 */
export function expireRuleId(prefix: string): string {
	const readable = prefix
		.replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 200);
	const hash = createHash('sha256').update(prefix).digest('hex').slice(0, 8);
	return `${GKM_RULE_PREFIX}expire-${readable ? `${readable}-` : ''}${hash}`;
}

/** The rules a bucket's expiry asks for, in a stable order. */
export function expireRules(
	expire: Readonly<Record<string, number>> | undefined,
): LifecycleRule[] {
	return Object.entries(expire ?? {})
		.map(
			([prefix, days]): LifecycleRule => ({
				ID: expireRuleId(prefix),
				Status: 'Enabled',
				Filter: { Prefix: prefix },
				Expiration: { Days: days },
			}),
		)
		.sort((a, b) => a.ID!.localeCompare(b.ID!));
}

/** What to do to a bucket's lifecycle, if anything. */
export interface LifecycleMerge {
	/** Whether gkm's rules differ from what the bucket holds. */
	changed: boolean;
	/** The whole document to write: the bucket's other rules, then gkm's. */
	rules: LifecycleRule[];
	/** What changes, said for a plan or a log line. */
	describe: string;
}

/**
 * Merge the declared expiry into the bucket's current rules.
 *
 * @param current the bucket's rules, or nothing when it has no lifecycle
 */
export function mergeLifecycle(
	current: readonly LifecycleRule[] | undefined,
	expire: Readonly<Record<string, number>> | undefined,
): LifecycleMerge {
	const wanted = expireRules(expire);
	const rules = current ?? [];
	const others = rules.filter((r) => !r.ID?.startsWith(GKM_RULE_PREFIX));
	const ours = rules.filter((r) => r.ID?.startsWith(GKM_RULE_PREFIX));

	const changed =
		canonical(ours) !== canonical(wanted) ||
		// A second rule under one of gkm's ids is drift too.
		new Set(ours.map((r) => r.ID)).size !== ours.length;

	return {
		changed,
		rules: [...others, ...wanted],
		describe: describeExpiry(expire),
	};
}

/** `expire quotes/ after 30 days, tmp/ after 1 day` — or what removing says. */
function describeExpiry(
	expire: Readonly<Record<string, number>> | undefined,
): string {
	const entries = Object.entries(expire ?? {}).sort(([a], [b]) =>
		a.localeCompare(b),
	);
	if (entries.length === 0) return 'remove expiry rules';
	return `expire ${entries
		.map(
			([prefix, days]) => `${prefix} after ${days} day${days === 1 ? '' : 's'}`,
		)
		.join(', ')}`;
}

/** gkm's rules as the fields it sets, order-free. */
function canonical(rules: readonly LifecycleRule[]): string {
	return JSON.stringify(
		rules
			.map((r) => ({
				id: r.ID,
				status: r.Status,
				// The legacy top-level `Prefix` reads the same as a filter's.
				prefix: r.Filter?.Prefix ?? r.Prefix ?? '',
				days: r.Expiration?.Days ?? null,
			}))
			.sort((a, b) => (a.id ?? '').localeCompare(b.id ?? '')),
	);
}
