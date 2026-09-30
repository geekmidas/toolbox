import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roleStatements } from '@geekmidas/db/pg/roles';
import type { ConstructManifest } from '@geekmidas/manifest';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_CONFIG } from '../../../../testkit/test/globalSetup';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	MigrationFailed,
	MigrationsOutsideFolder,
	migrateAndSeed,
	migrateDatabases,
	NoOwnerCredential,
	NoSuchMigrationTarget,
	pendingMigrations,
	SeedFailed,
	seedDatabases,
	UnknownDatabaseFolder,
	UnknownMigrationFolder,
} from '../databases';
import { SeedHasNoSeed } from '../provider';

/**
 * A database and a schema tenant inside it, each with the owner and runtime
 * roles reconcile provisions — created here with the same statements — so a
 * run connects the way `gkm migrate` does: as each construct's owner, with its
 * `search_path` pinned to its own schema.
 */

const run = randomUUID().slice(0, 8);
const app = { schema: `mig_app_${run}`, owner: `mig_app_owner_${run}` };
const auth = { schema: `mig_auth_${run}`, owner: `mig_auth_owner_${run}` };
const runtimes = [`mig_app_${run}`, `mig_auth_${run}`];
const PASSWORD = 'migrate-spec';

const { host, port, user, password, database } = TEST_DATABASE_CONFIG;
const as = (role: string) =>
	`postgres://${role}:${PASSWORD}@${host}:${port}/${database}`;
const master = `postgres://${user}:${password}@${host}:${port}/${database}`;

const manifest = {
	Database: { kind: 'database', id: 'Database', provides: ['DATABASE_URL'] },
	AuthDatabase: {
		kind: 'database-schema',
		id: 'AuthDatabase',
		of: 'Database',
		schema: auth.schema,
		provides: ['AUTH_DATABASE_URL'],
	},
} as const satisfies ConstructManifest;

const env = {
	DATABASE_OWNER_URL: as(app.owner),
	AUTH_DATABASE_OWNER_URL: as(auth.owner),
};

// Kysely as this package resolves it: the migrator loads the project's own,
// from where a construct is declared.
const sources = {
	Database: {
		file: fileURLToPath(import.meta.url),
		exportName: 'database',
		construct: undefined,
	},
};

async function query<T = Record<string, unknown>>(
	sql: string,
	values: unknown[] = [],
): Promise<T[]> {
	const client = new pg.Client(TEST_DATABASE_CONFIG);
	await client.connect();
	try {
		return (await client.query(sql, values)).rows as T[];
	} finally {
		await client.end();
	}
}

const tablesIn = async (schema: string) =>
	(
		await query<{ table_name: string }>(
			'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
			[schema],
		)
	).map((row) => row.table_name);

beforeAll(async () => {
	for (const [spec, runtime] of [
		[app, runtimes[0]!],
		[auth, runtimes[1]!],
	] as const) {
		for (const statement of roleStatements({
			runtime,
			owner: spec.owner,
			schema: spec.schema,
			passwords: { runtime: PASSWORD, owner: PASSWORD },
		})) {
			if (statement.exists) {
				const found = await query(
					statement.exists.sql,
					statement.exists.values,
				);
				if (found.length > 0) continue;
			}
			await query(statement.sql);
		}
	}
});

afterAll(async () => {
	for (const schema of [app.schema, auth.schema]) {
		await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
	}
	for (const role of [app.owner, auth.owner, ...runtimes]) {
		await query(`DROP OWNED BY "${role}"`).catch(() => {});
		await query(`DROP ROLE IF EXISTS "${role}"`);
	}
});

