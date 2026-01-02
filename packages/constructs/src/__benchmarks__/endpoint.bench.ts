import { bench, describe } from 'vitest';
import { z } from 'zod';
import { e } from '../endpoints';
import { TestEndpointAdaptor } from '../endpoints/TestEndpointAdaptor';

describe('Endpoint Handling - Simple', () => {
  const simpleEndpoint = e.get('/health').handle(async () => ({ status: 'ok' }));
  const adaptor = new TestEndpointAdaptor(simpleEndpoint);

  bench('simple GET endpoint', async () => {
    await adaptor.request({
      services: {},
      headers: {},
    });
  });
});

describe('Endpoint Handling - With Validation', () => {
  const validatedEndpoint = e
    .post('/users')
    .body(z.object({ name: z.string(), email: z.string().email() }))
    .output(z.object({ id: z.string() }))
    .handle(async () => ({ id: '123' }));

  const adaptor = new TestEndpointAdaptor(validatedEndpoint);

  bench('POST with body validation', async () => {
    await adaptor.request({
      services: {},
      headers: { 'content-type': 'application/json' },
      body: { name: 'Test User', email: 'test@example.com' },
    });
  });

  const complexBodyEndpoint = e
    .post('/complex')
    .body(
      z.object({
        user: z.object({
          name: z.string(),
          email: z.string().email(),
          profile: z.object({
            bio: z.string().optional(),
            avatar: z.string().url().optional(),
          }),
        }),
        items: z.array(
          z.object({
            id: z.string(),
            quantity: z.number().int().positive(),
          }),
        ),
      }),
    )
    .output(z.object({ success: z.boolean() }))
    .handle(async () => ({ success: true }));

  const complexAdaptor = new TestEndpointAdaptor(complexBodyEndpoint);

  bench('POST with complex body validation', async () => {
    await complexAdaptor.request({
      services: {},
      headers: { 'content-type': 'application/json' },
      body: {
        user: {
          name: 'Test',
          email: 'test@example.com',
          profile: { bio: 'Hello', avatar: 'https://example.com/avatar.jpg' },
        },
        items: [
          { id: '1', quantity: 2 },
          { id: '2', quantity: 5 },
        ],
      },
    });
  });
});

describe('Endpoint Handling - Path Params', () => {
  const paramsEndpoint = e
    .get('/users/:id')
    .params(z.object({ id: z.string() }))
    .output(z.object({ id: z.string(), name: z.string() }))
    .handle(async ({ params }) => ({ id: params.id, name: 'User' }));

  const adaptor = new TestEndpointAdaptor(paramsEndpoint);

  bench('GET with path params', async () => {
    await adaptor.request({
      services: {},
      headers: {},
      params: { id: '123' },
    });
  });
});

describe('Endpoint Handling - Query Params', () => {
  const queryEndpoint = e
    .get('/search')
    .query(
      z.object({
        q: z.string(),
        page: z.coerce.number().default(1),
        limit: z.coerce.number().default(10),
      }),
    )
    .output(z.object({ results: z.array(z.unknown()) }))
    .handle(async () => ({ results: [] }));

  const adaptor = new TestEndpointAdaptor(queryEndpoint);

  bench('GET with query params', async () => {
    await adaptor.request({
      services: {},
      headers: {},
      query: { q: 'test', page: 2, limit: 20 },
    });
  });
});
