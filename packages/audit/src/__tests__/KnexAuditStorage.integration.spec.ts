import knexFactory, { type Knex } from 'knex';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from 'vitest';
import { TEST_DATABASE_CONFIG } from '../../../testkit/test/globalSetup';
import { DefaultAuditor } from '../DefaultAuditor';
import {
	type AuditLogTable,
	KnexAuditStorage,
	withAuditableTransaction,
} from '../knex';
import type { AuditableAction, AuditRecord } from '../types';

// Use unique table names to avoid conflicts with parallel tests
const AUDIT_TABLE = 'audit_knex_int_logs' as const;
const AUTO_ID_TABLE = 'audit_knex_int_auto' as const;
const USERS_TABLE = 'audit_knex_int_users' as const;

// Define test audit actions
type TestAuditAction =
	| AuditableAction<'user.created', { userId: number; email: string }>
	| AuditableAction<'user.updated', { userId: number; changes: string[] }>
	| AuditableAction<'user.deleted', { userId: number }>;

function auditColumns(db: Knex, table: Knex.CreateTableBuilder): void {
	table.string('type').notNullable();
	table.string('operation').notNullable();
	table.string('table');
	table.string('entityId');
	table.jsonb('oldValues');
	table.jsonb('newValues');
	table.jsonb('payload');
	table.timestamp('timestamp').notNullable().defaultTo(db.fn.now());
	table.string('actorId');
	table.string('actorType');
	table.jsonb('actorData');
	table.jsonb('metadata');
}

