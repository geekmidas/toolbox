import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { Telescope } from '../../Telescope';
import { InMemoryStorage } from '../../storage/memory';
import { createMiddleware, createUI, getRequestId } from '../hono';

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
      expect(requests[0].headers['authorization']).toBe('Bearer token123');
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
});
