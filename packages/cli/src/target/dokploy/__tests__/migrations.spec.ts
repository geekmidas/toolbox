/**
 * A deployed stage's migrations and seeds, run the way `release` runs them:
 * in a sandbox, against the test Postgres standing in for a published
 * cluster, with the URL handed over as a secret file.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_CONFIG } from '../../../../../testkit/test/globalSetup';
import { cleanupDir, createTempDir } from '../../../__tests__/test-helpers';
import { LocalSandbox } from '../../../sandbox/local';
import type { Sandbox, SandboxExecOptions } from '../../../sandbox/sandbox';
import { DeploySeedsFailed } from '../../seeds';
import { migrationUrls, runMigrations } from '../migrations';

const { host, port, user, password } = TEST_DATABASE_CONFIG;

/** A database the project migrates as the master — `roles: false`. */
const manifest = {
	Database: {
		kind: 'database',
		id: 'Database',
		roles: false,
		provides: ['DATABASE_URL'],
	},
} as unknown as ConstructManifest;

async function query<T = Record<string, unknown>>(
	sql: string,
	database = TEST_DATABASE_CONFIG.database,
): Promise<T[]> {
	const client = new pg.Client({ ...TEST_DATABASE_CONFIG, database });
	await client.connect();
	try {
		return (await client.query(sql)).rows as T[];
	} finally {
		await client.end();
	}
}

/** A sandbox that runs everything in a `LocalSandbox`, and remembers how. */
function recording(root: string): {
	sandbox: Sandbox;
	calls: SandboxExecOptions[];
} {
	const local = new LocalSandbox({ root });
	const calls: SandboxExecOptions[] = [];
	return {
		calls,
		sandbox: {
			root: local.root,
			isolating: false,
			env: local.env,
			exec(command, args, options) {
				calls.push(options);
				return local.exec(command, args, options);
			},
		},
	};
}

describe('runMigrations', { timeout: 30_000 }, () => {
	let root: string;
	let database: string;
	let url: string;

	beforeEach(async () => {
		root = await createTempDir('deploy-migrations-');
		await writeFile(
			join(root, 'package.json'),
			JSON.stringify({ name: 'shop', type: 'module' }),
		);
		await mkdir(join(root, 'db/database/migrations'), { recursive: true });
		await writeFile(
			join(root, 'db/database/migrations/20260101000000_orders.ts'),
			`export async function up(db) {
  await db.schema.createTable('orders').addColumn('id', 'uuid', (c) => c.primaryKey()).execute();
}
`,
		);

		// A database of its own, as a cluster is: Kysely looks for its history
		// tables in every schema it can see, and the suites beside this one
		// migrate schemas of the shared test database at the same time.
		database = `deploy_mig_${randomUUID().slice(0, 8)}`;
		await query(`CREATE DATABASE "${database}"`);
		url = `postgres://${user}:${password}@${host}:${port}/${database}`;
	});

	afterEach(async () => {
		await query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
		await cleanupDir(root);
	});

	it('applies what is pending, with the URL as a secret file and never a variable', async () => {
		const { sandbox, calls } = recording(root);

		const runs = await runMigrations({
			root,
			stage: 'production',
			manifest,
			patterns: [],
			urls: { DATABASE_URL: url },
			signal: new AbortController().signal,
			sandbox,
		});

		expect(runs).toEqual({
			migrations: [
				{
					construct: 'Database',
					migrations: 'db/database/migrations',
					applied: ['20260101000000_orders'],
				},
			],
			seeds: [
				{ construct: 'Database', seeds: 'db/database/seeds', seeded: [] },
			],
		});
		const tables = await query<{ table_name: string }>(
			"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1",
			database,
		);
		expect(tables.map((t) => t.table_name)).toContain('orders');

		// Mounted as a file the worker reads, and nowhere in the environment its
		// children would inherit.
		expect(calls).toHaveLength(1);
		expect(calls[0]!.secrets).toEqual({ DATABASE_URL: url });
		expect(Object.values(calls[0]!.env)).not.toContain(url);
		expect(JSON.stringify(calls[0]!.env)).not.toContain(password);
	});

	it('applies nothing twice', async () => {
		const options = {
			root,
			stage: 'production',
			manifest,
			patterns: [],
			urls: { DATABASE_URL: url },
			signal: new AbortController().signal,
		};
		await runMigrations(options);

		expect((await runMigrations(options)).migrations).toEqual([
			{
				construct: 'Database',
				migrations: 'db/database/migrations',
				applied: [],
			},
		]);
	});

	it('fails the release with the migration that failed', async () => {
		await writeFile(
			join(root, 'db/database/migrations/20260102000000_broken.ts'),
			`export async function up(db) {
  await db.schema.alterTable('nowhere').addColumn('x', 'text').execute();
}
`,
		);

		await expect(
			runMigrations({
				root,
				stage: 'production',
				manifest,
				patterns: [],
				urls: { DATABASE_URL: url },
				signal: new AbortController().signal,
			}),
		).rejects.toMatchObject({
			name: 'DeployMigrationsFailed',
			reason: 'MigrationFailed',
			message: expect.stringContaining('20260102000000_broken'),
		});
	});
});

