import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExceptionEntry, LogEntry, RequestEntry } from '../../types';
import {
	getTelescopeMigration,
	KyselyStorage,
	type TelescopeExceptionTable,
	type TelescopeLogTable,
	type TelescopeRequestTable,
} from '../kysely';

// Helper to create mock query builder
function createMockQueryBuilder() {
	const builder: Record<string, any> = {};

	// Chain methods return the builder itself
	builder.withSchema = vi.fn().mockReturnValue(builder);
	builder.selectFrom = vi.fn().mockReturnValue(builder);
	builder.insertInto = vi.fn().mockReturnValue(builder);
	builder.deleteFrom = vi.fn().mockReturnValue(builder);
	builder.selectAll = vi.fn().mockReturnValue(builder);
	builder.select = vi.fn().mockReturnValue(builder);
	builder.values = vi.fn().mockReturnValue(builder);
	builder.where = vi.fn().mockReturnValue(builder);
	builder.orderBy = vi.fn().mockReturnValue(builder);
	builder.limit = vi.fn().mockReturnValue(builder);
	builder.offset = vi.fn().mockReturnValue(builder);
	builder.or = vi.fn().mockReturnValue(builder);

	// Terminal methods
	builder.execute = vi.fn().mockResolvedValue([]);
	builder.executeTakeFirst = vi.fn().mockResolvedValue(undefined);

	return builder;
}

