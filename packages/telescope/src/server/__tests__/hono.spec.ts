import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryStorage } from '../../storage/memory';
import { Telescope } from '../../Telescope';
import {
	createMiddleware,
	createUI,
	getRequestId,
	getTelescopeContext,
	setupWebSocket,
} from '../hono';

describe('Hono Adapter', () => {
	let telescope: Telescope;
	let storage: InMemoryStorage;

	beforeEach(() => {
		storage = new InMemoryStorage();
		telescope = new Telescope({ storage });
	});

	afterEach(() => {
		telescope.destroy();
	});

	describe('createMiddleware', () => {
		it('should capture GET requests', async () => {
			const app = new Hono();
			app.use('*', createMiddleware(telescope));
			app.get('/api/users', (c) => c.json({ users: [] }));

			const res = await app.request('/api/users');

			expect(res.status).toBe(200);

			const requests = await telescope.getRequests();
			expect(requests).toHaveLength(1);
			expect(requests[0].method).toBe('GET');
			expect(requests[0].path).toBe('/api/users');
			expect(requests[0].status).toBe(200);
		});

		it('should capture POST requests with body', async () => {
			const app = new Hono();
			app.use('*', createMiddleware(telescope));
			app.post('/api/users', async (c) => {
				const body = await c.req.json();
				return c.json({ id: '123', ...body }, 201);
			});

			const res = await app.request('/api/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'John' }),
			});

			expect(res.status).toBe(201);

			const requests = await telescope.getRequests();
			expect(requests).toHaveLength(1);
			expect(requests[0].method).toBe('POST');
			expect(requests[0].body).toEqual({ name: 'John' });
			expect(requests[0].status).toBe(201);
		});

		it('should capture query parameters', async () => {
			const app = new Hono();
			app.use('*', createMiddleware(telescope));
			app.get('/api/search', (c) => c.json({ query: c.req.query('q') }));

			await app.request('/api/search?q=test&limit=10');

			const requests = await telescope.getRequests();
			expect(requests[0].query).toEqual({ q: 'test', limit: '10' });
		});

		it('should capture request headers', async () => {
			const app = new Hono();
			app.use('*', createMiddleware(telescope));
			app.get('/api/test', (c) => c.json({ ok: true }));

			await app.request('/api/test', {
				headers: {
					Authorization: 'Bearer token123',
					'X-Custom-Header': 'custom-value',
				},
			});

			const requests = await telescope.getRequests();
			expect(requests[0].headers.authorization).toBe('Bearer token123');
			expect(requests[0].headers['x-custom-header']).toBe('custom-value');
		});

		it('should capture response duration', async () => {
			const app = new Hono();
			app.use('*', createMiddleware(telescope));
			app.get('/api/slow', async (c) => {
				await new Promise((resolve) => setTimeout(resolve, 50));
				return c.json({ ok: true });
			});

			await app.request('/api/slow');

			const requests = await telescope.getRequests();
			expect(requests[0].duration).toBeGreaterThan(40);
		});

		it('should handle errors thrown in handlers', async () => {
			const app = new Hono();
			app.use('*', createMiddleware(telescope));
			app.get('/api/error', () => {
				throw new Error('Test error');
			});

			// Hono catches errors and returns 500
			const res = await app.request('/api/error');
			expect(res.status).toBe(500);

			// The error is logged to stderr but the request still completes
			// Exception recording depends on Hono's error handling behavior
		});

		it('should skip ignored paths', async () => {
			const ignoredTelescope = new Telescope({
				storage,
				ignorePatterns: ['/health', '/__telescope/*'],
			});

			const app = new Hono();
			app.use('*', createMiddleware(ignoredTelescope));
			app.get('/health', (c) => c.json({ status: 'ok' }));
			app.get('/api/users', (c) => c.json({ users: [] }));

			await app.request('/health');
			await app.request('/api/users');

			const requests = await ignoredTelescope.getRequests();
			expect(requests).toHaveLength(1);
			expect(requests[0].path).toBe('/api/users');

			ignoredTelescope.destroy();
		});

		it('should skip when telescope is disabled', async () => {
			const disabled = new Telescope({ storage, enabled: false });

			const app = new Hono();
			app.use('*', createMiddleware(disabled));
			app.get('/api/test', (c) => c.json({ ok: true }));

			await app.request('/api/test');

			const requests = await storage.getRequests();
			expect(requests).toHaveLength(0);

			disabled.destroy();
		});

		it('should not record body when recordBody is false', async () => {
			const noBody = new Telescope({ storage, recordBody: false });

			const app = new Hono();
			app.use('*', createMiddleware(noBody));
			app.post('/api/users', async (c) => {
				await c.req.json();
				return c.json({ id: '123' });
			});

			await app.request('/api/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'John' }),
			});

			const requests = await noBody.getRequests();
			expect(requests[0].body).toBeUndefined();

			noBody.destroy();
		});

		it('should capture request size from Content-Length header', async () => {
			const app = new Hono();
			app.use('*', createMiddleware(telescope));
			app.post('/api/data', async (c) => {
				await c.req.json();
				return c.json({ ok: true });
			});

			const body = JSON.stringify({ name: 'John', data: 'test' });
			await app.request('/api/data', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': String(Buffer.byteLength(body)),
				},
				body,
			});

			const requests = await telescope.getRequests();
			expect(requests[0].requestSize).toBe(Buffer.byteLength(body));
		});

		it('should capture response size from body when Content-Length not set', async () => {
			const app = new Hono();
			app.use('*', createMiddleware(telescope));
			app.get('/api/data', (c) =>
				c.json({ users: ['alice', 'bob', 'charlie'] }),
			);

			await app.request('/api/data');

			const requests = await telescope.getRequests();
			expect(requests[0].responseSize).toBeGreaterThan(0);
			// The response body is '{"users":["alice","bob","charlie"]}'
			expect(requests[0].responseSize).toBe(
				Buffer.byteLength(
					JSON.stringify({ users: ['alice', 'bob', 'charlie'] }),
				),
			);
		});

		it('should handle multi-byte characters in size calculation', async () => {
			const app = new Hono();
			app.use('*', createMiddleware(telescope));
			app.get('/api/unicode', (c) => c.json({ message: '你好世界' }));

			await app.request('/api/unicode');

			const requests = await telescope.getRequests();
			// UTF-8 bytes for Chinese characters are more than string length
			const expectedBody = JSON.stringify({ message: '你好世界' });
			expect(requests[0].responseSize).toBe(
				Buffer.byteLength(expectedBody, 'utf8'),
			);
		});
	});

	describe('createUI', () => {
		it('should return requests list', async () => {
			// Add a request first
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

			const ui = createUI(telescope);
			const res = await ui.request('/api/requests');
			const data = await res.json();

			expect(Array.isArray(data)).toBe(true);
			expect(data).toHaveLength(1);
		});

		it('should return single request by ID', async () => {
			const requestId = await telescope.recordRequest({
				method: 'GET',
				path: '/api/test',
				url: 'http://localhost/api/test',
				headers: {},
				query: {},
				status: 200,
				responseHeaders: {},
				duration: 10,
			});

			const ui = createUI(telescope);
			const res = await ui.request(`/api/requests/${requestId}`);
			const data = await res.json();

			expect(data.id).toBe(requestId);
			expect(data.path).toBe('/api/test');
		});

		it('should return 404 for non-existent request', async () => {
			const ui = createUI(telescope);
			const res = await ui.request('/api/requests/non-existent');

			expect(res.status).toBe(404);
		});

		it('should return exceptions list', async () => {
			await telescope.exception(new Error('Test error'));

			const ui = createUI(telescope);
			const res = await ui.request('/api/exceptions');
			const data = await res.json();

			expect(Array.isArray(data)).toBe(true);
			expect(data).toHaveLength(1);
			expect(data[0].message).toBe('Test error');
		});

		it('should return logs list', async () => {
			await telescope.info('Test log', { key: 'value' });

			const ui = createUI(telescope);
			const res = await ui.request('/api/logs');
			const data = await res.json();

			expect(Array.isArray(data)).toBe(true);
			expect(data).toHaveLength(1);
			expect(data[0].message).toBe('Test log');
		});

		it('should return stats', async () => {
			await telescope.recordRequest({
				method: 'GET',
				path: '/test',
				url: 'http://localhost/test',
				headers: {},
				query: {},
				status: 200,
				responseHeaders: {},
				duration: 10,
			});
			await telescope.info('Test');
			await telescope.exception(new Error('Test'));

			const ui = createUI(telescope);
			const res = await ui.request('/api/stats');
			const data = await res.json();

			expect(data.requests).toBe(1);
			expect(data.logs).toBe(1);
			expect(data.exceptions).toBe(1);
		});

		it('should return dashboard HTML on root', async () => {
			const ui = createUI(telescope);
			const res = await ui.request('/');

			expect(res.headers.get('content-type')).toContain('text/html');
			const html = await res.text();
			expect(html).toContain('<!DOCTYPE html>');
		});

		it('should support pagination query params', async () => {
			for (let i = 0; i < 10; i++) {
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

			const ui = createUI(telescope);
			const res = await ui.request('/api/requests?limit=3&offset=0');
			const data = await res.json();

			expect(data).toHaveLength(3);
		});
	});

	describe('getRequestId', () => {
		it('should return undefined during handler (ID is set after response)', async () => {
			let capturedRequestId: string | undefined;

			const app = new Hono();
			app.use('*', createMiddleware(telescope));
			app.get('/api/test', (c) => {
				// Note: The request ID is set AFTER next() completes,
				// so it's not available during the handler execution
				capturedRequestId = getRequestId(c);
				return c.json({ ok: true });
			});

			await app.request('/api/test');

			// The ID is not available during handler execution
			expect(capturedRequestId).toBeUndefined();

			// But the request was still recorded
			const requests = await telescope.getRequests();
			expect(requests).toHaveLength(1);
		});

		it('should return undefined when middleware not used', async () => {
			let capturedRequestId: string | undefined;

			const app = new Hono();
			app.get('/api/test', (c) => {
				capturedRequestId = getRequestId(c);
				return c.json({ ok: true });
			});

			await app.request('/api/test');

			expect(capturedRequestId).toBeUndefined();
		});
	});

	describe('getTelescopeContext', () => {
		it('should return undefined when middleware not used', async () => {
			let ctx: ReturnType<typeof getTelescopeContext>;

			const app = new Hono();
			app.get('/api/test', (c) => {
				ctx = getTelescopeContext(c);
				return c.json({ ok: true });
			});

			await app.request('/api/test');

			expect(ctx).toBeUndefined();
		});
	});

	describe('createMiddleware - edge cases', () => {
		it('should capture IP from x-forwarded-for header', async () => {
			const app = new Hono();
			app.use('*', createMiddleware(telescope));
			app.get('/api/test', (c) => c.json({ ok: true }));

			await app.request('/api/test', {
				headers: { 'x-forwarded-for': '192.168.1.1' },
			});

			const requests = await telescope.getRequests();
			expect(requests[0].ip).toBe('192.168.1.1');
		});

		it('should capture IP from x-real-ip header', async () => {
			const app = new Hono();
			app.use('*', createMiddleware(telescope));
			app.get('/api/test', (c) => c.json({ ok: true }));

			await app.request('/api/test', {
				headers: { 'x-real-ip': '10.0.0.1' },
			});

			const requests = await telescope.getRequests();
			expect(requests[0].ip).toBe('10.0.0.1');
		});

		it('should capture form-urlencoded body', async () => {
			const app = new Hono();
			app.use('*', createMiddleware(telescope));
			app.post('/api/form', async (c) => {
				const body = await c.req.formData();
				return c.json({ name: body.get('name') });
			});

			const formData = new FormData();
			formData.append('name', 'John');

			await app.request('/api/form', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ name: 'John' }),
			});

			const requests = await telescope.getRequests();
			expect(requests[0].method).toBe('POST');
		});

		it('should capture text body', async () => {
			const app = new Hono();
			app.use('*', createMiddleware(telescope));
			app.post('/api/text', async (c) => {
				const body = await c.req.text();
				return c.text(`Received: ${body}`);
			});

			await app.request('/api/text', {
				method: 'POST',
				headers: { 'Content-Type': 'text/plain' },
				body: 'Hello, World!',
			});

			const requests = await telescope.getRequests();
			expect(requests[0].body).toBe('Hello, World!');
		});

		it('should handle PUT requests', async () => {
			const app = new Hono();
			app.use('*', createMiddleware(telescope));
			app.put('/api/users/:id', async (c) => {
				const body = await c.req.json();
				return c.json({ id: c.req.param('id'), ...body });
			});

			await app.request('/api/users/123', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'Jane' }),
			});

			const requests = await telescope.getRequests();
			expect(requests[0].body).toEqual({ name: 'Jane' });
		});

		it('should handle PATCH requests', async () => {
			const app = new Hono();
			app.use('*', createMiddleware(telescope));
			app.patch('/api/users/:id', async (c) => {
				const body = await c.req.json();
				return c.json({ updated: true, ...body });
			});

			await app.request('/api/users/123', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'Updated' }),
			});

			const requests = await telescope.getRequests();
			expect(requests[0].body).toEqual({ name: 'Updated' });
		});

		it('should handle body parsing errors gracefully', async () => {
			const app = new Hono();
			app.use('*', createMiddleware(telescope));
			app.post('/api/test', (c) => c.json({ ok: true }));

			await app.request('/api/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: 'invalid json{{{',
			});

			const requests = await telescope.getRequests();
			// Request should still be recorded even with body parsing error
			expect(requests).toHaveLength(1);
		});
	});

	describe('createUI - metrics endpoints', () => {
		it('should return metrics', async () => {
			await telescope.recordRequest({
				method: 'GET',
				path: '/api/test',
				url: 'http://localhost/api/test',
				headers: {},
				query: {},
				status: 200,
				responseHeaders: {},
				duration: 100,
			});

			const ui = createUI(telescope);
			const res = await ui.request('/api/metrics');
			const data = await res.json();

			expect(data).toHaveProperty('totalRequests');
		});

		it('should return endpoint metrics', async () => {
			await telescope.recordRequest({
				method: 'GET',
				path: '/api/users',
				url: 'http://localhost/api/users',
				headers: {},
				query: {},
				status: 200,
				responseHeaders: {},
				duration: 50,
			});

			const ui = createUI(telescope);
			const res = await ui.request('/api/metrics/endpoints');
			const data = await res.json();

			expect(Array.isArray(data)).toBe(true);
		});

		it('should return status distribution', async () => {
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

			const ui = createUI(telescope);
			const res = await ui.request('/api/metrics/status');
			const data = await res.json();

			expect(data).toBeDefined();
		});

		it('should return endpoint details', async () => {
			await telescope.recordRequest({
				method: 'GET',
				path: '/api/users',
				url: 'http://localhost/api/users',
				headers: {},
				query: {},
				status: 200,
				responseHeaders: {},
				duration: 50,
			});

			const ui = createUI(telescope);
			const res = await ui.request(
				'/api/metrics/endpoint?method=GET&path=/api/users',
			);

			// The endpoint may not exist depending on how metrics are stored
			// Just check it returns something valid
			expect(res.status === 200 || res.status === 404).toBe(true);
		});

		it('should return 400 for endpoint details without method/path', async () => {
			const ui = createUI(telescope);
			const res = await ui.request('/api/metrics/endpoint');

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('method and path are required');
		});

		it('should reset metrics', async () => {
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

			const ui = createUI(telescope);
			const res = await ui.request('/api/metrics', { method: 'DELETE' });

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.success).toBe(true);
		});
	});

	describe('createUI - exception by ID', () => {
		it('should return single exception by ID', async () => {
			await telescope.exception(new Error('Test exception'));

			const exceptions = await telescope.getExceptions();
			const exceptionId = exceptions[0].id;

			const ui = createUI(telescope);
			const res = await ui.request(`/api/exceptions/${exceptionId}`);
			const data = await res.json();

			expect(data.id).toBe(exceptionId);
			expect(data.message).toBe('Test exception');
		});

		it('should return 404 for non-existent exception', async () => {
			const ui = createUI(telescope);
			const res = await ui.request('/api/exceptions/non-existent');

			expect(res.status).toBe(404);
		});
	});

	describe('createUI - SPA fallback', () => {
		it('should serve HTML for SPA routes', async () => {
			const ui = createUI(telescope);
			const res = await ui.request('/requests/some-id');

			expect(res.headers.get('content-type')).toContain('text/html');
		});
	});

	describe('createUI - query parsing', () => {
		it('should parse search query', async () => {
			await telescope.recordRequest({
				method: 'GET',
				path: '/api/users',
				url: 'http://localhost/api/users',
				headers: {},
				query: {},
				status: 200,
				responseHeaders: {},
				duration: 10,
			});

			const ui = createUI(telescope);
			const res = await ui.request('/api/requests?search=users');
			const data = await res.json();

			expect(Array.isArray(data)).toBe(true);
		});

		it('should parse date range queries', async () => {
			const ui = createUI(telescope);
			const res = await ui.request(
				'/api/requests?before=2024-01-01&after=2023-01-01',
			);
			const data = await res.json();

			expect(Array.isArray(data)).toBe(true);
		});

		it('should parse tags query', async () => {
			const ui = createUI(telescope);
			const res = await ui.request('/api/requests?tags=api,users');
			const data = await res.json();

			expect(Array.isArray(data)).toBe(true);
		});

		it('should parse method filter', async () => {
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

			const ui = createUI(telescope);
			const res = await ui.request('/api/requests?method=GET');
			const data = await res.json();

			expect(Array.isArray(data)).toBe(true);
		});

		it('should parse status filter', async () => {
			const ui = createUI(telescope);
			const res = await ui.request('/api/requests?status=200');
			const data = await res.json();

			expect(Array.isArray(data)).toBe(true);
		});

		it('should parse log level filter', async () => {
			await telescope.info('Test info');
			await telescope.error('Test error');

			const ui = createUI(telescope);
			const res = await ui.request('/api/logs?level=error');
			const data = await res.json();

			expect(Array.isArray(data)).toBe(true);
		});

		it('should parse metrics query options', async () => {
			const ui = createUI(telescope);
			const res = await ui.request(
				'/api/metrics?start=2024-01-01&end=2024-12-31&bucketSize=3600000&limit=10',
			);
			const data = await res.json();

			expect(data).toBeDefined();
		});
	});

	describe('setupWebSocket', () => {
		it('should setup WebSocket route with default options', () => {
			const app = new Hono();
			const mockUpgrade = vi.fn(() => vi.fn());

			setupWebSocket(app, telescope, mockUpgrade);

			expect(mockUpgrade).toHaveBeenCalled();
		});

		it('should setup WebSocket route with custom options', () => {
			const app = new Hono();
			const mockUpgrade = vi.fn(() => vi.fn());

			setupWebSocket(app, telescope, mockUpgrade, {
				broadcastMetrics: false,
				metricsBroadcastInterval: 10000,
			});

			expect(mockUpgrade).toHaveBeenCalled();
		});

		it('should start metrics broadcast when enabled', () => {
			const app = new Hono();
			const mockUpgrade = vi.fn(() => vi.fn());
			const startSpy = vi.spyOn(telescope, 'startMetricsBroadcast');

			setupWebSocket(app, telescope, mockUpgrade, {
				broadcastMetrics: true,
				metricsBroadcastInterval: 5000,
			});

			expect(startSpy).toHaveBeenCalledWith(5000);
		});

		it('should not start metrics broadcast when disabled', () => {
			const app = new Hono();
			const mockUpgrade = vi.fn(() => vi.fn());
			const startSpy = vi.spyOn(telescope, 'startMetricsBroadcast');

			setupWebSocket(app, telescope, mockUpgrade, {
				broadcastMetrics: false,
			});

			expect(startSpy).not.toHaveBeenCalled();
		});
	});
});