describe('migrateDatabases', () => {
	let root: string;

	beforeEach(async () => {
		root = await createTempDir('migrate-');
		await mkdir(join(root, 'db/database/migrations'), { recursive: true });
		await mkdir(join(root, 'db/auth-database/migrations'), {
			recursive: true,
		});

		await writeFile(
			join(root, 'db/database/migrations/20260101000000_users.ts'),
			`export async function up(db) {
  await db.schema.createTable('users').addColumn('id', 'uuid', (c) => c.primaryKey()).execute();
}
export async function down(db) {
  await db.schema.dropTable('users').execute();
}
`,
		);
		await writeFile(
			join(root, 'db/auth-database/migrations/20260101000100_better_auth.sql'),
			`create table "session" ("id" text not null primary key);
create index "session_id_idx" on "session" ("id");
`,
		);

		return async () => {
			await cleanupDir(root);
			for (const schema of [app.schema, auth.schema]) {
				for (const table of await tablesIn(schema)) {
					await query(`DROP TABLE IF EXISTS "${schema}"."${table}" CASCADE`);
				}
			}
		};
	});

	it('runs each construct as its own owner, in its own schema, with its own history', async () => {
		const runs = await migrateDatabases({ root, manifest, sources, env });

		expect(runs.map((r) => [r.target.id, r.applied])).toEqual([
			['Database', ['20260101000000_users']],
			['AuthDatabase', ['20260101000100_better_auth']],
		]);

		// The tables, and each construct's history beside them — never in the
		// other's schema, and never in `public`.
		expect(await tablesIn(app.schema)).toEqual([
			'kysely_migration',
			'kysely_migration_lock',
			'users',
		]);
		expect(await tablesIn(auth.schema)).toEqual([
			'kysely_migration',
			'kysely_migration_lock',
			'session',
		]);

		// Created by the owner, so the runtime role's default privileges apply.
		const [owner] = await query<{ tableowner: string }>(
			'SELECT tableowner FROM pg_tables WHERE schemaname = $1 AND tablename = $2',
			[app.schema, 'users'],
		);
		expect(owner?.tableowner).toBe(app.owner);
	});

	it('applies nothing the second time', async () => {
		await migrateDatabases({ root, manifest, sources, env });

		const again = await migrateDatabases({ root, manifest, sources, env });

		expect(again.flatMap((r) => r.applied)).toEqual([]);
	});

	it('reports what is pending without applying it', async () => {
		await migrateDatabases({ root, manifest, sources, env, only: 'Database' });

		const pending = await pendingMigrations({ root, manifest, sources, env });

		expect(pending.map((p) => [p.target.id, p.pending])).toEqual([
			['AuthDatabase', ['20260101000100_better_auth']],
		]);
		expect(await tablesIn(auth.schema)).toEqual([]);
	});

	it('applies a migration merged after a newer one already ran', async () => {
		await migrateDatabases({ root, manifest, sources, env });
		await writeFile(
			join(root, 'db/database/migrations/20251231000000_older.ts'),
			`export async function up(db) {
  await db.schema.createTable('older').addColumn('id', 'uuid').execute();
}
`,
		);

		const runs = await migrateDatabases({ root, manifest, sources, env });

		expect(runs[0]?.applied).toEqual(['20251231000000_older']);
	});

	it('migrates only the construct it is asked for, by name', async () => {
		const runs = await migrateDatabases({
			root,
			manifest,
			sources,
			env,
			only: 'auth-database',
		});

		expect(runs.map((r) => r.target.id)).toEqual(['AuthDatabase']);
	});

	it('refuses a name that is not a database construct', async () => {
		await expect(
			migrateDatabases({ root, manifest, sources, env, only: 'uploads' }),
		).rejects.toBeInstanceOf(NoSuchMigrationTarget);
	});

	it('refuses a folder that names no construct, rather than never running it', async () => {
		await mkdir(join(root, 'db/datbase'));

		await expect(
			migrateDatabases({ root, manifest, sources, env }),
		).rejects.toBeInstanceOf(UnknownMigrationFolder);
	});

	it('refuses to migrate without the owner, instead of trying the runtime role', async () => {
		await expect(
			migrateDatabases({
				root,
				manifest,
				sources,
				env: { ...env, DATABASE_OWNER_URL: undefined, DATABASE_URL: master },
			}),
		).rejects.toBeInstanceOf(NoOwnerCredential);
	});

	it('names the migration that failed', async () => {
		await writeFile(
			join(root, 'db/database/migrations/20260102000000_broken.sql'),
			'create table "users" ("id" uuid);',
		);

		const failure = await migrateDatabases({
			root,
			manifest,
			sources,
			env,
		}).catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(MigrationFailed);
		expect(failure).toMatchObject({
			construct: 'Database',
			migration: '20260102000000_broken',
		});
	});

	it('refuses a migration left beside migrations/, rather than never running it', async () => {
		await writeFile(
			join(root, 'db/database/20260103000000_loose.ts'),
			'export async function up() {}',
		);

		const failure = await migrateDatabases({
			root,
			manifest,
			sources,
			env,
		}).catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(MigrationsOutsideFolder);
		expect(failure).toMatchObject({
			folder: 'db/database',
			files: ['20260103000000_loose.ts'],
		});
	});

	it('refuses a folder beside migrations/ and seeds/', async () => {
		await mkdir(join(root, 'db/database/fixtures'));

		await expect(
			migrateDatabases({ root, manifest, sources, env }),
		).rejects.toBeInstanceOf(UnknownDatabaseFolder);
	});
});

