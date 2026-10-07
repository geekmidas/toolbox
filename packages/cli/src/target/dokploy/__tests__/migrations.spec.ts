/**
 * A deployed stage's migrations, run the way `release` runs them: in a
 * sandbox, against the test Postgres standing in for a published cluster,
 * with the URL handed over as a secret file.
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

		expect(runs).toEqual([
			{
				migrations: 'db/database/migrations',
				applied: ['20260101000000_orders'],
			},
		]);
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

		expect(await runMigrations(options)).toEqual([
			{ migrations: 'db/database/migrations', applied: [] },
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
