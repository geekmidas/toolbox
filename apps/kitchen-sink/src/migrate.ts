import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snifferContext } from '@geekmidas/constructs';
import { EnvironmentParser } from '@geekmidas/envkit';
import { Credentials } from '@geekmidas/envkit/credentials';
import type { Kysely } from 'kysely';
// `Migrator`/`FileMigrationProvider` moved to the 'kysely/migration' subpath in kysely 0.29+.
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { auth } from './constructs/auth.js';
import { database } from './constructs/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envParser = new EnvironmentParser({ ...process.env, ...Credentials });

async function migrate() {
	// The *owner* connection, not the one a handler gets. Migrations are DDL,
	// and the role a request runs as holds no grant to create, alter or drop —
	// which is the point of the split, and the reason this asks the construct
	// for `owner` rather than reading a URL out of the environment itself.
	const db = (await database.owner.register({
		envParser,
		context: snifferContext,
	})) as Kysely<unknown>;

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
		envParser,
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
