import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuditLogTable, KyselyAuditStorage } from '../kysely';
import type { AuditRecord } from '../types';

// Mock Kysely database
function createMockDb() {
	const rows: AuditLogTable[] = [];

	const insertBuilder = {
		values: vi.fn().mockReturnThis(),
		execute: vi.fn(async () => {
			return [];
		}),
	};

	const selectBuilder = {
		selectAll: vi.fn().mockReturnThis(),
		select: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		orderBy: vi.fn().mockReturnThis(),
		limit: vi.fn().mockReturnThis(),
		offset: vi.fn().mockReturnThis(),
		execute: vi.fn(async () => rows),
		executeTakeFirst: vi.fn(async () => ({ count: rows.length })),
	};

	const db = {
		insertInto: vi.fn(() => insertBuilder),
		selectFrom: vi.fn(() => selectBuilder),
	};

	return {
		db,
		insertBuilder,
		selectBuilder,
		rows,
		addRow: (row: AuditLogTable) => rows.push(row),
	};
}

describe('KyselyAuditStorage', () => {
	let mockDb: ReturnType<typeof createMockDb>;
	let storage: KyselyAuditStorage<{ audit_logs: AuditLogTable }>;

	beforeEach(() => {
		mockDb = createMockDb();
		storage = new KyselyAuditStorage({
			db: mockDb.db as any,
			tableName: 'audit_logs',
		});
	});

	describe('write', () => {
		it('should write records to database', async () => {
			const records: AuditRecord[] = [
				{
					id: 'audit-1',
					type: 'user.created',
					operation: 'INSERT',
					table: 'users',
					entityId: 'user-123',
					payload: { email: 'test@example.com' },
					timestamp: new Date('2024-01-01T00:00:00Z'),
					actor: { id: 'admin-1', type: 'admin' },
					metadata: { requestId: 'req-123' },
				},
			];

			await storage.write(records);

			expect(mockDb.db.insertInto).toHaveBeenCalledWith('audit_logs');
			expect(mockDb.insertBuilder.values).toHaveBeenCalledWith([
				expect.objectContaining({
					id: 'audit-1',
					type: 'user.created',
					operation: 'INSERT',
					table: 'users',
					entityId: 'user-123',
					payload: { email: 'test@example.com' },
					actorId: 'admin-1',
					actorType: 'admin',
					metadata: { requestId: 'req-123' },
				}),
			]);
		});

		it('should use transaction when provided', async () => {
			const mockTrx = {
				insertInto: vi.fn(() => ({
					values: vi.fn().mockReturnThis(),
					execute: vi.fn(),
				})),
			};

			const records: AuditRecord[] = [
				{
					id: 'audit-1',
					type: 'user.created',
					operation: 'CUSTOM',
					timestamp: new Date(),
				},
			];

			await storage.write(records, mockTrx);

			expect(mockTrx.insertInto).toHaveBeenCalledWith('audit_logs');
			expect(mockDb.db.insertInto).not.toHaveBeenCalled();
		});

		it('should do nothing for empty records', async () => {
			await storage.write([]);

			expect(mockDb.db.insertInto).not.toHaveBeenCalled();
		});

		it('should handle complex entity IDs', async () => {
			const records: AuditRecord[] = [
				{
					id: 'audit-1',
					type: 'relation.created',
					operation: 'INSERT',
					entityId: { userId: 'u1', roleId: 'r1' },
					timestamp: new Date(),
				},
			];

			await storage.write(records);

			expect(mockDb.insertBuilder.values).toHaveBeenCalledWith([
				expect.objectContaining({
					entityId: JSON.stringify({ userId: 'u1', roleId: 'r1' }),
				}),
			]);
		});

		it('should store extra actor properties', async () => {
			const records: AuditRecord[] = [
				{
					id: 'audit-1',
					type: 'user.created',
					operation: 'CUSTOM',
					timestamp: new Date(),
					actor: {
						id: 'user-1',
						type: 'user',
						email: 'user@example.com',
						role: 'admin',
					},
				},
			];

			await storage.write(records);

			expect(mockDb.insertBuilder.values).toHaveBeenCalledWith([
				expect.objectContaining({
					actorId: 'user-1',
					actorType: 'user',
					actorData: {
						email: 'user@example.com',
						role: 'admin',
					},
				}),
			]);
		});

		it('should generate ID with nanoid when autoId is false (default)', async () => {
			const records: AuditRecord[] = [
				{
					id: '', // Empty ID
					type: 'user.created',
					operation: 'CUSTOM',
					timestamp: new Date(),
				},
			];

			await storage.write(records);

			const calledValues = mockDb.insertBuilder.values.mock.calls[0][0];
			expect(calledValues[0].id).toBeDefined();
			expect(calledValues[0].id.length).toBeGreaterThan(0);
		});

		it('should use provided ID when autoId is false (default)', async () => {
			const records: AuditRecord[] = [
				{
					id: 'my-custom-id',
					type: 'user.created',
					operation: 'CUSTOM',
					timestamp: new Date(),
				},
			];

			await storage.write(records);

			expect(mockDb.insertBuilder.values).toHaveBeenCalledWith([
				expect.objectContaining({
					id: 'my-custom-id',
				}),
			]);
		});

		it('should omit ID when autoId is true and no ID provided', async () => {
			const storageAutoId = new KyselyAuditStorage({
				db: mockDb.db as any,
				tableName: 'audit_logs',
				autoId: true,
			});

			const records: AuditRecord[] = [
				{
					id: '', // Empty ID - let database generate
					type: 'user.created',
					operation: 'CUSTOM',
					timestamp: new Date(),
				},
			];

			await storageAutoId.write(records);

			const calledValues = mockDb.insertBuilder.values.mock.calls[0][0];
			expect(calledValues[0].id).toBeUndefined();
		});

		it('should omit ID even if provided when autoId is true', async () => {
			const storageAutoId = new KyselyAuditStorage({
				db: mockDb.db as any,
				tableName: 'audit_logs',
				autoId: true,
			});

			const records: AuditRecord[] = [
				{
					id: 'explicit-id', // This should be ignored when autoId is true
					type: 'user.created',
					operation: 'CUSTOM',
					timestamp: new Date(),
				},
			];

			await storageAutoId.write(records);

			// When autoId is true, ID should always be omitted (let database generate)
			const calledValues = mockDb.insertBuilder.values.mock.calls[0][0];
			expect(calledValues[0].id).toBeUndefined();
		});
	});

	describe('query', () => {
		it('should return records from database', async () => {
			mockDb.addRow({
				id: 'audit-1',
				type: 'user.created',
				operation: 'INSERT',
				table: 'users',
				entityId: 'user-123',
				oldValues: null,
				newValues: JSON.stringify({ name: 'Test' }),
				payload: JSON.stringify({ email: 'test@example.com' }),
				timestamp: new Date('2024-01-01T00:00:00Z'),
				actorId: 'admin-1',
				actorType: 'admin',
				actorData: null,
				metadata: JSON.stringify({ requestId: 'req-123' }),
			});

			const results = await storage.query({});

			expect(results).toHaveLength(1);
			expect(results[0]).toMatchObject({
				id: 'audit-1',
				type: 'user.created',
				operation: 'INSERT',
				table: 'users',
				entityId: 'user-123',
				newValues: { name: 'Test' },
				payload: { email: 'test@example.com' },
				actor: { id: 'admin-1', type: 'admin' },
				metadata: { requestId: 'req-123' },
			});
		});

		it('should apply type filter', async () => {
			await storage.query({ type: 'user.created' });

			expect(mockDb.selectBuilder.where).toHaveBeenCalledWith(
				'type',
				'=',
				'user.created',
			);
		});

		it('should apply type array filter', async () => {
			await storage.query({ type: ['user.created', 'user.updated'] });

			expect(mockDb.selectBuilder.where).toHaveBeenCalledWith('type', 'in', [
				'user.created',
				'user.updated',
			]);
		});

		it('should apply entity ID filter', async () => {
			await storage.query({ entityId: 'user-123' });

			expect(mockDb.selectBuilder.where).toHaveBeenCalledWith(
				'entityId',
				'=',
				'user-123',
			);
		});

		it('should apply table filter', async () => {
			await storage.query({ table: 'users' });

			expect(mockDb.selectBuilder.where).toHaveBeenCalledWith(
				'table',
				'=',
				'users',
			);
		});

		it('should apply actor ID filter', async () => {
			await storage.query({ actorId: 'admin-1' });

			expect(mockDb.selectBuilder.where).toHaveBeenCalledWith(
				'actorId',
				'=',
				'admin-1',
			);
		});

		it('should apply date range filters', async () => {
			const from = new Date('2024-01-01');
			const to = new Date('2024-12-31');

			await storage.query({ from, to });

			expect(mockDb.selectBuilder.where).toHaveBeenCalledWith(
				'timestamp',
				'>=',
				from,
			);
			expect(mockDb.selectBuilder.where).toHaveBeenCalledWith(
				'timestamp',
				'<=',
				to,
			);
		});

		it('should apply pagination', async () => {
			await storage.query({ limit: 10, offset: 20 });

			expect(mockDb.selectBuilder.limit).toHaveBeenCalledWith(10);
			expect(mockDb.selectBuilder.offset).toHaveBeenCalledWith(20);
		});

		it('should apply ordering', async () => {
			await storage.query({ orderBy: 'type', orderDirection: 'asc' });

			expect(mockDb.selectBuilder.orderBy).toHaveBeenCalledWith('type', 'asc');
		});

		it('should default to timestamp desc ordering', async () => {
			await storage.query({});

			expect(mockDb.selectBuilder.orderBy).toHaveBeenCalledWith(
				'timestamp',
				'desc',
			);
		});

		it('should parse complex entity IDs', async () => {
			mockDb.addRow({
				id: 'audit-1',
				type: 'relation.created',
				operation: 'INSERT',
				table: null,
				entityId: JSON.stringify({ userId: 'u1', roleId: 'r1' }),
				oldValues: null,
				newValues: null,
				payload: null,
				timestamp: new Date(),
				actorId: null,
				actorType: null,
				actorData: null,
				metadata: null,
			});

			const results = await storage.query({});

			expect(results[0].entityId).toEqual({ userId: 'u1', roleId: 'r1' });
		});

		it('should merge actor data', async () => {
			mockDb.addRow({
				id: 'audit-1',
				type: 'user.created',
				operation: 'CUSTOM',
				table: null,
				entityId: null,
				oldValues: null,
				newValues: null,
				payload: null,
				timestamp: new Date(),
				actorId: 'user-1',
				actorType: 'user',
				actorData: JSON.stringify({ email: 'user@example.com' }),
				metadata: null,
			});

			const results = await storage.query({});

			expect(results[0].actor).toEqual({
				id: 'user-1',
				type: 'user',
				email: 'user@example.com',
			});
		});
	});

	describe('count', () => {
		it('should return count from database', async () => {
			const count = await storage.count({});

			expect(count).toBe(0);
			expect(mockDb.selectBuilder.select).toHaveBeenCalled();
		});

		it('should apply filters to count', async () => {
			await storage.count({ type: 'user.created', actorId: 'admin-1' });

			expect(mockDb.selectBuilder.where).toHaveBeenCalledWith(
				'type',
				'=',
				'user.created',
			);
			expect(mockDb.selectBuilder.where).toHaveBeenCalledWith(
				'actorId',
				'=',
				'admin-1',
			);
		});
	});
});