describe('runMigrations, with seeds', { timeout: 30_000 }, () => {
	let root: string;
	let database: string;
	let url: string;

	beforeEach(async () => {
		root = await createTempDir('deploy-seeds-');
		await writeFile(
			join(root, 'package.json'),
			JSON.stringify({ name: 'shop', type: 'module' }),
		);
		await mkdir(join(root, 'db/database/migrations'), { recursive: true });
		await mkdir(join(root, 'db/database/seeds'), { recursive: true });
		await writeFile(
			join(root, 'db/database/migrations/20260101000000_roles.sql'),
			'create table roles (name text primary key, label text not null);',
		);
		// A script — the project's own code, as a seed usually is — and a .sql
		// one that reads what the first wrote: they run in name order.
		await writeFile(
			join(root, 'db/database/seeds/001_roles.ts'),
			`export async function seed(db, { stage }) {
  await db
    .insertInto('roles')
    .values([{ name: 'member', label: 'Member (' + stage + ')' }, { name: 'admin', label: 'Admin' }])
    .onConflict((oc) => oc.column('name').doUpdateSet((eb) => ({ label: eb.ref('excluded.label') })))
    .execute();
}
`,
		);
		await writeFile(
			join(root, 'db/database/seeds/002_owner.sql'),
			"insert into roles (name, label) select 'owner', label from roles where name = 'admin' on conflict (name) do update set label = excluded.label;",
		);

		database = `deploy_seed_${randomUUID().slice(0, 8)}`;
		await query(`CREATE DATABASE "${database}"`);
		url = `postgres://${user}:${password}@${host}:${port}/${database}`;
	});

	afterEach(async () => {
		await query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
		await cleanupDir(root);
	});

	const options = () => ({
		root,
		stage: 'production',
		manifest,
		patterns: [],
		urls: { DATABASE_URL: url },
		signal: new AbortController().signal,
	});

	it('runs every seed after the migrations, in one sandbox run, handed the stage', async () => {
		const { sandbox, calls } = recording(root);

		const ran = await runMigrations({ ...options(), sandbox });

		expect(ran).toEqual({
			migrations: [
				{
					construct: 'Database',
					migrations: 'db/database/migrations',
					applied: ['20260101000000_roles'],
				},
			],
			seeds: [
				{
					construct: 'Database',
					seeds: 'db/database/seeds',
					seeded: ['001_roles', '002_owner'],
				},
			],
		});
		expect(
			await query('SELECT name, label FROM roles ORDER BY name', database),
		).toEqual([
			{ name: 'admin', label: 'Admin' },
			{ name: 'member', label: 'Member (production)' },
			{ name: 'owner', label: 'Admin' },
		]);
		// Through the sandbox, the URL a file and never a variable.
		expect(calls).toHaveLength(1);
		expect(calls[0]!.secrets).toEqual({ DATABASE_URL: url });
		expect(JSON.stringify(calls[0]!.env)).not.toContain(password);
	});

	it('runs every seed again on the next deploy, changing nothing', async () => {
		await runMigrations(options());
		const ran = await runMigrations(options());

		expect(ran.migrations[0]!.applied).toEqual([]);
		expect(ran.seeds[0]!.seeded).toEqual(['001_roles', '002_owner']);
		expect(
			await query<{ count: string }>(
				'SELECT count(*)::text AS count FROM roles',
				database,
			),
		).toEqual([{ count: '3' }]);
	});

	it('fails the release naming the construct and the seed, keeping the cause, with its writes rolled back', async () => {
		await writeFile(
			join(root, 'db/database/seeds/003_broken.sql'),
			"insert into roles (name, label) values ('guest', 'Guest'); insert into nowhere values (1);",
		);

		const error = await runMigrations(options()).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(DeploySeedsFailed);
		expect(error).toMatchObject({
			stage: 'production',
			construct: 'Database',
			seed: '003_broken',
			cause: {
				name: 'SeedFailed',
				cause: { message: expect.stringContaining('"nowhere"') },
			},
			message: expect.stringContaining('relation "nowhere" does not exist'),
		});
		// The migration and the seeds before it stay; the failing one's own
		// write does not.
		expect(
			(await query<{ name: string }>('SELECT name FROM roles', database)).map(
				(row) => row.name,
			),
		).not.toContain('guest');
		expect(
			await query<{ count: string }>(
				'SELECT count(*)::text AS count FROM roles',
				database,
			),
		).toEqual([{ count: '3' }]);
	});
});

