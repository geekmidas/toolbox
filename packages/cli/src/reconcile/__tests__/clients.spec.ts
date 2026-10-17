import type { LifecycleRule } from '@aws-sdk/client-s3';
import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_CONFIG } from '../../../../testkit/test/globalSetup';
import {
	LOCALSTACK_PORT,
	MINIO_PORT,
	POSTGRES_PORT,
} from '../../../../testkit/test/ports';
import { expireRuleId } from '../../providers/s3/lifecycle';
import { bucketClient, pgClient } from '../clients';
import { applyLifecycles } from '../provision';

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

/**
 * A bucket's lifecycle against the suite's real MinIO — the one a local or
 * compose stack runs — rather than the emulator, whose lifecycle is its own.
 */
describe('bucketClient against MinIO: lifecycle', () => {
	const buckets = bucketClient(MINIO_PORT, {
		user: 'geekmidas',
		password: 'geekmidas',
	});
	const bucket = `lifecycle-${Date.now()}`;
	// Someone else's rule — an expiry, since MinIO refuses a rule that only
	// aborts incomplete multipart uploads.
	const foreign: LifecycleRule = {
		ID: 'keep-logs',
		Status: 'Enabled',
		Filter: { Prefix: 'logs/' },
		Expiration: { Days: 90 },
	};

	beforeAll(async () => {
		await buckets.create(bucket);
	});

	it('has none, then holds what was merged in, beside a rule it already had', async () => {
		await expect(buckets.lifecycle(bucket)).resolves.toBeUndefined();
		await buckets.setLifecycle(bucket, [foreign]);

		const lifecycles = [{ bucket, expire: { 'quotes/': 30 } }];
		const first = await applyLifecycles(buckets, lifecycles);
		const second = await applyLifecycles(buckets, lifecycles);

		expect(first.map((a) => a.created)).toEqual([true]);
		// MinIO reads back what it was given: the merge converges.
		expect(second.map((a) => a.created)).toEqual([false]);
		const rules = (await buckets.lifecycle(bucket)) ?? [];
		expect(rules.map((r) => r.ID).sort()).toEqual(
			['keep-logs', expireRuleId('quotes/')].sort(),
		);
		expect(rules.find((r) => r.ID === expireRuleId('quotes/'))).toMatchObject({
			Status: 'Enabled',
			Filter: { Prefix: 'quotes/' },
			Expiration: { Days: 30 },
		});
	});

	it('removes the lifecycle when the last rule goes', async () => {
		await buckets.setLifecycle(bucket, []);

		await expect(buckets.lifecycle(bucket)).resolves.toBeUndefined();
	});
});