describe('KnexAuditStorage Integration Tests', () => {
	let db: Knex;
	let storage: KnexAuditStorage;

	beforeAll(async () => {
		db = knexFactory({
			client: 'pg',
			connection: {
				...TEST_DATABASE_CONFIG,
				database: 'postgres',
			},
		});

		// Recreate tables so a crashed previous run cannot leak state
		await db.schema.dropTableIfExists(AUDIT_TABLE);
		await db.schema.dropTableIfExists(AUTO_ID_TABLE);
		await db.schema.dropTableIfExists(USERS_TABLE);

		// Audit table with client-supplied IDs
		await db.schema.createTable(AUDIT_TABLE, (table) => {
			table.string('id', 32).primary();
			auditColumns(db, table);
		});

		// Audit table where the database generates IDs
		await db.schema.createTable(AUTO_ID_TABLE, (table) => {
			table.uuid('id').primary().defaultTo(db.raw('gen_random_uuid()'));
			auditColumns(db, table);
		});

		// Users table for testing audit integration
		await db.schema.createTable(USERS_TABLE, (table) => {
			table.increments('id').primary();
			table.string('name').notNullable();
			table.string('email').notNullable().unique();
		});

		storage = new KnexAuditStorage({
			db,
			tableName: AUDIT_TABLE,
		});
	});

	afterEach(async () => {
		// Clean up data after each test
		await db(AUDIT_TABLE).del();
		await db(AUTO_ID_TABLE).del();
		await db(USERS_TABLE).del();
	});

	afterAll(async () => {
		// Drop tables and close connection
		await db.schema.dropTableIfExists(AUDIT_TABLE);
		await db.schema.dropTableIfExists(AUTO_ID_TABLE);
		await db.schema.dropTableIfExists(USERS_TABLE);
		await db.destroy();
	});

	describe('write', () => {
		it('should write audit records to database', async () => {
			const auditor = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'user-123', type: 'user' },
				storage,
				metadata: { requestId: 'req-456' },
			});

			auditor.audit('user.created', { userId: 1, email: 'test@example.com' });

			await auditor.flush();

			// Verify record was written
			const records = await db<AuditLogTable>(AUDIT_TABLE).select('*');

			expect(records).toHaveLength(1);
			expect(records[0].type).toBe('user.created');
			expect(records[0].operation).toBe('CUSTOM');
			expect(records[0].actorId).toBe('user-123');
			expect(records[0].actorType).toBe('user');
			expect(records[0].payload).toEqual({
				userId: 1,
				email: 'test@example.com',
			});
			expect(records[0].metadata).toEqual({
				requestId: 'req-456',
			});
		});

		it('should write multiple audit records in batch', async () => {
			const auditor = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'admin-1', type: 'admin' },
				storage,
			});

			auditor.audit('user.created', { userId: 1, email: 'user1@example.com' });
			auditor.audit('user.created', { userId: 2, email: 'user2@example.com' });
			auditor.audit('user.updated', { userId: 1, changes: ['name'] });

			await auditor.flush();

			const records = await db<AuditLogTable>(AUDIT_TABLE)
				.select('*')
				.orderBy('timestamp', 'asc');

			expect(records).toHaveLength(3);
			expect(records.map((r) => r.type).sort()).toEqual([
				'user.created',
				'user.created',
				'user.updated',
			]);
		});

		it('should do nothing for empty records', async () => {
			await storage.write([]);

			expect(await storage.count({})).toBe(0);
		});

		it('should persist old and new values', async () => {
			const auditor = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'admin-1', type: 'admin' },
				storage,
			});

			auditor.audit(
				'user.updated',
				{ userId: 1, changes: ['name'] },
				{
					operation: 'UPDATE',
					oldValues: { name: 'Old Name' },
					newValues: { name: 'New Name' },
				},
			);

			await auditor.flush();

			const [record] = await storage.query({});
			expect(record.operation).toBe('UPDATE');
			expect(record.oldValues).toEqual({ name: 'Old Name' });
			expect(record.newValues).toEqual({ name: 'New Name' });
		});

		it('should round-trip complex entity IDs', async () => {
			const records: AuditRecord[] = [
				{
					id: 'audit-complex-1',
					type: 'relation.created',
					operation: 'INSERT',
					entityId: { userId: 'u1', roleId: 'r1' },
					timestamp: new Date(),
				},
			];

			await storage.write(records);

			const [stored] = await db<AuditLogTable>(AUDIT_TABLE).select('*');
			expect(stored.entityId).toBe(
				JSON.stringify({ userId: 'u1', roleId: 'r1' }),
			);

			const [queried] = await storage.query({});
			expect(queried.entityId).toEqual({ userId: 'u1', roleId: 'r1' });
		});

		it('should store extra actor properties', async () => {
			const auditor = new DefaultAuditor<TestAuditAction>({
				actor: {
					id: 'user-1',
					type: 'user',
					email: 'user@example.com',
					role: 'admin',
				},
				storage,
			});

			auditor.audit('user.created', { userId: 1, email: 'user@example.com' });
			await auditor.flush();

			const [stored] = await db<AuditLogTable>(AUDIT_TABLE).select('*');
			expect(stored.actorId).toBe('user-1');
			expect(stored.actorType).toBe('user');
			expect(stored.actorData).toEqual({
				email: 'user@example.com',
				role: 'admin',
			});

			const [queried] = await storage.query({});
			expect(queried.actor).toEqual({
				id: 'user-1',
				type: 'user',
				email: 'user@example.com',
				role: 'admin',
			});
		});

		it('should use the provided record ID', async () => {
			await storage.write([
				{
					id: 'my-custom-id',
					type: 'user.created',
					operation: 'CUSTOM',
					timestamp: new Date(),
				},
			]);

			const [stored] = await db<AuditLogTable>(AUDIT_TABLE).select('*');
			expect(stored.id).toBe('my-custom-id');
		});

		it('should generate an ID when the record has none', async () => {
			await storage.write([
				{
					id: '', // Empty ID
					type: 'user.created',
					operation: 'CUSTOM',
					timestamp: new Date(),
				},
			]);

			const [stored] = await db<AuditLogTable>(AUDIT_TABLE).select('*');
			expect(stored.id).toBeTruthy();
			expect(stored.id.length).toBeGreaterThan(0);
		});

		it('should write audit records within transaction', async () => {
			const auditor = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'user-123', type: 'user' },
				storage,
			});

			await db.transaction(async (trx) => {
				// Insert user
				const [user] = await trx(USERS_TABLE)
					.insert({ name: 'Test User', email: 'test@example.com' })
					.returning('*');

				// Audit the creation
				auditor.audit(
					'user.created',
					{ userId: user.id, email: user.email },
					{ entityId: String(user.id), table: 'users', operation: 'INSERT' },
				);

				// Flush within transaction
				await auditor.flush(trx);
			});

			// Verify both user and audit record exist
			const users = await db(USERS_TABLE).select('*');
			const audits = await db<AuditLogTable>(AUDIT_TABLE).select('*');

			expect(users).toHaveLength(1);
			expect(audits).toHaveLength(1);
			expect(audits[0].entityId).toBe(String(users[0].id));
			expect(audits[0].table).toBe('users');
			expect(audits[0].operation).toBe('INSERT');
		});

		it('should rollback audit records when transaction fails', async () => {
			const auditor = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'user-123', type: 'user' },
				storage,
			});

			const transactionPromise = db.transaction(async (trx) => {
				// Insert user
				const [user] = await trx(USERS_TABLE)
					.insert({ name: 'Rollback User', email: 'rollback@example.com' })
					.returning('*');

				// Audit the creation
				auditor.audit('user.created', { userId: user.id, email: user.email });

				// Flush within transaction
				await auditor.flush(trx);

				// Throw error to rollback
				throw new Error('Transaction should rollback');
			});

			await expect(transactionPromise).rejects.toThrow(
				'Transaction should rollback',
			);

			// Verify both user and audit record were rolled back
			const users = await db(USERS_TABLE).select('*');
			const audits = await db(AUDIT_TABLE).select('*');

			expect(users).toHaveLength(0);
			expect(audits).toHaveLength(0);
		});
	});

	describe('autoId', () => {
		it('should let the database generate IDs when autoId is true', async () => {
			const autoIdStorage = new KnexAuditStorage({
				db,
				tableName: AUTO_ID_TABLE,
				autoId: true,
			});

			const auditor = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'user-1', type: 'user' },
				storage: autoIdStorage,
			});

			auditor.audit('user.created', { userId: 1, email: 'auto@example.com' });
			await auditor.flush();

			const records = await db<AuditLogTable>(AUTO_ID_TABLE).select('*');
			expect(records).toHaveLength(1);
			expect(records[0].id).toMatch(/^[0-9a-f-]{36}$/);
		});

		it('should ignore a supplied ID when autoId is true', async () => {
			const autoIdStorage = new KnexAuditStorage({
				db,
				tableName: AUTO_ID_TABLE,
				autoId: true,
			});

			await autoIdStorage.write([
				{
					id: 'explicit-id', // Not a UUID - would fail if it reached the insert
					type: 'user.created',
					operation: 'CUSTOM',
					timestamp: new Date(),
				},
			]);

			const records = await db<AuditLogTable>(AUTO_ID_TABLE).select('*');
			expect(records).toHaveLength(1);
			expect(records[0].id).not.toBe('explicit-id');
			expect(records[0].id).toMatch(/^[0-9a-f-]{36}$/);
		});
	});

	describe('getDatabase', () => {
		it('should return the knex instance', () => {
			expect(storage.getDatabase()).toBe(db);
		});
	});

	describe('withAuditableTransaction', () => {
		it('should commit user and audits together', async () => {
			const auditor = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'admin-1', type: 'admin' },
				storage,
			});

			const created = await withAuditableTransaction(
				db,
				auditor,
				async (trx) => {
					const [user] = await trx(USERS_TABLE)
						.insert({ name: 'Atomic User', email: 'atomic@example.com' })
						.returning('*');

					auditor.audit(
						'user.created',
						{ userId: user.id, email: user.email },
						{ entityId: String(user.id), table: 'users', operation: 'INSERT' },
					);

					return user;
				},
			);

			const audits = await db<AuditLogTable>(AUDIT_TABLE).select('*');

			expect(created.email).toBe('atomic@example.com');
			expect(audits).toHaveLength(1);
			expect(audits[0].entityId).toBe(String(created.id));
		});

		it('should roll back audits when the callback throws', async () => {
			const auditor = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'admin-1', type: 'admin' },
				storage,
			});

			await expect(
				withAuditableTransaction(db, auditor, async (trx) => {
					await trx(USERS_TABLE).insert({
						name: 'Doomed User',
						email: 'doomed@example.com',
					});

					auditor.audit('user.created', {
						userId: 1,
						email: 'doomed@example.com',
					});

					throw new Error('rollback please');
				}),
			).rejects.toThrow('rollback please');

			const users = await db(USERS_TABLE).select('*');
			const audits = await db(AUDIT_TABLE).select('*');

			expect(users).toHaveLength(0);
			expect(audits).toHaveLength(0);
		});

		it('should honour the requested isolation level', async () => {
			const auditor = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'admin-1', type: 'admin' },
				storage,
			});

			const level = await withAuditableTransaction(
				db,
				auditor,
				async (trx) => {
					const { rows } = await trx.raw('SHOW transaction_isolation');

					auditor.audit('user.created', {
						userId: 1,
						email: 'isolated@example.com',
					});

					return rows[0].transaction_isolation as string;
				},
				{ isolationLevel: 'serializable' },
			);

			expect(level).toBe('serializable');
			expect(await storage.count({})).toBe(1);
		});

		it('should reuse an existing transaction rather than opening a savepoint', async () => {
			const auditor = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'admin-1', type: 'admin' },
				storage,
			});

			// The outer transaction rolls back; if the inner call had opened a
			// savepoint that committed independently, the audit would survive.
			await expect(
				db.transaction(async (outer) => {
					await withAuditableTransaction(outer, auditor, async (trx) => {
						await trx(USERS_TABLE).insert({
							name: 'Nested User',
							email: 'nested@example.com',
						});

						auditor.audit('user.created', {
							userId: 1,
							email: 'nested@example.com',
						});
					});

					throw new Error('outer rollback');
				}),
			).rejects.toThrow('outer rollback');

			const audits = await db(AUDIT_TABLE).select('*');
			expect(audits).toHaveLength(0);
		});
	});

	describe('withTransaction', () => {
		it('should flush audits inside the transaction', async () => {
			const auditor = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'admin-1', type: 'admin' },
				storage,
			});

			const result = await storage.withTransaction(auditor, async () => {
				auditor.audit('user.created', {
					userId: 7,
					email: 'wrapped@example.com',
				});
				return 'ok';
			});

			expect(result).toBe('ok');

			const audits = await db<AuditLogTable>(AUDIT_TABLE).select('*');
			expect(audits).toHaveLength(1);
			expect(audits[0].type).toBe('user.created');
		});

		it('should not write audits when the callback throws', async () => {
			const auditor = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'admin-1', type: 'admin' },
				storage,
			});

			await expect(
				storage.withTransaction(auditor, async () => {
					auditor.audit('user.created', {
						userId: 8,
						email: 'never@example.com',
					});
					throw new Error('nope');
				}),
			).rejects.toThrow('nope');

			expect(await storage.count({})).toBe(0);
		});

		it('should reuse a transaction passed in by the caller', async () => {
			const auditor = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'admin-1', type: 'admin' },
				storage,
			});

			await expect(
				db.transaction(async (outer) => {
					await storage.withTransaction(
						auditor,
						async () => {
							auditor.audit('user.created', {
								userId: 9,
								email: 'reused@example.com',
							});
						},
						outer,
					);

					throw new Error('outer rollback');
				}),
			).rejects.toThrow('outer rollback');

			expect(await storage.count({})).toBe(0);
		});
	});

	describe('query', () => {
		beforeEach(async () => {
			// Insert test audit records
			const auditor1 = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'user-1', type: 'user' },
				storage,
				metadata: { endpoint: '/users' },
			});

			const auditor2 = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'admin-1', type: 'admin' },
				storage,
				metadata: { endpoint: '/admin/users' },
			});

			auditor1.audit(
				'user.created',
				{ userId: 1, email: 'user1@example.com' },
				{ entityId: '1', table: 'users' },
			);
			auditor1.audit(
				'user.updated',
				{ userId: 1, changes: ['name'] },
				{ entityId: '1', table: 'users' },
			);
			auditor2.audit(
				'user.deleted',
				{ userId: 2 },
				{ entityId: '2', table: 'users' },
			);

			await auditor1.flush();
			await auditor2.flush();
		});

		it('should query all records', async () => {
			const records = await storage.query({});

			expect(records).toHaveLength(3);
		});

		it('should filter by type', async () => {
			const records = await storage.query({ type: 'user.created' });

			expect(records).toHaveLength(1);
			expect(records[0].type).toBe('user.created');
		});

		it('should filter by multiple types', async () => {
			const records = await storage.query({
				type: ['user.created', 'user.updated'],
			});

			expect(records).toHaveLength(2);
		});

		it('should filter by actorId', async () => {
			const records = await storage.query({ actorId: 'admin-1' });

			expect(records).toHaveLength(1);
			expect(records[0].type).toBe('user.deleted');
		});

		it('should filter by entityId', async () => {
			const records = await storage.query({ entityId: '1' });

			expect(records).toHaveLength(2);
		});

		it('should filter by table', async () => {
			const records = await storage.query({ table: 'users' });

			expect(records).toHaveLength(3);
		});

		it('should filter by date range', async () => {
			const past = new Date(Date.now() - 60_000);
			const future = new Date(Date.now() + 60_000);

			expect(await storage.query({ from: past, to: future })).toHaveLength(3);
			expect(await storage.query({ from: future })).toHaveLength(0);
			expect(await storage.query({ to: past })).toHaveLength(0);
		});

		it('should round-trip payload, actor and metadata', async () => {
			const records = await storage.query({ type: 'user.created' });

			expect(records[0].payload).toEqual({
				userId: 1,
				email: 'user1@example.com',
			});
			expect(records[0].actor).toEqual({ id: 'user-1', type: 'user' });
			expect(records[0].metadata).toEqual({ endpoint: '/users' });
		});

		it('should apply pagination', async () => {
			const page1 = await storage.query({ limit: 2, offset: 0 });
			const page2 = await storage.query({ limit: 2, offset: 2 });

			expect(page1).toHaveLength(2);
			expect(page2).toHaveLength(1);
		});

		it('should order by timestamp descending by default', async () => {
			const records = await storage.query({});

			// Records should be in descending order (newest first)
			for (let i = 1; i < records.length; i++) {
				expect(records[i - 1].timestamp.getTime()).toBeGreaterThanOrEqual(
					records[i].timestamp.getTime(),
				);
			}
		});

		it('should order by type ascending', async () => {
			const records = await storage.query({
				orderBy: 'type',
				orderDirection: 'asc',
			});

			const types = records.map((r) => r.type);
			expect(types).toEqual([...types].sort());
		});
	});

	describe('count', () => {
		beforeEach(async () => {
			const auditor = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'user-1', type: 'user' },
				storage,
			});

			auditor.audit('user.created', { userId: 1, email: 'user1@example.com' });
			auditor.audit('user.created', { userId: 2, email: 'user2@example.com' });
			auditor.audit('user.updated', { userId: 1, changes: ['name'] });

			await auditor.flush();
		});

		it('should count all records', async () => {
			const count = await storage.count({});

			expect(count).toBe(3);
		});

		it('should count with type filter', async () => {
			const count = await storage.count({ type: 'user.created' });

			expect(count).toBe(2);
		});

		it('should count with multiple type filter', async () => {
			const count = await storage.count({
				type: ['user.created', 'user.updated'],
			});

			expect(count).toBe(3);
		});

		it('should count with actorId filter', async () => {
			const count = await storage.count({ actorId: 'user-1' });

			expect(count).toBe(3);
		});
	});
});
