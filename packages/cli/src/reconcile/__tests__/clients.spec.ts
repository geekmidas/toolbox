import { describe, expect, it } from 'vitest';
import { TEST_DATABASE_CONFIG } from '../../../../testkit/test/globalSetup';
import { LOCALSTACK_PORT, POSTGRES_PORT } from '../../../../testkit/test/ports';
import { bucketClient, pgClient } from '../clients';

/**
 * The drivers reconcile's applier runs against, against the real thing: the
 * suite's Postgres, and the AWS emulator's S3 — which speaks the same protocol
 * MinIO does, credentials and path-style addressing included.
 */
describe('pgClient', () => {
	// The suite's own Postgres, and its superuser.
	const sql = pgClient(POSTGRES_PORT, {
		user: TEST_DATABASE_CONFIG.user,
		password: TEST_DATABASE_CONFIG.password,
	});

	it('queries `postgres` when no database is named — every cluster has it', async () => {
		const rows = await sql.query(undefined, 'SELECT current_database() AS db');

		expect(rows).toEqual([{ db: 'postgres' }]);
	});

	it('connects to the database it is asked about, with parameters', async () => {
		const rows = await sql.query(
			'postgres',
			'SELECT current_database() AS db, $1::text AS echoed',
			['hello'],
		);

		expect(rows).toEqual([{ db: 'postgres', echoed: 'hello' }]);
	});

	it('lets a failing statement fail, and does not leak the connection', async () => {
		await expect(
			sql.query(undefined, 'SELECT * FROM no_such_table_anywhere'),
		).rejects.toThrow('no_such_table_anywhere');

		// Still usable: the failed connection was closed, not left open.
		await expect(sql.query(undefined, 'SELECT 1 AS one')).resolves.toEqual([
			{ one: 1 },
		]);
	});
});

describe('bucketClient', () => {
	// The emulator takes any key pair.
	const emulator = { user: 'test', password: 'test-secret' };
	const buckets = bucketClient(LOCALSTACK_PORT, emulator);
	const bucket = `reconcile-${Date.now()}`;

	it('creates a bucket that did not exist', async () => {
		await expect(buckets.exists(bucket)).resolves.toBe(false);

		await buckets.create(bucket);

		await expect(buckets.exists(bucket)).resolves.toBe(true);
	});

	it('reads back the policy it wrote, and has none before', async () => {
		const name = `${bucket}-policy`;
		await buckets.create(name);
		await expect(buckets.policy(name)).resolves.toBeUndefined();

		const policy = JSON.stringify({
			Version: '2012-10-17',
			Statement: [
				{
					Effect: 'Allow',
					Principal: '*',
					Action: 's3:GetObject',
					Resource: `arn:aws:s3:::${name}/public/*`,
				},
			],
		});
		await buckets.setPolicy(name, policy);

		expect(JSON.parse((await buckets.policy(name))!)).toEqual(
			JSON.parse(policy),
		);
	});

	it('answers "missing" rather than failing when nothing is listening', async () => {
		const unreachable = bucketClient(1, emulator);

		await expect(unreachable.exists(bucket)).resolves.toBe(false);
		await expect(unreachable.policy(bucket)).resolves.toBeUndefined();
	});
});
