import { LogLevel } from '@geekmidas/logger';
import { ConsoleLogger } from '@geekmidas/logger/console';
import { Hono } from 'hono';
import { bench, describe } from 'vitest';
import { z } from 'zod';
import { e } from '../endpoints';
import type { Endpoint } from '../endpoints/Endpoint';
import { HonoEndpoint } from '../endpoints/HonoEndpointAdaptor';

/**
 * E2E benchmarks with Hono app.request() - tests the full request/response cycle
 * through the Hono framework without network overhead.
 */

// Silent logger for benchmarks - no console output
const silentLogger = new ConsoleLogger({}, LogLevel.Silent);
const api = e.logger(silentLogger);

// Helper to create a Hono app from endpoints
function createApp(
  endpoints: Endpoint<any, any, any, any, any, any, any, any, any, any, any>[],
): Hono {
  const app = new Hono();

  // Silent error handler for benchmarks
  app.onError((err, c) => {
    return c.json({ error: err.message }, 500);
  });

  // Add routes using a mock service discovery
  const mockServiceDiscovery = {
    register: async () => ({}),
  } as any;

  HonoEndpoint.addRoutes(endpoints, mockServiceDiscovery, app, {
    docsPath: false,
  });

  return app;
}

describe('Hono E2E - Simple Endpoints', () => {
  const healthEndpoint = api
    .get('/health')
    .handle(async () => ({ status: 'ok' }));

  const app = createApp([healthEndpoint]);

  bench('GET /health - minimal response', async () => {
    await app.request('/health');
  });
});

describe('Hono E2E - CRUD Operations', () => {
  const endpoints = [
    api
      .get('/users')
      .output(z.array(z.object({ id: z.string(), name: z.string() })))
      .handle(async () => [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ]),

    api
      .get('/users/:id')
      .params(z.object({ id: z.string() }))
      .output(z.object({ id: z.string(), name: z.string() }))
      .handle(async ({ params }) => ({ id: params.id, name: 'User' })),

    api
      .post('/users')
      .body(z.object({ name: z.string(), email: z.string().email() }))
      .output(z.object({ id: z.string() }))
      .handle(async () => ({ id: crypto.randomUUID() })),

    api
      .put('/users/:id')
      .params(z.object({ id: z.string() }))
      .body(z.object({ name: z.string() }))
      .output(z.object({ success: z.boolean() }))
      .handle(async () => ({ success: true })),

    api
      .delete('/users/:id')
      .params(z.object({ id: z.string() }))
      .output(z.object({ deleted: z.boolean() }))
      .handle(async () => ({ deleted: true })),
  ];

  const app = createApp(endpoints);

  bench('GET /users - list response', async () => {
    await app.request('/users');
  });

  bench('GET /users/:id - path params', async () => {
    await app.request('/users/123');
  });

  bench('POST /users - body validation', async () => {
    await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'test@example.com' }),
    });
  });

  bench('PUT /users/:id - params + body', async () => {
    await app.request('/users/123', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });
  });

  bench('DELETE /users/:id - params only', async () => {
    await app.request('/users/123', { method: 'DELETE' });
  });
});

describe('Hono E2E - Complex Validation', () => {
  const complexEndpoint = api
    .post('/orders')
    .body(
      z.object({
        customer: z.object({
          name: z.string(),
          email: z.string().email(),
          address: z.object({
            street: z.string(),
            city: z.string(),
            zip: z.string(),
          }),
        }),
        items: z.array(
          z.object({
            productId: z.string(),
            quantity: z.number().int().positive(),
            price: z.number().positive(),
          }),
        ),
        payment: z.object({
          method: z.enum(['credit_card', 'paypal', 'bank_transfer']),
          details: z.record(z.string(), z.string()),
        }),
      }),
    )
    .output(z.object({ orderId: z.string(), total: z.number() }))
    .handle(async () => ({ orderId: 'order-123', total: 99.99 }));

  const app = createApp([complexEndpoint]);

  bench('POST /orders - complex nested body', async () => {
    await app.request('/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: {
          name: 'John Doe',
          email: 'john@example.com',
          address: {
            street: '123 Main St',
            city: 'Boston',
            zip: '02101',
          },
        },
        items: [
          { productId: 'prod-1', quantity: 2, price: 29.99 },
          { productId: 'prod-2', quantity: 1, price: 39.99 },
        ],
        payment: {
          method: 'credit_card',
          details: { last4: '4242' },
        },
      }),
    });
  });
});

describe('Hono E2E - Query Parameters', () => {
  const searchEndpoint = api
    .get('/search')
    .query(
      z.object({
        q: z.string(),
        page: z.coerce.number().default(1),
        limit: z.coerce.number().default(10),
        sort: z.enum(['asc', 'desc']).optional(),
        filters: z.string().optional(),
      }),
    )
    .output(
      z.object({
        results: z.array(z.unknown()),
        total: z.number(),
        page: z.number(),
      }),
    )
    .handle(async ({ query }) => ({
      results: [],
      total: 0,
      page: query.page,
    }));

  const app = createApp([searchEndpoint]);

  bench('GET /search - with query params', async () => {
    await app.request('/search?q=test&page=2&limit=20&sort=desc');
  });
});

describe('Hono E2E - Concurrent Requests', () => {
  const endpoints = [
    api.get('/health').handle(async () => ({ status: 'ok' })),
    api.get('/users').handle(async () => [{ id: '1' }]),
    api
      .get('/users/:id')
      .params(z.object({ id: z.string() }))
      .handle(async () => ({ id: '1' })),
  ];

  const app = createApp(endpoints);

  bench('10 concurrent requests', async () => {
    await Promise.all([
      app.request('/health'),
      app.request('/users'),
      app.request('/users/1'),
      app.request('/users/2'),
      app.request('/users/3'),
      app.request('/health'),
      app.request('/users'),
      app.request('/users/4'),
      app.request('/users/5'),
      app.request('/health'),
    ]);
  });

  bench('50 concurrent requests', async () => {
    const requests = Array.from({ length: 50 }, (_, i) =>
      i % 3 === 0
        ? app.request('/health')
        : i % 3 === 1
          ? app.request('/users')
          : app.request(`/users/${i}`),
    );
    await Promise.all(requests);
  });
});
