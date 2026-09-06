import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

/**
 * Bring both schemas up to date: Better Auth's, then the application's.
 *
 * Exported rather than only run, because the test suite needs exactly this and
 * a suite that shells out to `tsx src/migrate.ts` would be running a second
 * process against a second set of resolved credentials. One function, called
 * from the CLI entry below and from the suite's global setup.
 *
 * @returns the names of the application migrations that ran.
 */
export async function migrate(): Promise<string[]> {
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

	await db.destroy();

	// Thrown rather than `process.exit`, so a caller that is not a CLI — the
	// test suite's global setup — reports the failure instead of taking the
	// whole runner down with an exit code and no message.
	if (error) throw error;

	return (results ?? []).map((result) => result.migrationName);
}

/**
 * The CLI entry: run only when this module *is* the program.
 *
 * Importing it would otherwise migrate as a side effect, which is the one thing
 * an import should never do — and the suite does import it.
 */
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	migrate()
		.then((names) => {
			for (const name of names) console.log(`migration ${name}: Success`);
		})
		.catch((error) => {
			console.error('migration failed', error);
			process.exit(1);
		});
}