describe('migrationUrls', () => {
	let root: string;

	beforeEach(async () => {
		root = await createTempDir('deploy-migration-urls-');
	});

	afterEach(async () => {
		await cleanupDir(root);
	});

	it('is empty for a project with no migration to apply, so nothing is published', async () => {
		expect(
			await migrationUrls(root, manifest, {
				DATABASE_URL: 'postgresql://shop:pw@production-shop-database:5432/shop',
			}),
		).toEqual(new Map());
	});

	it('includes a construct with seeds and no migration: its seeds still run', async () => {
		await mkdir(join(root, 'db/database/seeds'), { recursive: true });
		await writeFile(join(root, 'db/database/seeds/001_roles.sql'), 'select 1;');

		expect(
			await migrationUrls(root, manifest, {
				DATABASE_URL: 'postgresql://shop:pw@production-shop-database:5432/shop',
			}),
		).toEqual(
			new Map([
				[
					'shop',
					{
						DATABASE_URL:
							'postgresql://shop:pw@production-shop-database:5432/shop',
					},
				],
			]),
		);
	});

	it("groups each construct's URLs by the database its cluster serves", async () => {
		await mkdir(join(root, 'db/database/migrations'), { recursive: true });
		await writeFile(
			join(root, 'db/database/migrations/20260101000000_orders.sql'),
			'create table orders (id int);',
		);

		expect(
			await migrationUrls(root, manifest, {
				DATABASE_URL: 'postgresql://shop:pw@production-shop-database:5432/shop',
				DATABASE_OWNER_URL:
					'postgresql://shop_owner:pw@production-shop-database:5432/shop',
				OTHER_URL: 'https://example.com',
			}),
		).toEqual(
			new Map([
				[
					'shop',
					{
						DATABASE_OWNER_URL:
							'postgresql://shop_owner:pw@production-shop-database:5432/shop',
						DATABASE_URL:
							'postgresql://shop:pw@production-shop-database:5432/shop',
					},
				],
			]),
		);
	});
});