describe('seedDatabases', () => {
	let root: string;
	const stage = 'production';

	const seedFile = (name: string, content: string) =>
		writeFile(join(root, 'db/database/seeds', name), content);

	const roles = async () =>
		(
			await query<{ name: string }>(
				`SELECT name FROM "${app.schema}".roles ORDER BY name`,
			)
		).map((row) => row.name);

	beforeEach(async () => {
		root = await createTempDir('seed-');
		await mkdir(join(root, 'db/database/migrations'), { recursive: true });
		await mkdir(join(root, 'db/database/seeds'), { recursive: true });
		await mkdir(join(root, 'db/auth-database/migrations'), {
			recursive: true,
		});

		await writeFile(
			join(root, 'db/database/migrations/20260101000000_roles.ts'),
			`export async function up(db) {
  await db.schema.createTable('roles').addColumn('name', 'text', (c) => c.primaryKey()).execute();
}
`,
		);
		await seedFile(
			'roles.ts',
			`export async function seed(db) {
  await db.insertInto('roles').values([{ name: 'Member' }, { name: 'Super admin' }])
    .onConflict((oc) => oc.column('name').doNothing()).execute();
}
`,
		);

		return async () => {
			await cleanupDir(root);
			for (const schema of [app.schema, auth.schema]) {
				for (const table of await tablesIn(schema)) {
					await query(`DROP TABLE IF EXISTS "${schema}"."${table}" CASCADE`);
				}
			}
		};
	});

	it('migrates, then seeds', async () => {
		const { migrations, seeds } = await migrateAndSeed({
			root,
			manifest,
			sources,
			env,
			stage,
		});

		expect(migrations.map((r) => [r.target.id, r.applied])).toEqual([
			['Database', ['20260101000000_roles']],
			['AuthDatabase', []],
		]);
		expect(seeds.map((r) => [r.target.id, r.seeded])).toEqual([
			['Database', ['roles']],
			['AuthDatabase', []],
		]);
		expect(await roles()).toEqual(['Member', 'Super admin']);
	});

	it('runs every seed again on the next pass, applying what changed', async () => {
		await migrateAndSeed({ root, manifest, sources, env, stage });
		await seedFile(
			'roles.ts',
			`export async function seed(db) {
  await db.insertInto('roles').values([{ name: 'Member' }, { name: 'Reviewer' }])
    .onConflict((oc) => oc.column('name').doNothing()).execute();
}
`,
		);

		const again = await seedDatabases({ root, manifest, sources, env, stage });

		expect(again[0]?.seeded).toEqual(['roles']);
		expect(await roles()).toEqual(['Member', 'Reviewer', 'Super admin']);
	});

	it('runs seeds in name order, and a .sql seed whole', async () => {
		await seedFile(
			'02_reviewer.sql',
			`insert into roles (name) values ('Reviewer') on conflict do nothing;`,
		);
		await seedFile(
			'01_admin.ts',
			`export async function seed(db) {
  await db.insertInto('roles').values({ name: 'Admin' }).onConflict((oc) => oc.doNothing()).execute();
}
`,
		);

		const { seeds } = await migrateAndSeed({
			root,
			manifest,
			sources,
			env,
			stage,
		});

		expect(seeds[0]?.seeded).toEqual(['01_admin', '02_reviewer', 'roles']);
	});

	it('migrates the database a tenant lives in before seeding only the tenant', async () => {
		await mkdir(join(root, 'db/auth-database/seeds'), { recursive: true });
		await writeFile(
			join(root, 'db/auth-database/migrations/20260101000100_session.sql'),
			'create table "session" ("id" text primary key);',
		);
		await writeFile(
			join(root, 'db/auth-database/seeds/session.sql'),
			`insert into "session" ("id") values ('system') on conflict do nothing;`,
		);

		const { migrations, seeds } = await migrateAndSeed({
			root,
			manifest,
			sources,
			env,
			stage,
			only: 'auth-database',
		});

		expect(migrations.map((r) => r.target.id)).toEqual([
			'Database',
			'AuthDatabase',
		]);
		expect(seeds.map((r) => [r.target.id, r.seeded])).toEqual([
			['AuthDatabase', ['session']],
		]);
		expect(await roles()).toEqual([]);
	});

	it('hands every seed the stage, so it can decide what belongs there', async () => {
		await seedFile(
			'demo.ts',
			`export async function seed(db, { stage }) {
  if (stage === 'production') return;
  await db.insertInto('roles').values({ name: 'Demo' }).onConflict((oc) => oc.doNothing()).execute();
}
`,
		);

		await migrateAndSeed({ root, manifest, sources, env, stage });
		expect(await roles()).toEqual(['Member', 'Super admin']);

		await seedDatabases({
			root,
			manifest,
			sources,
			env,
			stage: 'development',
		});
		expect(await roles()).toEqual(['Demo', 'Member', 'Super admin']);
	});

	it('rolls a failing seed back and names it', async () => {
		await seedFile(
			'zz_broken.ts',
			`export async function seed(db) {
  await db.insertInto('roles').values({ name: 'Half' }).execute();
  await db.insertInto('missing').values({ name: 'x' }).execute();
}
`,
		);

		const failure = await migrateAndSeed({
			root,
			manifest,
			sources,
			env,
			stage,
		}).catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(SeedFailed);
		expect(failure).toMatchObject({
			construct: 'Database',
			seed: 'zz_broken',
		});
		// The seed before it stays; the broken one's first insert does not.
		expect(await roles()).toEqual(['Member', 'Super admin']);
	});

	it('refuses a seed script that exports no seed', async () => {
		await seedFile('lookup.ts', 'export async function up() {}');

		await expect(
			migrateAndSeed({ root, manifest, sources, env, stage }),
		).rejects.toBeInstanceOf(SeedHasNoSeed);
	});
});
