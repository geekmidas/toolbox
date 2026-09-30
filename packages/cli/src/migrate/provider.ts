/**
 * One construct's migrations and seeds, read from its folders.
 *
 * Two kinds of file, told apart by extension rather than by configuration: a
 * script exports `up` (and may export `down`) — or `seed(db, { stage })`, in
 * `seeds/` — and a
 * `.sql` file is run whole. The second is what makes a folder independent of
 * the client the app uses — Better Auth's schema is SQL whatever the
 * application queries with.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Kysely, sql } from 'kysely';
import type { Migration, MigrationProvider } from 'kysely/migration';

const SCRIPTS = new Set(['.ts', '.mts', '.js', '.mjs']);

/** Two files in one folder that would be one migration. */
export class DuplicateMigration extends Error {
	constructor(
		readonly folder: string,
		readonly migration: string,
	) {
		super(
			`${folder} has two migrations named '${migration}' — a script and a .sql file ` +
				`with the same name. A migration is recorded by name, so only one of ` +
				`them could ever run; rename or remove the other.`,
		);
		this.name = 'DuplicateMigration';
	}
}

/** A script in a migrations folder that exports no `up`. */
export class MigrationHasNoUp extends Error {
	constructor(readonly file: string) {
		super(
			`${file} is in a migrations folder but exports no \`up\` function. ` +
				`Export \`async function up(db: Kysely<unknown>)\`, or move the file ` +
				`out of the folder if it is not a migration.`,
		);
		this.name = 'MigrationHasNoUp';
	}
}

/** A script in a seeds folder that exports no `seed`. */
export class SeedHasNoSeed extends Error {
	constructor(readonly file: string) {
		super(
			`${file} is in a seeds folder but exports no \`seed\` function. ` +
				`Export \`async function seed(db, { stage })\`, or move the ` +
				`file out of the folder if it is not a seed.`,
		);
		this.name = 'SeedHasNoSeed';
	}
}

/**
 * What a seed is handed beside its database.
 *
 * Seeds run on every stage, production included, so a seed that should write
 * something only somewhere — a demo tenant on `development`, never on
 * `production` — decides by the stage it is given.
 */
export interface SeedContext {
	/** The stage being seeded: the local one, `test`, or a deployed one. */
	stage: string;
}

/** One seed: what it is called, and what it does. */
export interface Seed {
	name: string;
	run: (db: Kysely<unknown>, context: SeedContext) => Promise<void>;
}

/**
 * The migration files in a folder, by name, without reading them.
 *
 * Also what `gkm dev` compares against a construct's history to report what
 * is pending, which is why it is separate from loading them.
 */
export async function migrationFiles(
	folder: string,
): Promise<Map<string, string>> {
	const entries = await readdir(folder, { withFileTypes: true }).catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT') return [];
			throw error;
		},
	);

	const files = new Map<string, string>();
	for (const entry of entries) {
		if (!entry.isFile() || !isMigration(entry.name)) continue;

		const name = entry.name.slice(0, -extname(entry.name).length);
		if (files.has(name)) throw new DuplicateMigration(folder, name);

		files.set(name, join(folder, entry.name));
	}

	return files;
}

/** A Kysely provider over one construct's folder. */
export function folderProvider(
	folder: string,
	raw: typeof sql,
): MigrationProvider {
	return {
		async getMigrations() {
			const migrations: Record<string, Migration> = {};

			for (const [name, file] of await migrationFiles(folder)) {
				migrations[name] =
					extname(file) === '.sql'
						? await sqlMigration(file, raw)
						: await scriptMigration(file);
			}

			return migrations;
		},
	};
}

/**
 * The seeds in a folder, loaded, in name order.
 *
 * Every one runs on every pass — there is no history to consult — so the order
 * is the only thing between two seeds where one reads what another writes.
 * Name them to sort that way.
 */
export async function loadSeeds(
	folder: string,
	raw: typeof sql,
): Promise<Seed[]> {
	const files = [...(await migrationFiles(folder))].sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0,
	);

	const seeds: Seed[] = [];
	for (const [name, file] of files) {
		seeds.push({
			name,
			run:
				extname(file) === '.sql'
					? (await sqlMigration(file, raw)).up
					: await scriptSeed(file),
		});
	}

	return seeds;
}

/**
 * A seed script, imported as it is on disk now.
 *
 * Keyed by its modification time: a seed is run again after it is edited, and
 * a process that has imported it once would otherwise run the old one.
 */
async function scriptSeed(file: string): Promise<Seed['run']> {
	const url = pathToFileURL(file);
	url.searchParams.set('mtime', String((await stat(file)).mtimeMs));
	const module = (await import(url.href)) as { seed?: unknown };
	if (typeof module.seed !== 'function') throw new SeedHasNoSeed(file);

	return module.seed as Seed['run'];
}

function isMigration(file: string): boolean {
	if (file.endsWith('.d.ts')) return false;
	if (/\.(spec|test)\.[cm]?[jt]s$/.test(file)) return false;

	const extension = extname(file);
	return extension === '.sql' || SCRIPTS.has(extension);
}

async function scriptMigration(file: string): Promise<Migration> {
	const module = (await import(pathToFileURL(file).href)) as Partial<Migration>;
	if (typeof module.up !== 'function') throw new MigrationHasNoUp(file);

	return {
		up: module.up,
		...(typeof module.down === 'function' ? { down: module.down } : {}),
	};
}

/**
 * A `.sql` file, run whole.
 *
 * One query rather than split on `;`: with no parameters, Postgres takes
 * several statements in one message, and splitting by hand breaks on the first
 * `;` inside a string or a function body. There is no `down` — a generated
 * schema is rolled back by a migration that says how, not by guessing.
 */
async function sqlMigration(file: string, raw: typeof sql): Promise<Migration> {
	const statements = await readFile(file, 'utf-8');

	return {
		up: async (db: Kysely<unknown>) => {
			await raw.raw(statements).execute(db);
		},
	};
}
