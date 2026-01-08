import { InMemoryStorage } from '@geekmidas/telescope';
import { CamelCasePlugin, type Generated, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_DATABASE_CONFIG } from '../../../testkit/test/globalSetup';
import { Direction } from '../types';
import { Studio } from '../Studio';

interface TestDatabase {
	studioTestUsers: {
		id: Generated<number>;
		name: string;
		email: string;
	};
}

describe('Studio', () => {
	let db: Kysely<TestDatabase>;
	let studio: Studio<TestDatabase>;
	let storage: InMemoryStorage;

	beforeAll(async () => {
		db = new Kysely<TestDatabase>({
			dialect: new PostgresDialect({
				pool: new pg.Pool({
					...TEST_DATABASE_CONFIG,
					database: 'postgres',
				}),
			}),
			plugins: [new CamelCasePlugin()],
		});

		// Create test table
		await db.schema
			.createTable('studio_test_users')
			.ifNotExists()
			.addColumn('id', 'serial', (col) => col.primaryKey())
			.addColumn('name', 'varchar(255)', (col) => col.notNull())
			.addColumn('email', 'varchar(255)', (col) => col.notNull())
			.execute();
	});

	beforeEach(() => {
		storage = new InMemoryStorage();
		studio = new Studio({
			monitoring: {
				storage,
			},
			data: {
				db,
				cursor: { field: 'id', direction: Direction.Desc },
			},
		});
	});

	afterEach(async () => {
		studio.destroy();
		await db.deleteFrom('studioTestUsers').execute();
	});

	afterAll(async () => {
		await db.schema.dropTable('studio_test_users').ifExists().execute();
		await db.destroy();
	});

	describe('configuration', () => {
		it('should expose path property with default value', () => {
			expect(studio.path).toBe('/__studio');
		});

		it('should allow custom path', () => {
			const customStudio = new Studio({
				monitoring: { storage },
				data: { db, cursor: { field: 'id', direction: Direction.Desc } },
				path: '/custom-studio',
			});
			expect(customStudio.path).toBe('/custom-studio');
			customStudio.destroy();
		});

		it('should expose enabled property', () => {
			expect(studio.enabled).toBe(true);
		});

		it('should allow disabling studio', () => {
			const disabledStudio = new Studio({
				monitoring: { storage },
				data: { db, cursor: { field: 'id', direction: Direction.Desc } },
				enabled: false,
			});
			expect(disabledStudio.enabled).toBe(false);
			disabledStudio.destroy();
		});

		it('should expose recordBody property', () => {
			expect(studio.recordBody).toBe(true);
		});

		it('should expose maxBodySize property', () => {
			expect(studio.maxBodySize).toBe(64 * 1024); // 64KB default
		});

		it('should expose data browser instance', () => {
			expect(studio.data).toBeDefined();
		});
	});

	describe('monitoring - recording', () => {
		it('should record requests', async () => {
			const requestId = await studio.recordRequest({
				method: 'GET',
				path: '/api/users',
				status: 200,
				duration: 100,
			});

			expect(requestId).toBeDefined();
			expect(typeof requestId).toBe('string');
		});

		it('should record log entries in batch', async () => {
			await studio.log([
				{ level: 'info', message: 'Test log 1' },
				{ level: 'error', message: 'Test log 2' },
			]);

			const logs = await studio.getLogs();
			expect(logs.length).toBeGreaterThanOrEqual(2);
		});

		it('should log debug messages', async () => {
			await studio.debug('Debug message', { foo: 'bar' });

			const logs = await studio.getLogs({ level: 'debug' });
			expect(logs.some((l) => l.message === 'Debug message')).toBe(true);
		});

		it('should log info messages', async () => {
			await studio.info('Info message', { key: 'value' });

			const logs = await studio.getLogs({ level: 'info' });
			expect(logs.some((l) => l.message === 'Info message')).toBe(true);
		});

		it('should log warning messages', async () => {
			await studio.warn('Warning message');

			const logs = await studio.getLogs({ level: 'warn' });
			expect(logs.some((l) => l.message === 'Warning message')).toBe(true);
		});

		it('should log error messages', async () => {
			await studio.error('Error message');

			const logs = await studio.getLogs({ level: 'error' });
			expect(logs.some((l) => l.message === 'Error message')).toBe(true);
		});

		it('should record exceptions', async () => {
			const error = new Error('Test error');
			await studio.exception(error);

			const exceptions = await studio.getExceptions();
			expect(exceptions.some((e) => e.message === 'Test error')).toBe(true);
		});

		it('should record exceptions with request ID', async () => {
			const requestId = await studio.recordRequest({
				method: 'GET',
				path: '/api/users',
				status: 500,
				duration: 50,
			});

			await studio.exception(new Error('Request error'), requestId);

			const exceptions = await studio.getExceptions();
			expect(exceptions.some((e) => e.requestId === requestId)).toBe(true);
		});
	});

	describe('monitoring - querying', () => {
		beforeEach(async () => {
			// Record some test data
			await studio.recordRequest({
				method: 'GET',
				path: '/api/users',
				status: 200,
				duration: 100,
			});
			await studio.recordRequest({
				method: 'POST',
				path: '/api/users',
				status: 201,
				duration: 150,
			});
		});

		it('should get all requests', async () => {
			const requests = await studio.getRequests();
			expect(requests.length).toBeGreaterThanOrEqual(2);
		});

		it('should get requests with limit', async () => {
			const requests = await studio.getRequests({ limit: 1 });
			expect(requests.length).toBe(1);
		});

		it('should get a single request by ID', async () => {
			const requestId = await studio.recordRequest({
				method: 'DELETE',
				path: '/api/users/123',
				status: 204,
				duration: 50,
			});

			const request = await studio.getRequest(requestId);
			expect(request).toBeDefined();
			expect(request?.method).toBe('DELETE');
		});

		it('should return null for non-existent request', async () => {
			const request = await studio.getRequest('non-existent-id');
			expect(request).toBeNull();
		});

		it('should get exceptions', async () => {
			await studio.exception(new Error('Test exception'));
			const exceptions = await studio.getExceptions();
			expect(exceptions.length).toBeGreaterThanOrEqual(1);
		});

		it('should get a single exception by ID', async () => {
			await studio.exception(new Error('Another exception'));
			const exceptions = await studio.getExceptions();
			const first = exceptions[0];

			const exception = await studio.getException(first.id);
			expect(exception).toBeDefined();
		});

		it('should return null for non-existent exception', async () => {
			const exception = await studio.getException('non-existent-id');
			expect(exception).toBeNull();
		});

		it('should get logs', async () => {
			await studio.info('Log entry');
			const logs = await studio.getLogs();
			expect(logs.length).toBeGreaterThanOrEqual(1);
		});

		it('should get storage stats', async () => {
			const stats = await studio.getStats();
			expect(stats).toBeDefined();
			expect(typeof stats.requests).toBe('number');
		});
	});

	describe('metrics', () => {
		it('should get aggregated metrics', () => {
			const metrics = studio.getMetrics();
			expect(metrics).toBeDefined();
			expect(typeof metrics.totalRequests).toBe('number');
		});

		it('should get endpoint metrics', () => {
			const endpoints = studio.getEndpointMetrics();
			expect(Array.isArray(endpoints)).toBe(true);
		});

		it('should get status distribution', () => {
			const distribution = studio.getStatusDistribution();
			expect(distribution).toBeDefined();
		});

		it('should reset metrics', () => {
			// Just ensure it doesn't throw
			studio.resetMetrics();
		});
	});

	describe('path ignoring', () => {
		it('should ignore studio paths', () => {
			expect(studio.shouldIgnore('/__studio')).toBe(true);
			expect(studio.shouldIgnore('/__studio/api/requests')).toBe(true);
		});

		it('should not ignore other paths', () => {
			expect(studio.shouldIgnore('/api/users')).toBe(false);
		});

		it('should respect custom ignore patterns', () => {
			const studioWithPatterns = new Studio({
				monitoring: {
					storage,
					ignorePatterns: ['/health', '/metrics'],
				},
				data: {
					db,
					cursor: { field: 'id', direction: Direction.Desc },
				},
			});

			expect(studioWithPatterns.shouldIgnore('/health')).toBe(true);
			expect(studioWithPatterns.shouldIgnore('/api/users')).toBe(false);

			studioWithPatterns.destroy();
		});
	});

	describe('pruning', () => {
		it('should prune old entries', async () => {
			// Record some data
			await studio.recordRequest({
				method: 'GET',
				path: '/old-request',
				status: 200,
				duration: 100,
			});

			// Prune entries older than now (should remove all)
			const futureDate = new Date(Date.now() + 1000);
			const pruned = await studio.prune(futureDate);

			expect(typeof pruned).toBe('number');
		});
	});

	describe('WebSocket management', () => {
		it('should add WebSocket clients', () => {
			const mockWs = {
				send: vi.fn(),
				readyState: 1, // WebSocket.OPEN
			} as any;

			// Should not throw
			studio.addWsClient(mockWs);
		});

		it('should remove WebSocket clients', () => {
			const mockWs = {
				send: vi.fn(),
				readyState: 1,
			} as any;

			studio.addWsClient(mockWs);
			studio.removeWsClient(mockWs);
		});

		it('should broadcast events to connected clients', () => {
			const mockWs = {
				send: vi.fn(),
				readyState: 1,
			} as any;

			studio.addWsClient(mockWs);

			studio.broadcast({
				type: 'request',
				payload: { id: '123' },
				timestamp: Date.now(),
			});

			expect(mockWs.send).toHaveBeenCalled();
		});

		it('should remove clients that fail to receive', () => {
			const mockWs = {
				send: vi.fn().mockImplementation(() => {
					throw new Error('Connection closed');
				}),
				readyState: 1,
			} as any;

			studio.addWsClient(mockWs);

			// Broadcast should not throw
			studio.broadcast({
				type: 'log',
				payload: { message: 'test' },
				timestamp: Date.now(),
			});

			// Client should be removed after failed send
			// (internal state, hard to verify directly)
		});
	});

	describe('destroy', () => {
		it('should clean up resources', () => {
			const s = new Studio({
				monitoring: { storage },
				data: {
					db,
					cursor: { field: 'id', direction: Direction.Desc },
				},
			});

			// Add a WebSocket client
			const mockWs = { send: vi.fn() } as any;
			s.addWsClient(mockWs);

			// Should not throw
			s.destroy();
		});
	});

	describe('data browser integration', () => {
		it('should access the underlying database through data browser', async () => {
			// Insert test data
			await db
				.insertInto('studioTestUsers')
				.values({ name: 'Test User', email: 'test@example.com' })
				.execute();

			// Query through data browser
			const result = await studio.data.query({
				table: 'studio_test_users',
				pageSize: 10,
			});

			expect(result.rows.length).toBeGreaterThanOrEqual(1);
		});

		it('should get schema through data browser', async () => {
			const schema = await studio.data.getSchema();

			const tableNames = schema.tables.map((t) => t.name);
			expect(tableNames).toContain('studio_test_users');
		});
	});
});