describe('KyselyStorage', () => {
	let mockDb: ReturnType<typeof createMockQueryBuilder>;
	let storage: KyselyStorage<any>;

	beforeEach(() => {
		mockDb = createMockQueryBuilder();
		storage = new KyselyStorage({ db: mockDb as any });
	});

	// ============================================
	// Requests
	// ============================================

	describe('saveRequest', () => {
		it('should insert a request into the database', async () => {
			const entry: RequestEntry = {
				id: 'req-123',
				method: 'GET',
				path: '/api/users',
				url: 'http://localhost/api/users',
				headers: { 'content-type': 'application/json' },
				query: { page: '1' },
				status: 200,
				responseHeaders: { 'content-type': 'application/json' },
				responseBody: { users: [] },
				duration: 50,
				timestamp: new Date('2024-01-01T00:00:00Z'),
				ip: '127.0.0.1',
				userId: 'user-1',
				tags: ['api'],
			};

			await storage.saveRequest(entry);

			expect(mockDb.insertInto).toHaveBeenCalledWith('requests');
			expect(mockDb.values).toHaveBeenCalledWith({
				id: 'req-123',
				method: 'GET',
				path: '/api/users',
				url: 'http://localhost/api/users',
				headers: { 'content-type': 'application/json' },
				query: { page: '1' },
				body: null,
				status: 200,
				response_headers: { 'content-type': 'application/json' },
				response_body: { users: [] },
				duration: 50,
				timestamp: entry.timestamp,
				ip: '127.0.0.1',
				user_id: 'user-1',
				tags: ['api'],
			});
			expect(mockDb.execute).toHaveBeenCalled();
		});

		it('should handle optional fields as null', async () => {
			const entry: RequestEntry = {
				id: 'req-456',
				method: 'POST',
				path: '/api/test',
				url: 'http://localhost/api/test',
				headers: {},
				status: 201,
				responseHeaders: {},
				duration: 10,
				timestamp: new Date(),
			};

			await storage.saveRequest(entry);

			expect(mockDb.values).toHaveBeenCalledWith(
				expect.objectContaining({
					body: null,
					query: null,
					response_body: null,
					ip: null,
					user_id: null,
					tags: null,
				}),
			);
		});
	});

	describe('saveRequests', () => {
		it('should batch insert multiple requests', async () => {
			const entries: RequestEntry[] = [
				{
					id: 'req-1',
					method: 'GET',
					path: '/1',
					url: 'http://localhost/1',
					headers: {},
					status: 200,
					responseHeaders: {},
					duration: 10,
					timestamp: new Date(),
				},
				{
					id: 'req-2',
					method: 'GET',
					path: '/2',
					url: 'http://localhost/2',
					headers: {},
					status: 200,
					responseHeaders: {},
					duration: 20,
					timestamp: new Date(),
				},
			];

			await storage.saveRequests(entries);

			expect(mockDb.insertInto).toHaveBeenCalledWith('requests');
			expect(mockDb.values).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({ id: 'req-1' }),
					expect.objectContaining({ id: 'req-2' }),
				]),
			);
		});

		it('should not insert when entries array is empty', async () => {
			await storage.saveRequests([]);

			expect(mockDb.insertInto).not.toHaveBeenCalled();
		});
	});

	describe('getRequests', () => {
		it('should query requests with default limit', async () => {
			const mockRows: TelescopeRequestTable[] = [
				{
					id: 'req-1',
					method: 'GET',
					path: '/api/test',
					url: 'http://localhost/api/test',
					headers: { 'content-type': 'application/json' },
					body: null,
					query: null,
					status: 200,
					response_headers: {},
					response_body: null,
					duration: 10,
					timestamp: new Date('2024-01-01'),
					ip: null,
					user_id: null,
					tags: null,
				},
			];

			mockDb.execute.mockResolvedValueOnce(mockRows);

			const result = await storage.getRequests();

			expect(mockDb.selectFrom).toHaveBeenCalledWith('requests');
			expect(mockDb.selectAll).toHaveBeenCalled();
			expect(mockDb.orderBy).toHaveBeenCalledWith('timestamp', 'desc');
			expect(mockDb.limit).toHaveBeenCalledWith(50);

			expect(result).toHaveLength(1);
			expect(result[0].id).toBe('req-1');
			expect(result[0].headers).toEqual({ 'content-type': 'application/json' });
		});

		it('should apply query options', async () => {
			mockDb.execute.mockResolvedValueOnce([]);

			await storage.getRequests({
				limit: 10,
				offset: 5,
				after: new Date('2024-01-01'),
				before: new Date('2024-12-31'),
			});

			expect(mockDb.where).toHaveBeenCalledWith(
				'timestamp',
				'>=',
				expect.any(Date),
			);
			expect(mockDb.where).toHaveBeenCalledWith(
				'timestamp',
				'<=',
				expect.any(Date),
			);
			expect(mockDb.limit).toHaveBeenCalledWith(10);
			expect(mockDb.offset).toHaveBeenCalledWith(5);
		});
	});

	describe('getRequest', () => {
		it('should return a single request by ID', async () => {
			const mockRow: TelescopeRequestTable = {
				id: 'req-123',
				method: 'GET',
				path: '/api/test',
				url: 'http://localhost/api/test',
				headers: {},
				body: null,
				query: null,
				status: 200,
				response_headers: {},
				response_body: null,
				duration: 10,
				timestamp: new Date('2024-01-01'),
				ip: '127.0.0.1',
				user_id: 'user-1',
				tags: ['test'],
			};

			mockDb.executeTakeFirst.mockResolvedValueOnce(mockRow);

			const result = await storage.getRequest('req-123');

			expect(mockDb.selectFrom).toHaveBeenCalledWith('requests');
			expect(mockDb.where).toHaveBeenCalledWith('id', '=', 'req-123');
			expect(result).not.toBeNull();
			expect(result?.id).toBe('req-123');
			expect(result?.ip).toBe('127.0.0.1');
			expect(result?.userId).toBe('user-1');
			expect(result?.tags).toEqual(['test']);
		});

		it('should return null when request not found', async () => {
			mockDb.executeTakeFirst.mockResolvedValueOnce(undefined);

			const result = await storage.getRequest('non-existent');

			expect(result).toBeNull();
		});
	});

	// ============================================
	// Exceptions
	// ============================================

	describe('saveException', () => {
		it('should insert an exception into the database', async () => {
			const entry: ExceptionEntry = {
				id: 'exc-123',
				name: 'Error',
				message: 'Something went wrong',
				stack: [{ file: 'test.ts', line: 10, column: 5, function: 'test' }],
				source: { file: 'test.ts', line: 10, code: 'throw new Error()' },
				requestId: 'req-1',
				timestamp: new Date('2024-01-01'),
				handled: false,
				tags: ['critical'],
			};

			await storage.saveException(entry);

			expect(mockDb.insertInto).toHaveBeenCalledWith('exceptions');
			expect(mockDb.values).toHaveBeenCalledWith({
				id: 'exc-123',
				name: 'Error',
				message: 'Something went wrong',
				stack: entry.stack,
				source: entry.source,
				request_id: 'req-1',
				timestamp: entry.timestamp,
				handled: false,
				tags: ['critical'],
			});
		});
	});

	describe('saveExceptions', () => {
		it('should batch insert multiple exceptions', async () => {
			const entries: ExceptionEntry[] = [
				{
					id: 'exc-1',
					name: 'Error',
					message: 'First error',
					stack: [],
					timestamp: new Date(),
					handled: true,
				},
				{
					id: 'exc-2',
					name: 'TypeError',
					message: 'Second error',
					stack: [],
					timestamp: new Date(),
					handled: false,
				},
			];

			await storage.saveExceptions(entries);

			expect(mockDb.values).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({ id: 'exc-1', name: 'Error' }),
					expect.objectContaining({ id: 'exc-2', name: 'TypeError' }),
				]),
			);
		});

		it('should not insert when entries array is empty', async () => {
			await storage.saveExceptions([]);

			expect(mockDb.insertInto).not.toHaveBeenCalled();
		});
	});

	describe('getExceptions', () => {
		it('should query exceptions with default limit', async () => {
			const mockRows: TelescopeExceptionTable[] = [
				{
					id: 'exc-1',
					name: 'Error',
					message: 'Test error',
					stack: [{ file: 'test.ts', line: 1 }],
					source: null,
					request_id: 'req-1',
					timestamp: new Date(),
					handled: false,
					tags: null,
				},
			];

			mockDb.execute.mockResolvedValueOnce(mockRows);

			const result = await storage.getExceptions();

			expect(mockDb.selectFrom).toHaveBeenCalledWith('exceptions');
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe('Error');
			expect(result[0].requestId).toBe('req-1');
		});
	});

	describe('getException', () => {
		it('should return a single exception by ID', async () => {
			const mockRow: TelescopeExceptionTable = {
				id: 'exc-123',
				name: 'Error',
				message: 'Test',
				stack: [],
				source: null,
				request_id: null,
				timestamp: new Date(),
				handled: true,
				tags: null,
			};

			mockDb.executeTakeFirst.mockResolvedValueOnce(mockRow);

			const result = await storage.getException('exc-123');

			expect(result).not.toBeNull();
			expect(result?.handled).toBe(true);
		});

		it('should return null when exception not found', async () => {
			mockDb.executeTakeFirst.mockResolvedValueOnce(undefined);

			const result = await storage.getException('non-existent');

			expect(result).toBeNull();
		});
	});

	// ============================================
	// Logs
	// ============================================

	describe('saveLog', () => {
		it('should insert a log into the database', async () => {
			const entry: LogEntry = {
				id: 'log-123',
				level: 'info',
				message: 'User logged in',
				context: { userId: '123' },
				requestId: 'req-1',
				timestamp: new Date('2024-01-01'),
			};

			await storage.saveLog(entry);

			expect(mockDb.insertInto).toHaveBeenCalledWith('logs');
			expect(mockDb.values).toHaveBeenCalledWith({
				id: 'log-123',
				level: 'info',
				message: 'User logged in',
				context: { userId: '123' },
				request_id: 'req-1',
				timestamp: entry.timestamp,
			});
		});
	});

	describe('saveLogs', () => {
		it('should batch insert multiple logs', async () => {
			const entries: LogEntry[] = [
				{
					id: 'log-1',
					level: 'debug',
					message: 'Debug message',
					timestamp: new Date(),
				},
				{
					id: 'log-2',
					level: 'error',
					message: 'Error message',
					timestamp: new Date(),
				},
			];

			await storage.saveLogs(entries);

			expect(mockDb.values).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({ id: 'log-1', level: 'debug' }),
					expect.objectContaining({ id: 'log-2', level: 'error' }),
				]),
			);
		});

		it('should not insert when entries array is empty', async () => {
			await storage.saveLogs([]);

			expect(mockDb.insertInto).not.toHaveBeenCalled();
		});
	});

	describe('getLogs', () => {
		it('should query logs with default limit', async () => {
			const mockRows: TelescopeLogTable[] = [
				{
					id: 'log-1',
					level: 'info',
					message: 'Test message',
					context: { key: 'value' },
					request_id: null,
					timestamp: new Date(),
				},
			];

			mockDb.execute.mockResolvedValueOnce(mockRows);

			const result = await storage.getLogs();

			expect(mockDb.selectFrom).toHaveBeenCalledWith('logs');
			expect(result).toHaveLength(1);
			expect(result[0].level).toBe('info');
			expect(result[0].context).toEqual({ key: 'value' });
		});
	});

	// ============================================
	// Prune
	// ============================================

	describe('prune', () => {
		it('should delete old entries from all tables', async () => {
			const olderThan = new Date('2024-01-01');

			mockDb.executeTakeFirst
				.mockResolvedValueOnce({ numDeletedRows: BigInt(5) })
				.mockResolvedValueOnce({ numDeletedRows: BigInt(2) })
				.mockResolvedValueOnce({ numDeletedRows: BigInt(10) });

			const deleted = await storage.prune(olderThan);

			expect(mockDb.deleteFrom).toHaveBeenCalledWith('requests');
			expect(mockDb.deleteFrom).toHaveBeenCalledWith('exceptions');
			expect(mockDb.deleteFrom).toHaveBeenCalledWith('logs');
			expect(mockDb.where).toHaveBeenCalledWith('timestamp', '<', olderThan);
			expect(deleted).toBe(17);
		});

		it('should return 0 when no entries deleted', async () => {
			mockDb.executeTakeFirst
				.mockResolvedValueOnce({ numDeletedRows: BigInt(0) })
				.mockResolvedValueOnce({ numDeletedRows: BigInt(0) })
				.mockResolvedValueOnce({ numDeletedRows: BigInt(0) });

			const deleted = await storage.prune(new Date());

			expect(deleted).toBe(0);
		});
	});

	// ============================================
	// Stats
	// ============================================

	describe('getStats', () => {
		it('should aggregate statistics from all tables', async () => {
			const now = new Date();
			const earlier = new Date(now.getTime() - 3600000);

			mockDb.executeTakeFirst
				.mockResolvedValueOnce({
					count: BigInt(100),
					oldest: earlier,
					newest: now,
				})
				.mockResolvedValueOnce({
					count: BigInt(5),
					oldest: earlier,
					newest: now,
				})
				.mockResolvedValueOnce({
					count: BigInt(50),
					oldest: earlier,
					newest: now,
				});

			const stats = await storage.getStats();

			expect(stats.requests).toBe(100);
			expect(stats.exceptions).toBe(5);
			expect(stats.logs).toBe(50);
			expect(stats.oldestEntry).toEqual(earlier);
			expect(stats.newestEntry).toEqual(now);
		});

		it('should handle empty tables', async () => {
			mockDb.executeTakeFirst
				.mockResolvedValueOnce({ count: BigInt(0), oldest: null, newest: null })
				.mockResolvedValueOnce({ count: BigInt(0), oldest: null, newest: null })
				.mockResolvedValueOnce({
					count: BigInt(0),
					oldest: null,
					newest: null,
				});

			const stats = await storage.getStats();

			expect(stats.requests).toBe(0);
			expect(stats.exceptions).toBe(0);
			expect(stats.logs).toBe(0);
			expect(stats.oldestEntry).toBeUndefined();
			expect(stats.newestEntry).toBeUndefined();
		});
	});

	// ============================================
	// Schema
	// ============================================

	describe('schema', () => {
		it('names its tables unqualified, for the search_path to place', async () => {
			// The tables were `telescope_requests` and friends — a prefix, which is
			// what you reach for when they have to share a schema with an
			// application's own. A telescope derived from a database gets its own,
			// and a role pinned to it, so the name is just the name.
			await storage.saveRequest({
				id: 'req-1',
				method: 'GET',
				path: '/test',
				url: 'http://localhost/test',
				headers: {},
				status: 200,
				responseHeaders: {},
				duration: 10,
				timestamp: new Date(),
			});

			expect(mockDb.insertInto).toHaveBeenCalledWith('requests');
			expect(mockDb.withSchema).not.toHaveBeenCalled();
		});

		it('qualifies them when the connection is not pinned to one', async () => {
			const scoped = new KyselyStorage({
				db: mockDb as any,
				schema: 'telescope',
			});

			await scoped.saveRequest({
				id: 'req-1',
				method: 'GET',
				path: '/test',
				url: 'http://localhost/test',
				headers: {},
				status: 200,
				responseHeaders: {},
				duration: 10,
				timestamp: new Date(),
			});

			expect(mockDb.withSchema).toHaveBeenCalledWith('telescope');
		});
	});

	// ============================================
	// JSON Parsing
	// ============================================

	describe('JSON parsing', () => {
		it('should parse JSON strings from database', async () => {
			const mockRow: TelescopeRequestTable = {
				id: 'req-1',
				method: 'GET',
				path: '/test',
				url: 'http://localhost/test',
				headers: '{"content-type":"application/json"}' as unknown as unknown,
				body: null,
				query: '{"page":"1"}' as unknown as unknown,
				status: 200,
				response_headers: '{}' as unknown as unknown,
				response_body: null,
				duration: 10,
				timestamp: new Date(),
				ip: null,
				user_id: null,
				tags: '["api"]' as unknown as unknown,
			};

			mockDb.executeTakeFirst.mockResolvedValueOnce(mockRow);

			const result = await storage.getRequest('req-1');

			expect(result?.headers).toEqual({ 'content-type': 'application/json' });
			expect(result?.query).toEqual({ page: '1' });
			expect(result?.tags).toEqual(['api']);
		});

		it('should handle already-parsed JSON objects from JSONB columns', async () => {
			const mockRow: TelescopeRequestTable = {
				id: 'req-1',
				method: 'GET',
				path: '/test',
				url: 'http://localhost/test',
				headers: { 'content-type': 'application/json' },
				body: null,
				query: { page: '1' },
				status: 200,
				response_headers: {},
				response_body: null,
				duration: 10,
				timestamp: new Date(),
				ip: null,
				user_id: null,
				tags: ['api'],
			};

			mockDb.executeTakeFirst.mockResolvedValueOnce(mockRow);

			const result = await storage.getRequest('req-1');

			expect(result?.headers).toEqual({ 'content-type': 'application/json' });
			expect(result?.query).toEqual({ page: '1' });
			expect(result?.tags).toEqual(['api']);
		});
	});
});

