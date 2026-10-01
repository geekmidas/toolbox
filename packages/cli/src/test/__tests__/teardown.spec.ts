import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SqlClient } from '../../reconcile/provision';
import { TEST_READY_FILE, type TestReady } from '../ready';
import { dropTestDatabases, NotATestDatabase } from '../teardown';

/** Records what it was asked to run, against which port. */
function recordingSql() {
	const ran: { port: number; sql: string }[] = [];
	const sql = (port: number): SqlClient => ({
		async query(_database, statement) {
			ran.push({ port, sql: statement });
			return [];
		},
	});
	return { sql, ran };
}

describe('dropTestDatabases', () => {
	let root: string;
	const ready = () => join(root, TEST_READY_FILE);
	const state = () => join(root, '.gkm', 'reconcile', 'test.json');

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'gkm-teardown-'));
		await mkdir(join(root, '.gkm', 'reconcile'), { recursive: true });
		await writeFile(state(), JSON.stringify({ hash: 'h', stage: 'test' }));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	const record = (databases?: TestReady['databases']) =>
		writeFile(
			ready(),
			JSON.stringify({ env: 'env.json', ...(databases ? { databases } : {}) }),
		);

	it('drops what the setup recorded, forcing off open connections', async () => {
		await record({ port: 5433, names: ['orders_test', 'auth_test'] });
		const { sql, ran } = recordingSql();

		expect(await dropTestDatabases(root, root, sql)).toEqual([
			'orders_test',
			'auth_test',
		]);
		expect(ran).toEqual([
			{ port: 5433, sql: 'DROP DATABASE IF EXISTS "orders_test" WITH (FORCE)' },
			{ port: 5433, sql: 'DROP DATABASE IF EXISTS "auth_test" WITH (FORCE)' },
		]);
	});

	it('forgets the test reconcile, so the next run creates them again', async () => {
		await record({ port: 5433, names: ['orders_test'] });

		await dropTestDatabases(root, root, recordingSql().sql);

		expect(existsSync(state())).toBe(false);
	});

	it('keeps the rest of the ready file, and is a no-op the second time', async () => {
		await record({ port: 5433, names: ['orders_test'] });
		const { sql, ran } = recordingSql();

		await dropTestDatabases(root, root, sql);
		expect(JSON.parse(await readFile(ready(), 'utf-8'))).toEqual({
			env: 'env.json',
		});

		expect(await dropTestDatabases(root, root, sql)).toEqual([]);
		expect(ran).toHaveLength(1);
	});

	it('does nothing before any setup', async () => {
		const { sql, ran } = recordingSql();

		expect(await dropTestDatabases(root, root, sql)).toEqual([]);
		expect(ran).toEqual([]);
		expect(existsSync(state())).toBe(true);
	});

	it('refuses a database without the test suffix — the container is shared', async () => {
		await record({ port: 5433, names: ['orders'] });
		const { sql, ran } = recordingSql();

		await expect(dropTestDatabases(root, root, sql)).rejects.toBeInstanceOf(
			NotATestDatabase,
		);
		expect(ran).toEqual([]);
		expect(existsSync(state())).toBe(true);
	});
});
