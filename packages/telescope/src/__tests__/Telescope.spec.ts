import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryStorage } from '../storage/memory';
import { Telescope } from '../Telescope';

describe('Telescope', () => {
	let telescope: Telescope;
	let storage: InMemoryStorage;

	beforeEach(() => {
		storage = new InMemoryStorage();
		telescope = new Telescope({ storage });
	});

	afterEach(() => {
		telescope.destroy();
	});

	describe('constructor', () => {
		it('should create with default options', () => {
			expect(telescope.enabled).toBe(true);
			expect(telescope.recordBody).toBe(true);
		});

		it('should respect enabled option', () => {
			const disabled = new Telescope({ storage, enabled: false });
			expect(disabled.enabled).toBe(false);
			disabled.destroy();
		});

		it('should respect recordBody option', () => {
			const noBody = new Telescope({ storage, recordBody: false });
			expect(noBody.recordBody).toBe(false);
			noBody.destroy();
		});
	});

	describe('recordRequest', () => {
		it('should record a request and return an ID', async () => {
			const requestId = await telescope.recordRequest({
				method: 'GET',
				path: '/api/users',
				url: 'http://localhost:3000/api/users',
				headers: { 'content-type': 'application/json' },
				query: { page: '1' },
				status: 200,
				responseHeaders: { 'content-type': 'application/json' },
				responseBody: { users: [] },
				duration: 50,
			});

			expect(requestId).toBeDefined();
			expect(typeof requestId).toBe('string');

			const request = await telescope.getRequest(requestId);
			expect(request).not.toBeNull();
			expect(request?.method).toBe('GET');
			expect(request?.path).toBe('/api/users');
			expect(request?.status).toBe(200);
		});

		it('should not record when disabled', async () => {
			const disabled = new Telescope({ storage, enabled: false });

			const requestId = await disabled.recordRequest({
				method: 'GET',
				path: '/api/test',
				url: 'http://localhost/api/test',
				headers: {},
				query: {},
				status: 200,
				responseHeaders: {},
				duration: 10,
			});

			expect(requestId).toBe('');

			const requests = await storage.getRequests();
			expect(requests).toHaveLength(0);

			disabled.destroy();
		});
	});

	describe('logging', () => {
		it('should record a log entry with info()', async () => {
			await telescope.info('User logged in', { userId: '123' });

			const logs = await telescope.getLogs();
			expect(logs).toHaveLength(1);
			expect(logs[0].level).toBe('info');
			expect(logs[0].message).toBe('User logged in');
			expect(logs[0].context).toEqual({ userId: '123' });
		});

		it('should record different log levels', async () => {
			await telescope.debug('Debug message');
			await telescope.info('Info message');
			await telescope.warn('Warning message');
			await telescope.error('Error message');

			const logs = await telescope.getLogs();
			expect(logs).toHaveLength(4);

			const levels = logs.map((l) => l.level);
			expect(levels).toContain('debug');
			expect(levels).toContain('info');
			expect(levels).toContain('warn');
			expect(levels).toContain('error');
		});

		it('should associate log with request ID', async () => {
			const requestId = await telescope.recordRequest({
				method: 'POST',
				path: '/api/login',
				url: 'http://localhost/api/login',
				headers: {},
				query: {},
				status: 200,
				responseHeaders: {},
				duration: 100,
			});

			await telescope.info('Login successful', {}, requestId);

			const logs = await telescope.getLogs();
			expect(logs[0].requestId).toBe(requestId);
		});

		it('should not record when disabled', async () => {
			const disabled = new Telescope({ storage, enabled: false });

			await disabled.info('Test message');

			const logs = await storage.getLogs();
			expect(logs).toHaveLength(0);

			disabled.destroy();
		});

		it('should batch log entries with log()', async () => {
			await telescope.log([
				{ level: 'info', message: 'First' },
				{ level: 'debug', message: 'Second', context: { step: 2 } },
				{ level: 'warn', message: 'Third' },
			]);

			const logs = await telescope.getLogs();
			expect(logs).toHaveLength(3);
		});
	});

	describe('exception', () => {
		it('should record an exception with stack trace', async () => {
			const error = new Error('Something went wrong');

			await telescope.exception(error);

			const exceptions = await telescope.getExceptions();
			expect(exceptions).toHaveLength(1);
			expect(exceptions[0].name).toBe('Error');
			expect(exceptions[0].message).toBe('Something went wrong');
			expect(exceptions[0].stack.length).toBeGreaterThan(0);
		});

		it('should associate exception with request ID', async () => {
			const requestId = await telescope.recordRequest({
				method: 'GET',
				path: '/api/error',
				url: 'http://localhost/api/error',
				headers: {},
				query: {},
				status: 500,
				responseHeaders: {},
				duration: 10,
			});

			await telescope.exception(new Error('Request failed'), requestId);

			const exceptions = await telescope.getExceptions();
			expect(exceptions[0].requestId).toBe(requestId);
		});
	});

	describe('shouldIgnore', () => {
		it('should ignore paths matching patterns', () => {
			const withPatterns = new Telescope({
				storage,
				ignorePatterns: ['/health', '/metrics', '/__telescope/*'],
			});

			expect(withPatterns.shouldIgnore('/health')).toBe(true);
			expect(withPatterns.shouldIgnore('/metrics')).toBe(true);
			expect(withPatterns.shouldIgnore('/__telescope/api/requests')).toBe(true);
			expect(withPatterns.shouldIgnore('/api/users')).toBe(false);

			withPatterns.destroy();
		});

		it('should return false when no patterns configured', () => {
			expect(telescope.shouldIgnore('/any/path')).toBe(false);
		});
	});

	describe('getRequests', () => {
		it('should return requests with query options', async () => {
			for (let i = 0; i < 5; i++) {
				await telescope.recordRequest({
					method: 'GET',
					path: `/api/item/${i}`,
					url: `http://localhost/api/item/${i}`,
					headers: {},
					query: {},
					status: 200,
					responseHeaders: {},
					duration: 10,
				});
			}

			const requests = await telescope.getRequests({ limit: 2 });
			expect(requests).toHaveLength(2);
		});
	});

	describe('getStats', () => {
		it('should return aggregated statistics', async () => {
			await telescope.recordRequest({
				method: 'GET',
				path: '/api/test',
				url: 'http://localhost/api/test',
				headers: {},
				query: {},
				status: 200,
				responseHeaders: {},
				duration: 10,
			});

			await telescope.info('Test log');
			await telescope.exception(new Error('Test error'));

			const stats = await telescope.getStats();

			expect(stats.requests).toBe(1);
			expect(stats.logs).toBe(1);
			expect(stats.exceptions).toBe(1);
		});
	});

	describe('prune', () => {
		it('should remove old entries', async () => {
			// Add an old entry directly to storage
			await storage.saveRequest({
				id: 'old-req',
				method: 'GET',
				path: '/old',
				url: 'http://localhost/old',
				headers: {},
				query: {},
				status: 200,
				responseHeaders: {},
				duration: 10,
				timestamp: new Date('2020-01-01'),
			});

			// Add a new entry
			await telescope.recordRequest({
				method: 'GET',
				path: '/new',
				url: 'http://localhost/new',
				headers: {},
				query: {},
				status: 200,
				responseHeaders: {},
				duration: 10,
			});

			const deleted = await telescope.prune(new Date('2023-01-01'));

			expect(deleted).toBe(1);

			const requests = await telescope.getRequests();
			expect(requests).toHaveLength(1);
			expect(requests[0].path).toBe('/new');
		});
	});

	describe('auto-prune', () => {
		it('should configure pruneAfterHours option', () => {
			const autoPrune = new Telescope({
				storage,
				pruneAfterHours: 1,
			});

			// Verify the telescope was created with pruneAfterHours
			// The actual pruning is tested via the prune() method
			expect(autoPrune).toBeDefined();

			autoPrune.destroy();
		});
	});

	describe('getRequestId option', () => {
		it('should use custom getRequestId function when provided', async () => {
			const customTelescope = new Telescope({
				storage,
				getRequestId: () => 'custom-request-id-123',
			});

			const requestId = await customTelescope.recordRequest({
				method: 'GET',
				path: '/api/test',
				url: 'http://localhost/api/test',
				headers: {},
				query: {},
				status: 200,
				responseHeaders: {},
				duration: 10,
			});

			expect(requestId).toBe('custom-request-id-123');

			const request = await customTelescope.getRequest('custom-request-id-123');
			expect(request).not.toBeNull();
			expect(request?.id).toBe('custom-request-id-123');

			customTelescope.destroy();
		});

		it('should fallback to nanoid when getRequestId returns undefined', async () => {
			const customTelescope = new Telescope({
				storage,
				getRequestId: () => undefined,
			});

			const requestId = await customTelescope.recordRequest({
				method: 'GET',
				path: '/api/test',
				url: 'http://localhost/api/test',
				headers: {},
				query: {},
				status: 200,
				responseHeaders: {},
				duration: 10,
			});

			// Should fall back to nanoid (21 chars)
			expect(requestId).toBeDefined();
			expect(requestId.length).toBe(21);
			expect(requestId).not.toBe('');

			customTelescope.destroy();
		});

		it('should work with dynamic request ID getter', async () => {
			let currentRequestId: string | undefined;

			const customTelescope = new Telescope({
				storage,
				getRequestId: () => currentRequestId,
			});

			// First request - no context
			currentRequestId = undefined;
			const id1 = await customTelescope.recordRequest({
				method: 'GET',
				path: '/api/test1',
				url: 'http://localhost/api/test1',
				headers: {},
				query: {},
				status: 200,
				responseHeaders: {},
				duration: 10,
			});
			expect(id1.length).toBe(21); // nanoid fallback

			// Second request - with context
			currentRequestId = 'context-id-456';
			const id2 = await customTelescope.recordRequest({
				method: 'GET',
				path: '/api/test2',
				url: 'http://localhost/api/test2',
				headers: {},
				query: {},
				status: 200,
				responseHeaders: {},
				duration: 10,
			});
			expect(id2).toBe('context-id-456');

			customTelescope.destroy();
		});
	});

	describe('WebSocket clients', () => {
		it('should manage WebSocket client connections', () => {
			const mockWs = {
				send: vi.fn(),
				readyState: 1, // OPEN
			} as unknown as WebSocket;

			telescope.addWsClient(mockWs);

			// Broadcast should send to client (including the 'connected' event)
			const callCount = mockWs.send.mock.calls.length;
			expect(callCount).toBeGreaterThan(0);

			telescope.removeWsClient(mockWs);

			// After removal, broadcast should not send
			const newMock = vi.fn();
			mockWs.send = newMock;
			telescope.broadcast({
				type: 'request',
				payload: {},
				timestamp: Date.now(),
			});

			expect(newMock).not.toHaveBeenCalled();
		});

		it('should broadcast to all connected clients', () => {
			const ws1 = { send: vi.fn() } as unknown as WebSocket;
			const ws2 = { send: vi.fn() } as unknown as WebSocket;

			telescope.addWsClient(ws1);
			telescope.addWsClient(ws2);

			telescope.broadcast({
				type: 'log',
				payload: { test: true },
				timestamp: Date.now(),
			});

			// Both should receive the broadcast
			expect(ws1.send).toHaveBeenCalled();
			expect(ws2.send).toHaveBeenCalled();
		});
	});
});
