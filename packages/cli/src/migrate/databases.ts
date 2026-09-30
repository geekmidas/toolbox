/**
 * Bring each construct's schema up to its migrations folder.
 *
 * Which constructs, in what order, from which folder, is `migrationTargets`'
 * answer and nobody else's. What is decided here is only how one target is
 * run: as its owner, in its own schema, with a history of its own.
 */

import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	type ConstructManifest,
	canonicalId,
	MIGRATIONS_ROOT,
	type MigrationTarget,
	migrationTargets,
	provideKey,
} from '@geekmidas/manifest';
import type { Kysely } from 'kysely';
import type { Migrator } from 'kysely/migration';
import pg from 'pg';
import type { ConstructSource } from '../reconcile/discover';
import { folderProvider, migrationFiles } from './provider';

export interface DatabasesOptions {
	/** The project root — where `db/` lives. */
	root: string;
	manifest: ConstructManifest;
	/**
	 * Where each construct was declared. A construct's migrations run with the
	 * Kysely its own file resolves, which is the one its migrations import.
	 */
	sources?: Readonly<Record<string, ConstructSource>>;
	/** The resolved environment: each construct's owner URL is read from it. */
	env: Readonly<Record<string, string | undefined>>;
	/** One construct, by name. All of them when absent. */
	only?: string;
}

export interface MigrationRun {
	target: MigrationTarget;
	/** The migrations this run applied, in order. */
	applied: string[];
}

export interface PendingMigrations {
	target: MigrationTarget;
	pending: string[];
}

/** A folder under `db/` that names no construct. */
export class UnknownMigrationFolder extends Error {
	constructor(
		readonly folder: string,
		readonly known: readonly string[],
	) {
		super(
			`${folder} names no database construct, so its migrations would never ` +
				`run. ${known.length > 0 ? `The folders that do: ${known.join(', ')}.` : 'This project declares no database.'} ` +
				`Rename the folder after the construct it belongs to.`,
		);
		this.name = 'UnknownMigrationFolder';
	}
}

/** A construct was asked for by a name that takes no migrations. */
export class NoSuchMigrationTarget extends Error {
	constructor(
		readonly construct: string,
		readonly known: readonly string[],
	) {
		super(
			`'${construct}' is not a database construct. ` +
				(known.length > 0
					? `The ones with migrations: ${known.join(', ')}.`
					: 'This project declares no database.'),
		);
		this.name = 'NoSuchMigrationTarget';
	}
}

/** A construct with roles has no owner URL to migrate with. */
export class NoOwnerCredential extends Error {
	constructor(
		readonly construct: string,
		readonly key: string,
	) {
		super(
			`${construct} has no ${key} to migrate with. Migrations run as the owner ` +
				`role — the runtime one cannot create a table — and nothing ` +
				`resolved its URL. Is the stage reconciled?`,
		);
		this.name = 'NoOwnerCredential';
	}
}

/** A migration failed; the ones before it in the run stay applied. */
export class MigrationFailed extends Error {
	constructor(
		readonly construct: string,
		readonly migration: string | undefined,
		override readonly cause: unknown,
	) {
		super(
			`${construct}: migration ${migration ? `'${migration}' ` : ''}failed — ` +
				`${cause instanceof Error ? cause.message : String(cause)}`,
		);
		this.name = 'MigrationFailed';
	}
}

/** The project's Kysely could not be found from where a database is declared. */
export class KyselyNotFound extends Error {
	constructor(readonly from: string) {
		super(
			`Could not resolve 'kysely' from ${from}. Migrations run with the ` +
				`project's own Kysely — install it where the database is declared.`,
		);
		this.name = 'KyselyNotFound';
	}
}

/** Apply every pending migration, construct by construct, parents first. */
export async function migrateDatabases(
	options: DatabasesOptions,
): Promise<MigrationRun[]> {
	const runs: MigrationRun[] = [];

	for (const target of await targetsFor(options)) {
		// No folder, or an empty one, is nothing to do — and no reason to
		// connect, which a construct nobody has written a migration for yet
		// should not need.
		const files = await migrationFiles(join(options.root, target.folder));
		if (files.size === 0) {
			runs.push({ target, applied: [] });
			continue;
		}

		const applied = await withMigrator(options, target, async (migrator) => {
			const { error, results = [] } = await migrator.migrateToLatest();
			if (error) {
				const failed = results.find((result) => result.status === 'Error');
				throw new MigrationFailed(target.id, failed?.migrationName, error);
			}

			return results
				.filter((result) => result.status === 'Success')
				.map((result) => result.migrationName);
		});

		runs.push({ target, applied });
	}

	return runs;
}

/**
 * What each construct's folder has that its history does not — without
 * applying any of it. What `gkm dev` reports.
 */
