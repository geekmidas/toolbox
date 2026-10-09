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
	DATABASE_FOLDERS,
	MIGRATIONS_ROOT,
	type MigrationTarget,
	migrationTargets,
	provideKey,
} from '@geekmidas/manifest';
import type { Kysely } from 'kysely';
import type { Migrator } from 'kysely/migration';
import pg from 'pg';
import { GkmError } from '../errors';
import type { ConstructSource } from '../reconcile/discover';
import { folderProvider, loadSeeds, migrationFiles } from './provider';

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

export interface SeedOptions extends DatabasesOptions {
	/** The stage being seeded, handed to every seed. */
	stage: string;
}

export interface SeedRun {
	target: MigrationTarget;
	/** The seeds this run ran, in order — every one, every time. */
	seeded: string[];
}

/** The seeds a run would run for one construct, read without connecting. */
export interface PlannedSeeds {
	target: MigrationTarget;
	/** In the order they would run. */
	seeds: string[];
}

export interface PendingMigrations {
	target: MigrationTarget;
	pending: string[];
}

/** A folder under `db/` that names no construct. */
export class UnknownMigrationFolder extends GkmError {
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
export class NoSuchMigrationTarget extends GkmError {
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

/**
 * A migration left directly in a construct's folder, where nothing reads it.
 *
 * Migrations moved into `migrations/` so seeds could sit beside them. A file
 * still at the old level would otherwise never run, and nothing would say so.
 */
export class MigrationsOutsideFolder extends GkmError {
	constructor(
		readonly folder: string,
		readonly files: readonly string[],
	) {
		super(
			`${folder} has ${files.join(', ')} directly inside it, where nothing ` +
				`runs them. Migrations live in ${folder}/migrations/ and seeds in ` +
				`${folder}/seeds/ — move ${files.length === 1 ? 'it' : 'them'} there.`,
		);
		this.name = 'MigrationsOutsideFolder';
	}
}

/** A folder inside a construct's folder that is neither `migrations` nor `seeds`. */
export class UnknownDatabaseFolder extends GkmError {
	constructor(readonly folder: string) {
		super(
			`${folder} is neither migrations/ nor seeds/, so nothing in it would ` +
				`ever run. A construct's folder holds those two; rename or remove it.`,
		);
		this.name = 'UnknownDatabaseFolder';
	}
}

/** A seed failed; its own writes are rolled back, the ones before it stay. */
export class SeedFailed extends Error {
	constructor(
		readonly construct: string,
		readonly seed: string,
		override readonly cause: unknown,
	) {
		super(
			`${construct}: seed '${seed}' failed — ` +
				`${cause instanceof Error ? cause.message : String(cause)}. ` +
				`Its writes were rolled back; fix it and run it again.`,
		);
		this.name = 'SeedFailed';
	}
}

/** A construct with roles has no owner URL to migrate with. */
export class NoOwnerCredential extends GkmError {
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
export class KyselyNotFound extends GkmError {
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
		const files = await migrationFiles(join(options.root, target.migrations));
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
 * Run every construct's seeds, parents first — each one, every time, on every
 * stage, production included. Each is handed the stage, so a seed decides
 * what belongs where.
 *
 * Seeds are reference data kept up to date by being run again, so there is no
 * history: a seed is an upsert, and a changed one is applied by the next run.
 * Each runs in its own transaction, as the construct's owner, so a failure
 * leaves nothing half-written. Assumes the schema is migrated —
 * {@link migrateAndSeed} is what makes that true.
 */
export async function seedDatabases(options: SeedOptions): Promise<SeedRun[]> {
	const runs: SeedRun[] = [];

	for (const target of await targetsFor(options)) {
		const folder = join(options.root, target.seeds);
		if ((await migrationFiles(folder)).size === 0) {
			runs.push({ target, seeded: [] });
			continue;
		}

		const seeded = await withOwner(options, target, async (db, kysely) => {
			const names: string[] = [];
			for (const seed of await loadSeeds(folder, kysely.sql)) {
				try {
					await db
						.transaction()
						.execute((trx) => seed.run(trx, { stage: options.stage }));
				} catch (error) {
					throw new SeedFailed(target.id, seed.name, error);
				}
				names.push(seed.name);
			}
			return names;
		});

		runs.push({ target, seeded });
	}

	return runs;
}

/**
 * The seeds {@link seedDatabases} would run, construct by construct, parents
 * first, in the order it would run them — read from the folders alone, with
 * no connection. What a dry run lists. Constructs with none are left out.
 */
export async function plannedSeeds(
	options: Pick<DatabasesOptions, 'root' | 'manifest' | 'only'>,
): Promise<PlannedSeeds[]> {
	const planned: PlannedSeeds[] = [];
	for (const target of await targetsFor(options)) {
		const files = await migrationFiles(join(options.root, target.seeds));
		if (files.size === 0) continue;
		planned.push({ target, seeds: [...files.keys()].sort() });
	}
	return planned;
}

/**
 * Migrate, then seed: a seed only ever runs against the schema it was written
 * for.
 *
 * With `only`, the constructs it lives in are migrated too — a tenant's seed
 * cannot run before the database that owns its schema exists — and only it is
 * seeded.
 */
export async function migrateAndSeed(options: SeedOptions): Promise<{
	migrations: MigrationRun[];
	seeds: SeedRun[];
}> {
	const migrations: MigrationRun[] = [];
	for (const target of await withParents(options)) {
		migrations.push(
			...(await migrateDatabases({ ...options, only: target.id })),
		);
	}

	return { migrations, seeds: await seedDatabases(options) };
}

/** The targets `only` names, after the ones it lives in; all without it. */
async function withParents(
	options: DatabasesOptions,
): Promise<MigrationTarget[]> {
	const chosen = await targetsFor(options);
	if (!options.only) return chosen;

	const all = migrationTargets(options.manifest);
	const ids = new Set<string>();
	for (const target of chosen) {
		let current: MigrationTarget | undefined = target;
		while (current) {
			ids.add(current.id);
			const parent: string | undefined = current.of;
			current = parent ? all.find((t) => t.id === parent) : undefined;
		}
	}

	return all.filter((target) => ids.has(target.id));
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
		const files = await migrationFiles(join(options.root, target.migrations));
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
	options: Pick<DatabasesOptions, 'root' | 'manifest' | 'only'>,
): Promise<MigrationTarget[]> {
	const targets = migrationTargets(options.manifest);
	const folders = targets.map((target) => target.folder);

	for (const folder of await foldersIn(join(options.root, MIGRATIONS_ROOT))) {
		const relative = `${MIGRATIONS_ROOT}/${folder}`;
		if (!folders.includes(relative)) {
			throw new UnknownMigrationFolder(relative, folders);
		}
		await checkLayout(options.root, relative);
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

/**
 * A construct's folder holds `migrations/` and `seeds/`, and nothing else —
 * anything beside them is a file or folder nothing would ever run.
 */
async function checkLayout(root: string, folder: string): Promise<void> {
	const entries = await readdir(join(root, folder), { withFileTypes: true });

	const loose = entries
		.filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
		.map((entry) => entry.name);
	if (loose.length > 0) throw new MigrationsOutsideFolder(folder, loose);

	for (const entry of entries) {
		if (
			entry.isDirectory() &&
			!(DATABASE_FOLDERS as readonly string[]).includes(entry.name)
		) {
			throw new UnknownDatabaseFolder(`${folder}/${entry.name}`);
		}
	}
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
 * A migrator for one target, connected as its owner.
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
	return withOwner(options, target, (db, { Migrator, sql }) =>
		run(
			new Migrator({
				db,
				provider: folderProvider(join(options.root, target.migrations), sql),
				allowUnorderedMigrations: true,
			}),
		),
	);
}

/**
 * One target's database, connected as its owner and closed afterwards — what
 * migrations and seeds both run as.
 */
async function withOwner<T>(
	options: DatabasesOptions,
	target: MigrationTarget,
	run: (
		db: Kysely<unknown>,
		kysely: Awaited<ReturnType<typeof kyselyFrom>>,
	) => Promise<T>,
): Promise<T> {
	const from =
		options.sources?.[target.id]?.file ??
		(target.of ? options.sources?.[target.of]?.file : undefined) ??
		join(options.root, 'package.json');
	const kysely = await kyselyFrom(from);

	const db: Kysely<unknown> = new kysely.Kysely<unknown>({
		dialect: new kysely.PostgresDialect({
			pool: new pg.Pool(poolConfig(ownerUrl(options, target))),
		}),
	});

	try {
		return await run(db, kysely);
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
