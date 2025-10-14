import { ConsoleLogger } from '@geekmidas/logger/console';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { e } from '../EndpointFactory';
import { UnprocessableEntityError } from '@geekmidas/errors';
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
  });
});
