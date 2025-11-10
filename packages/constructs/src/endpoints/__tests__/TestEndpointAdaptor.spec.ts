import { UnprocessableEntityError } from '@geekmidas/errors';
import { ConsoleLogger } from '@geekmidas/logger/console';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { SuccessStatus } from '../Endpoint';
import { e } from '../EndpointFactory';
import { TestEndpointAdaptor } from '../TestEndpointAdaptor';

describe('TestEndpointAdaptor', () => {
  const mockServices = {};
  const logger = new ConsoleLogger();

  describe('request', () => {
    it('should handle simple endpoint without schemas', async () => {
      const endpoint = e
        .get('/test')
        .output(z.object({ message: z.string() }))
        .handle(() => ({ message: 'Hello World' }));

      const adapter = new TestEndpointAdaptor(endpoint);

      const result = await adapter.request({
        services: mockServices,
        headers: { host: 'example.com' },
      });

      expect(result).toEqual({ message: 'Hello World' });
    });

    it('should handle endpoint with body schema', async () => {
      const endpoint = e
        .post('/users')
        .body(z.object({ name: z.string(), email: z.string().email() }))
        .output(z.object({ id: z.string(), name: z.string() }))
        .handle(async ({ body }) => ({
          id: 'user-123',
          name: body.name,
        }));

      const adapter = new TestEndpointAdaptor(endpoint);

      const result = await adapter.request({
        body: { name: 'John Doe', email: 'john@example.com' },
        services: mockServices,
        headers: { host: 'example.com', 'content-type': 'application/json' },
      });

      expect(result).toEqual({ id: 'user-123', name: 'John Doe' });
    });

    it('should handle endpoint with params schema', async () => {
      const endpoint = e
        .get('/users/:id')
        .params(z.object({ id: z.string() }))
        .output(z.object({ id: z.string(), found: z.boolean() }))
        .handle(async ({ params }) => ({
          id: params.id,
          found: true,
        }));

      const adapter = new TestEndpointAdaptor(endpoint);

      const result = await adapter.request({
        params: { id: 'user-456' },
        services: mockServices,
        headers: { host: 'example.com' },
      });

      expect(result).toEqual({ id: 'user-456', found: true });
    });

    it('should handle endpoint with query schema', async () => {
      const endpoint = e
        .get('/search')
        .query(z.object({ q: z.string(), page: z.coerce.number().default(1) }))
        .output(z.object({ query: z.string(), page: z.number() }))
        .handle(async ({ query }) => ({
          query: query.q,
          page: query.page,
        }));

      const adapter = new TestEndpointAdaptor(endpoint);

      const result = await adapter.request({
        query: { q: 'test search', page: 2 },
        services: mockServices,
        headers: { host: 'example.com' },
      });

      expect(result).toEqual({ query: 'test search', page: 2 });
    });

    it('should handle endpoint with all schemas', async () => {
      const endpoint = e
        .put('/users/:id')
        .params(z.object({ id: z.string() }))
        .body(z.object({ name: z.string(), email: z.string().email() }))
        .query(z.object({ notify: z.coerce.boolean().default(false) }))
        .output(
          z.object({
            id: z.string(),
            updated: z.boolean(),
            notified: z.boolean(),
          }),
        )
        .handle(async ({ params, body, query }) => ({
          id: params.id,
          updated: true,
          notified: query.notify,
        }));

      const adapter = new TestEndpointAdaptor(endpoint);

      const result = await adapter.request({
        body: { name: 'Jane Doe', email: 'jane@example.com' },
        query: { notify: true },
        params: { id: 'user-789' },
        services: mockServices,
        headers: { host: 'example.com' },
      });

      expect(result).toEqual({
        id: 'user-789',
        updated: true,
        notified: true,
      });
    });

    it('should throw validation error for invalid body', async () => {
      const endpoint = e
        .post('/users')
        .body(z.object({ name: z.string(), age: z.number().min(18) }))
        .handle(async ({ body }) => ({ id: '123' }));

      const adapter = new TestEndpointAdaptor(endpoint);

      await expect(
        adapter.request({
          body: { name: 'John', age: 15 },
          services: mockServices,
          headers: { host: 'example.com' },
        }),
      ).rejects.toThrow(UnprocessableEntityError);
    });

    it('should handle headers correctly', async () => {
      const endpoint = e
        .get('/headers')
        .output(z.object({ auth: z.string().optional(), host: z.string() }))
        .handle(async ({ header }) => ({
          auth: header('authorization'),
          host: header('host') || 'unknown',
        }));

      const adapter = new TestEndpointAdaptor(endpoint);

      const result = await adapter.request({
        services: mockServices,
        headers: {
          host: 'api.example.com',
          authorization: 'Bearer token123',
          'Content-Type': 'application/json',
        },
      });

      expect(result).toEqual({
        auth: 'Bearer token123',
        host: 'api.example.com',
      });
    });

    it('should handle session correctly', async () => {
      const endpoint = e
        .get('/profile')
        .output(z.object({ userId: z.string() }))
        .handle(async ({ session }) => ({
          userId: (session as any).userId,
        }));

      // Mock getSession
      endpoint.getSession = vi.fn().mockResolvedValue({ userId: 'user-123' });

      const adapter = new TestEndpointAdaptor(endpoint);

      const result = await adapter.request({
        services: mockServices,
        headers: { host: 'example.com' },
      });

      expect(result).toEqual({ userId: 'user-123' });
      expect(endpoint.getSession).toHaveBeenCalledWith({
        logger: expect.any(ConsoleLogger),
        services: mockServices,
        header: expect.any(Function),
        cookie: expect.any(Function),
      });
    });

    it('should validate output schema', async () => {
      const endpoint = e
        .get('/invalid')
        .output(z.object({ id: z.string(), count: z.number() }))
        .handle(() => ({ id: '123', count: 'not-a-number' as any }));

      const adapter = new TestEndpointAdaptor(endpoint);

      await expect(
        adapter.request({
          services: mockServices,
          headers: { host: 'example.com' },
        }),
      ).rejects.toThrow(UnprocessableEntityError);
    });

    it('should handle case-insensitive headers', async () => {
      const endpoint = e
        .get('/headers-case')
        .output(z.object({ contentType: z.string().optional() }))
        .handle(async ({ header }) => ({
          contentType: header('CONTENT-TYPE'),
        }));

      const adapter = new TestEndpointAdaptor(endpoint);

      const result = await adapter.request({
        services: mockServices,
        headers: {
          host: 'example.com',
          'content-type': 'application/json',
        },
      });

      expect(result).toEqual({
        contentType: 'application/json',
      });
    });

    it('should read cookies from request', async () => {
      const endpoint = e
        .get('/cookies')
        .output(
          z.object({
            session: z.string().optional(),
            theme: z.string().optional(),
          }),
        )
        .handle(async ({ cookie }) => ({
          session: cookie('session'),
          theme: cookie('theme'),
        }));

      const adapter = new TestEndpointAdaptor(endpoint);

      const result = await adapter.request({
        services: mockServices,
        headers: {
          host: 'example.com',
          cookie: 'session=abc123; theme=dark',
        },
      });

      expect(result).toEqual({
        session: 'abc123',
        theme: 'dark',
      });
    });

    it('should handle missing cookies gracefully', async () => {
      const endpoint = e
        .get('/cookies-optional')
        .output(
          z.object({
            session: z.string().optional(),
          }),
        )
        .handle(async ({ cookie }) => ({
          session: cookie('session') || 'default',
        }));

      const adapter = new TestEndpointAdaptor(endpoint);

      const result = await adapter.request({
        services: mockServices,
        headers: {
          host: 'example.com',
        },
      });

      expect(result).toEqual({
        session: 'default',
      });
    });

    it('should handle URL encoded cookie values', async () => {
      const endpoint = e
        .get('/cookies-encoded')
        .output(z.object({ user: z.string() }))
        .handle(async ({ cookie }) => ({
          user: cookie('user') || 'unknown',
        }));

      const adapter = new TestEndpointAdaptor(endpoint);

      const result = await adapter.request({
        services: mockServices,
        headers: {
          host: 'example.com',
          cookie: 'user=John%20Doe',
        },
      });

      expect(result).toEqual({
        user: 'John Doe',
      });
    });

    it('should use cookies in session extraction', async () => {
      const endpoint = e
        .get('/profile')
        .output(z.object({ userId: z.string() }))
        .handle(async ({ session }) => ({
          userId: (session as any).userId,
        }));

      // Mock getSession that uses cookies
      endpoint.getSession = vi.fn().mockImplementation(({ cookie }) => {
        const sessionId = cookie('session');
        if (sessionId === 'valid-session') {
          return { userId: 'user-123' };
        }
        return null;
      });

      const adapter = new TestEndpointAdaptor(endpoint);

      const result = await adapter.request({
        services: mockServices,
        headers: {
          host: 'example.com',
          cookie: 'session=valid-session',
        },
      });

      expect(result).toEqual({ userId: 'user-123' });
      expect(endpoint.getSession).toHaveBeenCalledWith({
        logger: expect.any(ConsoleLogger),
        services: mockServices,
        header: expect.any(Function),
        cookie: expect.any(Function),
      });
    });

    it('should handle multiple cookies with same name (uses last)', async () => {
      const endpoint = e
        .get('/duplicate-cookies')
        .output(z.object({ value: z.string() }))
        .handle(async ({ cookie }) => ({
          value: cookie('test') || 'none',
        }));

      const adapter = new TestEndpointAdaptor(endpoint);

      const result = await adapter.request({
        services: mockServices,
        headers: {
          host: 'example.com',
          cookie: 'test=first; test=second',
        },
      });

      // When duplicates exist, Map uses the last occurrence
      expect(result).toEqual({
        value: 'second',
      });
    });
  });

  describe('response handling', () => {
    it('should set response cookies', async () => {
      const endpoint = e
        .post('/auth/login')
        .body(z.object({ email: z.string(), password: z.string() }))
        .output(z.object({ id: z.string(), email: z.string() }))
        .handle(async ({ body }, response) => {
          return response
            .cookie('session', 'abc123', {
              httpOnly: true,
              secure: true,
              sameSite: 'strict',
              maxAge: 3600,
            })
            .send({ id: 'user-1', email: body.email });
        });

      const adapter = new TestEndpointAdaptor(endpoint);
      const result = await adapter.fullRequest({
        body: { email: 'test@example.com', password: 'pass123' },
        services: mockServices,
        headers: { host: 'example.com' },
      });

      expect(result.body).toEqual({
        id: 'user-1',
        email: 'test@example.com',
      });
      expect(result.headers['set-cookie']).toEqual([
        'session=abc123; Max-Age=3600; HttpOnly; Secure; SameSite=strict',
      ]);
    });

    it('should set custom response headers', async () => {
      const endpoint = e
        .post('/users')
        .body(z.object({ name: z.string() }))
        .output(z.object({ id: z.string(), name: z.string() }))
        .handle(async ({ body }, response) => {
          const user = { id: 'user-123', name: body.name };
          return response
            .header('Location', `/users/${user.id}`)
            .header('X-User-Id', user.id)
            .send(user);
        });

      const adapter = new TestEndpointAdaptor(endpoint);
      const result = await adapter.fullRequest({
        body: { name: 'John Doe' },
        services: mockServices,
        headers: { host: 'example.com' },
      });

      expect(result.body).toEqual({
        id: 'user-123',
        name: 'John Doe',
      });
      expect(result.headers).toEqual({
        Location: '/users/user-123',
        'X-User-Id': 'user-123',
      });
    });

    it('should set custom status code', async () => {
      const endpoint = e
        .post('/resources')
        .body(z.object({ name: z.string() }))
        .output(z.object({ id: z.string() }))
        .handle(async (ctx, response) => {
          return response.status(SuccessStatus.Created).send({ id: '123' });
        });

      const adapter = new TestEndpointAdaptor(endpoint);
      const result = await adapter.fullRequest({
        body: { name: 'Resource' },
        services: mockServices,
        headers: { host: 'example.com' },
      });

      expect(result.status).toBe(201);
    });

    it('should delete cookies', async () => {
      const endpoint = e
        .post('/auth/logout')
        .output(z.object({ success: z.boolean() }))
        .handle(async (ctx, response) => {
          return response
            .deleteCookie('session', { path: '/' })
            .send({ success: true });
        });

      const adapter = new TestEndpointAdaptor(endpoint);
      const result = await adapter.fullRequest({
        services: mockServices,
        headers: { host: 'example.com' },
      });

      expect(result.body.success).toBe(true);
      const setCookieHeader = result.headers['set-cookie'] as string[];
      expect(setCookieHeader).toHaveLength(1);
      expect(setCookieHeader[0]).toContain('session=');
      expect(setCookieHeader[0]).toContain('Max-Age=0');
      expect(setCookieHeader[0]).toContain('Path=/');
    });

    it('should combine cookies, headers, and status', async () => {
      const endpoint = e
        .post('/complete')
        .body(z.object({ data: z.string() }))
        .output(z.object({ id: z.string(), result: z.string() }))
        .handle(async ({ body }, response) => {
          return response
            .status(SuccessStatus.Created)
            .header('Location', '/complete/123')
            .header('X-Request-Id', 'req-456')
            .cookie('tracking', 'track-789')
            .cookie('preference', 'dark', { maxAge: 86400 })
            .send({ id: '123', result: body.data });
        });

      const adapter = new TestEndpointAdaptor(endpoint);
      const result = await adapter.fullRequest({
        body: { data: 'test' },
        services: mockServices,
        headers: { host: 'example.com' },
      });

      expect(result.body).toEqual({
        id: '123',
        result: 'test',
      });
      expect(result.status).toBe(201);
      expect(result.headers).toEqual({
        Location: '/complete/123',
        'X-Request-Id': 'req-456',
        'set-cookie': ['tracking=track-789', 'preference=dark; Max-Age=86400'],
      });
    });

    it('should return simple response without metadata when not using response builder', async () => {
      const endpoint = e
        .get('/simple')
        .output(z.object({ message: z.string() }))
        .handle(async () => {
          // Not using response builder, just returning data
          return { message: 'Hello' };
        });

      const adapter = new TestEndpointAdaptor(endpoint);
      const result = await adapter.request({
        services: mockServices,
        headers: { host: 'example.com' },
      });

      // Should return just the data, not wrapped in metadata
      expect(result).toEqual({ message: 'Hello' });
      expect(result).not.toHaveProperty('metadata');
    });

    it('should combine request cookies and response cookies', async () => {
      const endpoint = e
        .get('/preferences')
        .output(z.object({ theme: z.string(), updated: z.boolean() }))
        .handle(async ({ cookie }, response) => {
          const currentTheme = cookie('theme') || 'light';
          const newTheme = currentTheme === 'light' ? 'dark' : 'light';

          return response
            .cookie('theme', newTheme, { maxAge: 86400 })
            .send({ theme: newTheme, updated: true });
        });

      const adapter = new TestEndpointAdaptor(endpoint);
      const result = await adapter.fullRequest({
        services: mockServices,
        headers: {
          host: 'example.com',
          cookie: 'theme=light',
        },
      });

      expect(result.body).toEqual({
        theme: 'dark',
        updated: true,
      });
      expect(result.headers['set-cookie']).toEqual([
        'theme=dark; Max-Age=86400',
      ]);
    });
  });

  describe('fullRequest', () => {
    it('should return full HTTP response with body, status, and headers', async () => {
      const endpoint = e
        .get('/test')
        .output(z.object({ message: z.string() }))
        .handle(() => ({ message: 'Hello World' }));

      const adapter = new TestEndpointAdaptor(endpoint);

      const result = await adapter.fullRequest({
        services: mockServices,
        headers: { host: 'example.com' },
      });

      expect(result).toEqual({
        body: { message: 'Hello World' },
        status: 200,
        headers: {},
      });
    });

    it('should return custom status code in HTTP response', async () => {
      const endpoint = e
        .post('/resources')
        .body(z.object({ name: z.string() }))
        .output(z.object({ id: z.string() }))
        .handle(async (ctx, response) => {
          return response.status(SuccessStatus.Created).send({ id: '123' });
        });

      const adapter = new TestEndpointAdaptor(endpoint);
      const result = await adapter.fullRequest({
        body: { name: 'Resource' },
        services: mockServices,
        headers: { host: 'example.com' },
      });

      expect(result.status).toBe(201);
      expect(result.body).toEqual({ id: '123' });
    });

    it('should include custom headers in HTTP response', async () => {
      const endpoint = e
        .post('/users')
        .body(z.object({ name: z.string() }))
        .output(z.object({ id: z.string(), name: z.string() }))
        .handle(async ({ body }, response) => {
          const user = { id: 'user-123', name: body.name };
          return response
            .header('Location', `/users/${user.id}`)
            .header('X-User-Id', user.id)
            .send(user);
        });

      const adapter = new TestEndpointAdaptor(endpoint);
      const result = await adapter.fullRequest({
        body: { name: 'John Doe' },
        services: mockServices,
        headers: { host: 'example.com' },
      });

      expect(result.body).toEqual({
        id: 'user-123',
        name: 'John Doe',
      });
      expect(result.headers).toEqual({
        Location: '/users/user-123',
        'X-User-Id': 'user-123',
      });
    });

    it('should convert cookies to Set-Cookie headers', async () => {
      const endpoint = e
        .post('/auth/login')
        .body(z.object({ email: z.string(), password: z.string() }))
        .output(z.object({ id: z.string(), email: z.string() }))
        .handle(async ({ body }, response) => {
          return response
            .cookie('session', 'abc123', {
              httpOnly: true,
              secure: true,
              sameSite: 'strict',
              maxAge: 3600,
            })
            .send({ id: 'user-1', email: body.email });
        });

      const adapter = new TestEndpointAdaptor(endpoint);
      const result = await adapter.fullRequest({
        body: { email: 'test@example.com', password: 'pass123' },
        services: mockServices,
        headers: { host: 'example.com' },
      });

      expect(result.body).toEqual({
        id: 'user-1',
        email: 'test@example.com',
      });
      expect(result.headers['set-cookie']).toEqual([
        'session=abc123; Max-Age=3600; HttpOnly; Secure; SameSite=strict',
      ]);
    });

    it('should handle multiple cookies as array of Set-Cookie headers', async () => {
      const endpoint = e
        .post('/complete')
        .body(z.object({ data: z.string() }))
        .output(z.object({ id: z.string(), result: z.string() }))
        .handle(async ({ body }, response) => {
          return response
            .cookie('tracking', 'track-789')
            .cookie('preference', 'dark', { maxAge: 86400, path: '/' })
            .send({ id: '123', result: body.data });
        });

      const adapter = new TestEndpointAdaptor(endpoint);
      const result = await adapter.fullRequest({
        body: { data: 'test' },
        services: mockServices,
        headers: { host: 'example.com' },
      });

      expect(result.headers['set-cookie']).toEqual([
        'tracking=track-789',
        'preference=dark; Max-Age=86400; Path=/',
      ]);
    });

    it('should serialize all cookie options correctly', async () => {
      const expires = new Date('2025-12-31T23:59:59Z');
      const endpoint = e
        .get('/cookies-full')
        .output(z.object({ success: z.boolean() }))
        .handle(async (ctx, response) => {
          return response
            .cookie('full-cookie', 'value123', {
              domain: 'example.com',
              path: '/api',
              expires: expires,
              maxAge: 7200,
              httpOnly: true,
              secure: true,
              sameSite: 'lax',
            })
            .send({ success: true });
        });

      const adapter = new TestEndpointAdaptor(endpoint);
      const result = await adapter.fullRequest({
        services: mockServices,
        headers: { host: 'example.com' },
      });

      expect(result.headers['set-cookie']).toEqual([
        `full-cookie=value123; Max-Age=7200; Expires=${expires.toUTCString()}; Domain=example.com; Path=/api; HttpOnly; Secure; SameSite=lax`,
      ]);
    });

    it('should handle cookie deletion in Set-Cookie header', async () => {
      const endpoint = e
        .post('/auth/logout')
        .output(z.object({ success: z.boolean() }))
        .handle(async (ctx, response) => {
          return response
            .deleteCookie('session', { path: '/' })
            .send({ success: true });
        });

      const adapter = new TestEndpointAdaptor(endpoint);
      const result = await adapter.fullRequest({
        services: mockServices,
        headers: { host: 'example.com' },
      });

      expect(result.body.success).toBe(true);
      const setCookieHeader = result.headers['set-cookie'] as string[];
      expect(setCookieHeader).toHaveLength(1);
      expect(setCookieHeader[0]).toContain('session=');
      expect(setCookieHeader[0]).toContain('Max-Age=0');
      expect(setCookieHeader[0]).toContain('Path=/');
      expect(setCookieHeader[0]).toContain('Expires=');
    });

    it('should combine headers and cookies in HTTP response', async () => {
      const endpoint = e
        .post('/complete')
        .body(z.object({ data: z.string() }))
        .output(z.object({ id: z.string(), result: z.string() }))
        .handle(async ({ body }, response) => {
          return response
            .status(SuccessStatus.Created)
            .header('Location', '/complete/123')
            .header('X-Request-Id', 'req-456')
            .cookie('tracking', 'track-789')
            .cookie('preference', 'dark', { maxAge: 86400 })
            .send({ id: '123', result: body.data });
        });

      const adapter = new TestEndpointAdaptor(endpoint);
      const result = await adapter.fullRequest({
        body: { data: 'test' },
        services: mockServices,
        headers: { host: 'example.com' },
      });

      expect(result).toEqual({
        body: { id: '123', result: 'test' },
        status: 201,
        headers: {
          Location: '/complete/123',
          'X-Request-Id': 'req-456',
          'set-cookie': [
            'tracking=track-789',
            'preference=dark; Max-Age=86400',
          ],
        },
      });
    });

    it('should handle empty response metadata', async () => {
      const endpoint = e
        .get('/simple')
        .output(z.object({ message: z.string() }))
        .handle(async () => ({ message: 'Hello' }));

      const adapter = new TestEndpointAdaptor(endpoint);
      const result = await adapter.fullRequest({
        services: mockServices,
        headers: { host: 'example.com' },
      });

      expect(result).toEqual({
        body: { message: 'Hello' },
        status: 200,
        headers: {},
      });
    });
  });

  describe('request method delegation', () => {
    it('should return only body from fullRequest', async () => {
      const endpoint = e
        .post('/users')
        .body(z.object({ name: z.string() }))
        .output(z.object({ id: z.string(), name: z.string() }))
        .handle(async ({ body }, response) => {
          return response
            .status(SuccessStatus.Created)
            .header('Location', '/users/123')
            .cookie('session', 'abc')
            .send({ id: '123', name: body.name });
        });

      const adapter = new TestEndpointAdaptor(endpoint);

      // Call request (should only return body)
      const simpleResult = await adapter.request({
        body: { name: 'John' },
        services: mockServices,
        headers: { host: 'example.com' },
      });

      // Call fullRequest (should return full HTTP response)
      const fullResult = await adapter.fullRequest({
        body: { name: 'John' },
        services: mockServices,
        headers: { host: 'example.com' },
      });

      // request should only return the body
      expect(simpleResult).toEqual({ id: '123', name: 'John' });
      expect(simpleResult).not.toHaveProperty('status');
      expect(simpleResult).not.toHaveProperty('headers');

      // fullRequest should return complete HTTP response
      expect(fullResult.body).toEqual({ id: '123', name: 'John' });
      expect(fullResult.status).toBe(201);
      expect(fullResult.headers).toHaveProperty('Location');
      expect(fullResult.headers).toHaveProperty('set-cookie');
    });
  });
});