describe('getTelescopeMigration', () => {
	it('names its tables unqualified, for the search_path to place', () => {
		const migration = getTelescopeMigration();

		expect(migration.up).toContain('CREATE TABLE IF NOT EXISTS requests');
		expect(migration.up).toContain('CREATE TABLE IF NOT EXISTS exceptions');
		expect(migration.up).toContain('CREATE TABLE IF NOT EXISTS logs');
		expect(migration.up).toContain('CREATE INDEX IF NOT EXISTS');
		expect(migration.up).not.toContain('CREATE SCHEMA');
		expect(migration.down).toContain('DROP TABLE IF EXISTS logs');
		expect(migration.down).toContain('DROP TABLE IF EXISTS exceptions');
		expect(migration.down).toContain('DROP TABLE IF EXISTS requests');
	});

	it('creates the schema, and drops it whole, when given one', () => {
		// A tenant drops as a tenant: three `DROP TABLE`s leave the schema behind
		// and leave anything added to it since orphaned.
		const migration = getTelescopeMigration('debug');

		expect(migration.up).toContain('CREATE SCHEMA IF NOT EXISTS debug');
		expect(migration.up).toContain('CREATE TABLE IF NOT EXISTS debug.requests');
		expect(migration.up).toContain(
			'CREATE TABLE IF NOT EXISTS debug.exceptions',
		);
		expect(migration.up).toContain('CREATE TABLE IF NOT EXISTS debug.logs');
		expect(migration.up).toContain('idx_debug_requests_timestamp');
		expect(migration.down).toContain('DROP SCHEMA IF EXISTS debug CASCADE');
	});

	it('should include proper PostgreSQL column types', () => {
		const migration = getTelescopeMigration();

		expect(migration.up).toContain('JSONB');
		expect(migration.up).toContain('TIMESTAMPTZ');
		expect(migration.up).toContain('DOUBLE PRECISION');
		expect(migration.up).toContain('BOOLEAN');
	});

	it('should include indexes for common queries', () => {
		const migration = getTelescopeMigration();

		expect(migration.up).toContain('idx_requests_timestamp');
		expect(migration.up).toContain('idx_requests_path');
		expect(migration.up).toContain('idx_requests_status');
		expect(migration.up).toContain('idx_exceptions_timestamp');
		expect(migration.up).toContain('idx_exceptions_request_id');
		expect(migration.up).toContain('idx_logs_timestamp');
		expect(migration.up).toContain('idx_logs_level');
		expect(migration.up).toContain('idx_logs_request_id');
	});
});
