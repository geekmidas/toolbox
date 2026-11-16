/**
 * Which stages take backups, and where they are kept.
 *
 * A deployed compose stage whose stack runs Postgres is backed up by
 * default — every day at 02:00 UTC, kept 30 days — unless
 * `deploy.backups.<stage>` says otherwise. The local stage never is.
 *
 * Every backup is kept in the project bucket (`providers/projectBucket.ts`),
 * beside the stage's deploy state, one folder per run and one file per
 * database:
 *
 * ```
 * gkm/<project>/<stage>/backups/2026-10-10/02-00-00Z/database.sql.gz
 * gkm/<project>/<stage>/backups/2026-10-10/02-00-00Z/auth-database.sql.gz
 * ```
 *
 * Beside the runs, `imports/` holds files prepared by hand for
 * `gkm backup:restore --from` — never listed as a run, never expired — and,
 * with `pitr`, `pitr/` holds WAL-G's archive: `pitr/wal_005/` and
 * `pitr/basebackups_005/`, for `gkm backup:restore --to`.
 *
 * The file is named after the database's construct, the way its migrations
 * folder is: `AuthDatabase` is `db/auth-database`, and `auth-database.sql.gz`.
 */

import { type ConstructManifest, kebabCase } from '@geekmidas/manifest';
import { deploysWithCompose } from '../providers/dns.js';
import type { PrefixExpiry } from '../providers/projectBucket.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import { checkStageBackups, type StageBackups } from './schedule.js';

/** What a stage's backups come to. */
export type StageBackupsChoice =
	| {
			mode: 'on';
			backups: StageBackups;
			/** Whether the stage named it, or took the default. */
			source: 'config' | 'default';
	  }
	/** `deploy.backups.<stage>: false`. */
	| { mode: 'disabled' }
	/** Nothing to back up, or nowhere it applies. */
	| { mode: 'none'; reason: 'local' | 'not-compose' | 'no-postgres' };

/** The workspace parts {@link stageBackups} reads. */
export type BackupsWorkspace = Pick<
	NormalizedWorkspace,
	'name' | 'apps' | 'deploy' | 'stages' | 'state'
>;

/** Whether the stack runs Postgres: some construct is a database. */
export function runsPostgres(manifest: ConstructManifest): boolean {
	return Object.values(manifest).some((d) => d.kind === 'database');
}

/**
 * What `stage`'s backups are: on — by its entry or the default — off by
 * `false`, or none, for the local stage, a stage compose does not deploy,
 * and a stack with no database.
 */
export function stageBackups(
	workspace: BackupsWorkspace,
	manifest: ConstructManifest,
	stage: string,
): StageBackupsChoice {
	if (stage === workspace.stages?.local) {
		return { mode: 'none', reason: 'local' };
	}
	if (!deploysWithCompose(workspace as NormalizedWorkspace)) {
		return { mode: 'none', reason: 'not-compose' };
	}
	if (!runsPostgres(manifest)) return { mode: 'none', reason: 'no-postgres' };
	const value = (
		workspace.deploy?.backups as Record<string, unknown> | undefined
	)?.[stage];
	const checked = checkStageBackups(stage, value ?? {});
	if (checked === false) return { mode: 'disabled' };
	return {
		mode: 'on',
		backups: checked,
		source: value === undefined ? 'default' : 'config',
	};
}

/**
 * Where a stage's backups are, in the project bucket — under the same
 * `<prefix>/<project>/<stage>` its deploy state is: `gkm/shop/production/backups`.
 */
export function backupsPrefix(
	workspace: Pick<NormalizedWorkspace, 'name' | 'state'>,
	stage: string,
): string {
	const state = workspace.state;
	const prefix =
		state?.provider === 's3' && state.prefix !== undefined
			? state.prefix.replace(/\/+$/, '')
			: 'gkm';
	return `${prefix ? `${prefix}/` : ''}${workspace.name}/${stage}/backups`;
}

/**
 * Where a stage's point-in-time recovery is kept, beside its runs: WAL-G's
 * own layout under it, `wal_005/` and `basebackups_005/`.
 */
export function pitrPrefix(
	workspace: Pick<NormalizedWorkspace, 'name' | 'state'>,
	stage: string,
): string {
	return `${backupsPrefix(workspace, stage)}/${PITR_FOLDER}`;
}

/** The folder point-in-time recovery is kept in, under the backups prefix. */
export const PITR_FOLDER = 'pitr';