export async function pendingMigrations(
	options: DatabasesOptions,
): Promise<PendingMigrations[]> {
	const found: PendingMigrations[] = [];

	for (const target of await targetsFor(options)) {
		const files = await migrationFiles(join(options.root, target.folder));
		if (files.size === 0) continue;

		const pending = await withMigrator(options, target, async (migrator) =>
			(await migrator.getMigrations())
				.filter((migration) => migration.executedAt === undefined)
				.map((migration) => migration.name),
		);

		if (pending.length > 0) found.push({ target, pending });
	}

	return found;
}

/**
 * The targets this run covers, with every folder under `db/` accounted for.
 *
 * A folder that names no construct is an error rather than something to skip:
 * a typo in its name is otherwise a migration that silently never runs.
 */
async function targetsFor(
	options: DatabasesOptions,
): Promise<MigrationTarget[]> {
	const targets = migrationTargets(options.manifest);
	const folders = targets.map((target) => target.folder);

	for (const folder of await foldersIn(join(options.root, MIGRATIONS_ROOT))) {
		const relative = `${MIGRATIONS_ROOT}/${folder}`;
		if (!folders.includes(relative)) {
			throw new UnknownMigrationFolder(relative, folders);
		}
	}

	if (!options.only) return targets;

	const id = canonicalId(options.only);
	const chosen = targets.filter((target) => target.id === id);
	if (chosen.length === 0) {
		throw new NoSuchMigrationTarget(
			options.only,
			targets.map((target) => target.id),
		);
	}

	return chosen;
}

async function foldersIn(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true }).catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT') return [];
			throw error;
		},
	);

	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
}

/**
 * A migrator for one target, connected as its owner and closed afterwards.
 *
 * No `migrationTableSchema`: the owner role's `search_path` is pinned to the
 * construct's schema, so the history lands there — `app.kysely_migration` for
 * the database, `auth_database.kysely_migration` for its tenant — and two
 * constructs in one Postgres never share one.
 *
 * Unordered migrations are allowed. Files are timestamped, so a branch merged
 * after another's migration ran carries an older one; refusing it would make
 * every such merge a manual repair.
 */
async function withMigrator<T>(
	options: DatabasesOptions,
	target: MigrationTarget,
	run: (migrator: Migrator) => Promise<T>,
): Promise<T> {
	const from =
		options.sources?.[target.id]?.file ??
		(target.of ? options.sources?.[target.of]?.file : undefined) ??
		join(options.root, 'package.json');
	const { Kysely, PostgresDialect, sql, Migrator } = await kyselyFrom(from);

	const db: Kysely<unknown> = new Kysely<unknown>({
		dialect: new PostgresDialect({
			pool: new pg.Pool(poolConfig(ownerUrl(options, target))),
		}),
	});

	try {
		return await run(
			new Migrator({
				db,
				provider: folderProvider(join(options.root, target.folder), sql),
				allowUnorderedMigrations: true,
			}),
		);
	} finally {
		await db.destroy();
	}
}

/**
 * The owner's URL, with no fallback to the runtime one.
 *
 * The runtime role can create nothing, so falling back would only move the
 * failure to the first `CREATE TABLE` and make it read like a permissions
 * bug. The one exception is a database declared `roles: false`, where there is
 * no owner — both URLs are the master credential by design.
 */
function ownerUrl(options: DatabasesOptions, target: MigrationTarget): string {
	const key = provideKey(target.id, 'ownerUrl');
	const owner = options.env[key];
	if (owner) return owner;

	const database = options.manifest[target.of ?? target.id];
	if (database?.kind === 'database' && database.roles === false) {
		const url = options.env[provideKey(target.id, 'url')];
		if (url) return url;
	}

	throw new NoOwnerCredential(target.id, key);
}

/**
 * Pool settings for a URL, with `?search_path=` as the startup option Postgres
 * reads. Only a `roles: false` URL carries it — a role pins its own.
 */
function poolConfig(url: string): pg.PoolConfig {
	const parsed = new URL(url);
	const searchPath = parsed.searchParams.get('search_path');
	if (!searchPath) return { connectionString: url };

	parsed.searchParams.delete('search_path');
	return {
		connectionString: parsed.toString(),
		options: `-c search_path=${searchPath}`,
	};
}

/** Kysely as the project resolves it from `from`. */
async function kyselyFrom(from: string) {
	const require = createRequire(from);

	try {
		const [main, migration] = await Promise.all([
			import(pathToFileURL(require.resolve('kysely')).href),
			import(pathToFileURL(require.resolve('kysely/migration')).href),
		]);

		return {
			Kysely: main.Kysely as typeof import('kysely').Kysely,
			PostgresDialect:
				main.PostgresDialect as typeof import('kysely').PostgresDialect,
			sql: main.sql as typeof import('kysely').sql,
			Migrator:
				migration.Migrator as typeof import('kysely/migration').Migrator,
		};
	} catch {
		throw new KyselyNotFound(from);
	}
}
