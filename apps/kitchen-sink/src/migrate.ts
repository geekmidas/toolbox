import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snifferContext } from '@geekmidas/constructs';
import { EnvironmentParser } from '@geekmidas/envkit';
import { Credentials } from '@geekmidas/envkit/credentials';
import { provideKey } from '@geekmidas/manifest';
import { Kysely, PostgresDialect } from 'kysely';
// `Migrator`/`FileMigrationProvider` moved to the 'kysely/migration' subpath in kysely 0.29+.
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import pg from 'pg';
import { auth } from './constructs/auth.js';
import { database } from './constructs/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The key the database construct provides, derived rather than written down —
 * so renaming the construct moves this too. Run through `gkm exec` (see the
 * `migrate` script), which is what injects the value.
 */
const url = new EnvironmentParser({ ...process.env, ...Credentials })
	.create((get) => ({
		url: get(provideKey(database.id, 'url')).string(),
	}))
	.parse().url;

async function migrate() {
	const db = new Kysely({
		dialect: new PostgresDialect({
			pool: new pg.Pool({ connectionString: url }),
		}),
	});

	const migrator = new Migrator({
		db,
		provider: new FileMigrationProvider({
			fs,
			path,
			migrationFolder: path.join(__dirname, 'migrations'),
		}),
	});

	// Better Auth brings its own schema — users, sessions, accounts,
	// verifications — so the app never writes those tables and cannot drift
	// from them. They live in the tenant the construct was given.
	const runAuthMigrations = await auth.migrations({
		envParser: new EnvironmentParser({ ...process.env, ...Credentials }),
		context: snifferContext,
	});
	await runAuthMigrations();

	const { error, results } = await migrator.migrateToLatest();

	for (const result of results ?? []) {
		console.log(`migration ${result.migrationName}: ${result.status}`);
	}

	if (error) {
		console.error('migration failed', error);
		process.exit(1);
	}

	await db.destroy();
}

migrate();