/** WAL-G's folder of WAL segments, under the PITR prefix. */
export const WAL_FOLDER = 'wal_005';

/** WAL-G's folder of base backups, under the PITR prefix. */
export const BASE_BACKUPS_FOLDER = 'basebackups_005';

/**
 * A database's copy, restored beside the live one with `--into <name>`:
 * `drill_auth_database`. The runner (`runner.ts`), which ships alone,
 * keeps a copy of this; a test holds the two to the same answers.
 */
export function intoDatabase(into: string, file: string): string {
	return `${into}_${file.replace(/-/g, '_')}`;
}

/**
 * What every run folder's key starts with, under the stage's backups prefix:
 * the first digit of its year. What the expiry rule matches — `imports/`
 * does not.
 */
export const RUNS_PREFIX = '2';

/** One run's folder: `2026-10-10/02-00-00Z`, for the time it started. */
export function runFolder(at: Date): string {
	const iso = at.toISOString();
	return `${iso.slice(0, 10)}/${iso.slice(11, 19).replace(/:/g, '-')}Z`;
}

/** A run folder's time back, or `undefined` for a key that is not one. */
export function runTime(folder: string): Date | undefined {
	const match = /^(\d{4}-\d{2}-\d{2})\/(\d{2})-(\d{2})-(\d{2})Z$/.exec(folder);
	if (!match) return undefined;
	const at = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`);
	return Number.isNaN(at.getTime()) ? undefined : at;
}

/** One database the stack backs up. */
export interface BackupDatabase {
	/** Its construct: `AuthDatabase`. */
	id: string;
	/** Its file in a run's folder, less `.sql.gz`: `auth-database`. */
	file: string;
	/** Its name in the stack's Postgres: `auth_database_production`. */
	name: string;
}

/** A database's file in a run's folder: `auth-database.sql.gz`. */
export function backupFile(database: Pick<BackupDatabase, 'file'>): string {
	return `${database.file}.sql.gz`;
}

/** Each database the stack runs, by its construct and its name in Postgres. */
export function backupDatabases(
	resources: readonly { id: string; kind: string; name: string }[],
): BackupDatabase[] {
	return resources
		.filter((r) => r.kind === 'database')
		.map((r) => ({ id: r.id, file: kebabCase(r.id), name: r.name }))
		.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * The expiry of every stage's backups, by each stage's own entry — what the
 * project bucket's lifecycle carries beside its own rule.
 *
 * A put replaces a bucket's whole lifecycle, so this is built from every
 * deployed stage each time, never from the stage being deployed alone: one
 * stage's deploy keeps every other's rule. A stage set to `false` has none,
 * and its backups are kept until someone deletes them.
 *
 * The rule covers the runs and nothing else beside them: a lifecycle filter
 * cannot leave a folder out, so it matches what every run folder starts
 * with — its year, `2…` — and the stage's `imports/` is never expired.
 *
 * A stage with point-in-time recovery has two more: its base backups expire
 * after `pitr.keep`, and its WAL a `pitr.base` interval later, so every
 * segment the oldest kept base backup replays from is still there. Expiry is
 * the bucket's, never `wal-g delete`: the stage's key stays put-only.
 */
export function backupExpiries(
	workspace: BackupsWorkspace,
	manifest: ConstructManifest,
): PrefixExpiry[] {
	const expiries: PrefixExpiry[] = [];
	for (const stage of [...(workspace.stages?.deployed ?? [])].sort()) {
		const choice = stageBackups(workspace, manifest, stage);
		if (choice.mode !== 'on') continue;
		expiries.push({
			id: `gkm-backups-${stage}`,
			prefix: `${backupsPrefix(workspace, stage)}/${RUNS_PREFIX}`,
			days: choice.backups.keepDays,
			abortIncompleteDays: 1,
		});
		const pitr = choice.backups.pitr;
		if (!pitr) continue;
		const prefix = pitrPrefix(workspace, stage);
		expiries.push(
			{
				id: `gkm-backups-${stage}-pitr-base`,
				prefix: `${prefix}/${BASE_BACKUPS_FOLDER}/`,
				days: pitr.keepDays,
				abortIncompleteDays: 1,
			},
			{
				id: `gkm-backups-${stage}-pitr-wal`,
				prefix: `${prefix}/${WAL_FOLDER}/`,
				days: pitr.walKeepDays,
				abortIncompleteDays: 1,
			},
		);
	}
	return expiries;
}
