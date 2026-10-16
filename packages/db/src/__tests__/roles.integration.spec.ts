import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_CONFIG } from '../../../testkit/test/globalSetup';
import { ownerRole, roleStatements } from '../pg/roles';

/**
 * A declared extension, against real Postgres.
 *
 * `postgres_fdw` stands in for PostGIS: both are untrusted, so only the
 * master may create them, but this one ships in the stock image the suite
 * runs on.
 */
const DATABASE = `roles_ext_${process.pid}`;
const runtime = `geo_${process.pid}`;
const owner = ownerRole(runtime);
const passwords = { runtime: 'runtime-pw', owner: 'owner-pw' };

const spec = {
	runtime,
	owner,
	schema: 'app',
	database: DATABASE,
	extensions: ['postgres_fdw'],
	passwords,
};

async function connect(as?: { user: string; password: string }) {
	const client = new pg.Client({
		...TEST_DATABASE_CONFIG,
		database: DATABASE,
		...as,
	});
	await client.connect();
	return client;
}

async function apply() {
	const master = await connect();
	try {
		for (const statement of roleStatements(spec)) {
			if (statement.exists) {
				const { rows } = await master.query(
					statement.exists.sql,
					statement.exists.values,
				);
				if (rows.length > 0) continue;
			}
			await master.query(statement.sql);
		}
	} finally {
		await master.end();
	}
}

describe('a declared extension', () => {
	beforeAll(async () => {
		const admin = new pg.Client({
			...TEST_DATABASE_CONFIG,
			database: 'postgres',
		});
		await admin.connect();
		await admin.query(`DROP DATABASE IF EXISTS "${DATABASE}"`);
		await admin.query(`CREATE DATABASE "${DATABASE}"`);
		await admin.end();
	});

	afterAll(async () => {
		const admin = new pg.Client({
			...TEST_DATABASE_CONFIG,
			database: 'postgres',
		});
		await admin.connect();
		await admin.query(`DROP DATABASE IF EXISTS "${DATABASE}" WITH (FORCE)`);
		for (const role of [runtime, owner]) {
			await admin.query(`DROP ROLE IF EXISTS "${role}"`);
		}
		await admin.end();
	});

	it('is one the owner could not have created itself', async () => {
		// Roles first, without the extension, so the owner exists to try.
		const master = await connect();
		for (const statement of roleStatements({ ...spec, extensions: [] })) {
			if (statement.exists) {
				const { rows } = await master.query(
					statement.exists.sql,
					statement.exists.values,
				);
				if (rows.length > 0) continue;
			}
			await master.query(statement.sql);
		}
		await master.end();

		const asOwner = await connect({ user: owner, password: passwords.owner });
		await expect(
			asOwner.query('CREATE EXTENSION postgres_fdw'),
		).rejects.toThrow(/permission denied/);
		await asOwner.end();
	});

	it('is created in public, and resolves unqualified for every role', async () => {
		await apply();

		const master = await connect();
		const { rows } = await master.query(
			`SELECT n.nspname FROM pg_extension e
			 JOIN pg_namespace n ON n.oid = e.extnamespace
			 WHERE e.extname = 'postgres_fdw'`,
		);
		await master.end();
		expect(rows).toEqual([{ nspname: 'public' }]);

		for (const as of [
			{ user: owner, password: passwords.owner },
			{ user: runtime, password: passwords.runtime },
		]) {
			const client = await connect(as);
			const resolved = await client.query(
				`SELECT to_regproc('postgres_fdw_handler') IS NOT NULL AS found`,
			);
			await client.end();
			expect(resolved.rows).toEqual([{ found: true }]);
		}
	});

	it('still puts the owner’s tables in its schema, not public', async () => {
		const asOwner = await connect({ user: owner, password: passwords.owner });
		await asOwner.query('CREATE TABLE places (id int)');
		const { rows } = await asOwner.query(
			`SELECT schemaname FROM pg_tables WHERE tablename = 'places'`,
		);
		await asOwner.end();

		expect(rows).toEqual([{ schemaname: 'app' }]);
	});

	it('converges on a second apply', async () => {
		await expect(apply()).resolves.toBeUndefined();
	});
});
