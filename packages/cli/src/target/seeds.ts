/**
 * A deployed stage's seeds: what every server target runs after its
 * migrations and before any app starts.
 *
 * Seeds are reference data — roles, permissions, plans — kept current by
 * being run again, so a deploy runs every one of them, every time, on every
 * stage, production included. That is only safe because a seed is an
 * idempotent upsert; the docs say so, and nothing here can check it.
 */

import type { TargetEvent } from './types';

/** A seed of a deployed stage failed; the release stopped before any app. */
export class DeploySeedsFailed extends Error {
	constructor(
		readonly stage: string,
		/** The construct whose seed failed: `Database`. */
		readonly construct: string,
		/** The seed file, by name: `001_roles`. */
		readonly seed: string,
		override readonly cause: unknown,
	) {
		super(
			`Seeding "${stage}" failed, so no app was released: ${construct}'s seed ` +
				`'${seed}' failed — ${causeMessage(cause)}. Its writes were rolled ` +
				'back; the migrations and the seeds before it stay applied. Seeds run ' +
				'on every deploy, so each must be an idempotent upsert: fix it and ' +
				'deploy again.',
		);
		this.name = 'DeploySeedsFailed';
	}
}

/**
 * What went wrong underneath: a `SeedFailed`'s own cause (the database's
 * error), or — from a sandbox, where errors arrive as data — the same.
 */
function causeMessage(cause: unknown): string {
	const message = (value: unknown): string | undefined =>
		value && typeof value === 'object' && 'message' in value
			? String(value.message)
			: undefined;
	const inner =
		cause && typeof cause === 'object' && 'cause' in cause
			? message(cause.cause)
			: undefined;
	return inner ?? message(cause) ?? String(cause);
}

/** One construct's migrations, as a target reports them. */
export interface MigrationsReport {
	construct: string;
	folder: string;
	applied: readonly string[];
}

/** One construct's seeds, as a target reports them. */
export interface SeedsReport {
	construct: string;
	folder: string;
	seeded: readonly string[];
}

/**
 * Say what a deploy's migrations and seeds did: a line per construct with
 * something applied or run — `🌱 db/database/seeds: ran 2`, then each seed —
 * and a `migration.applied` or `seed.ran` event beside it.
 */
export function reportDatabaseRuns(
	migrations: readonly MigrationsReport[],
	seeds: readonly SeedsReport[],
	log: (line: string) => void,
	emit: (event: TargetEvent) => void,
): void {
	for (const { construct, folder, applied } of migrations) {
		if (applied.length === 0) continue;
		log(`🗄️  ${folder}: applied ${applied.length}`);
		for (const name of applied) log(`   ✓ ${name}`);
		emit({
			type: 'migration.applied',
			construct,
			folder,
			applied: [...applied],
		});
	}
	for (const { construct, folder, seeded } of seeds) {
		if (seeded.length === 0) continue;
		log(`🌱 ${folder}: ran ${seeded.length}`);
		for (const name of seeded) log(`   ✓ ${name}`);
		emit({ type: 'seed.ran', construct, folder, seeded: [...seeded] });
	}
}

/** What a dry run lists: the seeds a deploy would run, construct by construct. */
export function reportPlannedSeeds(
	planned: readonly { folder: string; seeds: readonly string[] }[],
	log: (line: string) => void,
): void {
	for (const { folder, seeds } of planned) {
		log(`🌱 ${folder}: would run ${seeds.length} (${seeds.join(', ')})`);
	}
}
