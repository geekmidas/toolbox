import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Endpoint } from '../constructs/Endpoint';
import { e } from '../constructs/EndpointFactory';
import { ConsoleLogger } from '../logger';
import { ServiceDiscovery } from '../services';
import { HonoEndpoint } from './HonoEndpoint';

describe('HonoEndpoint route precedence', () => {
  it('should register static routes before dynamic routes', async () => {
    const app = new Hono();
    const logger = new ConsoleLogger();
    const serviceDiscovery = ServiceDiscovery.getInstance(logger, {} as any);

    // Create endpoints with conflicting routes
    const endpoints = [
      e
        .get('/jobs/:id')
        .params(z.object({ id: z.string() }))
        .output(z.object({ id: z.string() }))
        .handle(async ({ params }) => ({ id: params.id })),
      e.get('/jobs/me')
        .output(z.object({ id: z.string() }))
        .handle(async () => ({ id: 'current-user' })),
    ] as Endpoint<any, any, any, any, any, any>[];

    // Add routes to Hono app
    HonoEndpoint.addRoutes(endpoints, serviceDiscovery, app);

    // Test that /jobs/me returns the static route response
    const meResponse = await app.request('/jobs/me');
    const meData = await meResponse.json();
    expect(meData).toEqual({ id: 'current-user' });

    // Test that /jobs/123 returns the dynamic route response
    const idResponse = await app.request('/jobs/123');
    const idData = await idResponse.json();
    expect(idData).toEqual({ id: '123' });
  });

  it('should handle complex route precedence correctly', async () => {
    const app = new Hono();
    const logger = new ConsoleLogger();
    const serviceDiscovery = ServiceDiscovery.getInstance(logger, {} as any);

    // Create endpoints with various route patterns
    const endpoints = [
      e
        .get('/api/users/:userId/posts/:postId')
        .params(z.object({ userId: z.string(), postId: z.string() }))
        .output(z.object({ type: z.string(), userId: z.string(), postId: z.string() }))
        .handle(async ({ params }) => ({
          type: 'dynamic-both',
          userId: params.userId,
          postId: params.postId,
        })),
      e
        .get('/api/users/me/posts/:postId')
        .params(z.object({ postId: z.string() }))
        .output(z.object({ type: z.string(), postId: z.string() }))
        .handle(async ({ params }) => ({
          type: 'static-user-dynamic-post',
          postId: params.postId,
        })),
      e
        .get('/api/users/:userId/posts/featured')
        .params(z.object({ userId: z.string() }))
        .output(z.object({ type: z.string(), userId: z.string() }))
        .handle(async ({ params }) => ({
          type: 'dynamic-user-static-post',
          userId: params.userId,
        })),
      e.get('/api/users/me/posts/featured')
        .output(z.object({ type: z.string() }))
        .handle(async () => ({
          type: 'static-both',
        })),
    ] as Endpoint<any, any, any, any, any, any>[];

    // Add routes (they should be sorted automatically)
    HonoEndpoint.addRoutes(endpoints, serviceDiscovery, app);

    // Test all route variations
    const responses = await Promise.all([
      app.request('/api/users/me/posts/featured'),
      app.request('/api/users/me/posts/123'),
      app.request('/api/users/456/posts/featured'),
      app.request('/api/users/456/posts/789'),
    ]);

    const results = await Promise.all(responses.map((r) => r.json()));

    expect(results[0]).toEqual({ type: 'static-both' });
    expect(results[1]).toEqual({
      type: 'static-user-dynamic-post',
      postId: '123',
    });
    expect(results[2]).toEqual({
      type: 'dynamic-user-static-post',
      userId: '456',
    });
    expect(results[3]).toEqual({
      type: 'dynamic-both',
      userId: '456',
      postId: '789',
    });
  });

  it('should handle array query parameters correctly', async () => {
    const app = new Hono();
    const logger = new ConsoleLogger();
    const serviceDiscovery = ServiceDiscovery.getInstance(logger, {} as any);

    // Create endpoint that accepts array query parameters
    const endpoint = e
      .get('/api/search')
      .query(
        z.object({
          tags: z.array(z.string()).optional(),
          categories: z.array(z.string()).optional(),
          status: z.string().optional(),
        }),
      )
      .output(z.object({
        receivedQuery: z.object({
          tags: z.array(z.string()).optional(),
          categories: z.array(z.string()).optional(),
          status: z.string().optional(),
        })
      }))
      .handle(async ({ query }) => ({
        receivedQuery: query,
      }));

    HonoEndpoint.addRoutes(
      [endpoint] as Endpoint<any, any, any, any, any, any>[],
      serviceDiscovery,
      app,
    );

    // Test with array parameters
    const response = await app.request(
      '/api/search?tags=typescript&tags=javascript&tags=node&categories=web&categories=api&status=active',
    );
    const data = await response.json();

    expect(data).toEqual({
      receivedQuery: {
        tags: ['typescript', 'javascript', 'node'],
        categories: ['web', 'api'],
        status: 'active',
      },
    });
  });

  it('should handle mixed query parameters with arrays and nested objects', async () => {
    const app = new Hono();
    const logger = new ConsoleLogger();
    const serviceDiscovery = ServiceDiscovery.getInstance(logger, {} as any);

    // Create endpoint that accepts both arrays and nested objects
    const endpoint = e
      .get('/api/filter')
      .query(
        z.object({
          ids: z.array(z.string()),
          filter: z.object({
            status: z.string(),
            type: z.string(),
          }),
        }),
      )
      .output(z.object({
        receivedQuery: z.object({
          ids: z.array(z.string()),
          filter: z.object({
            status: z.string(),
            type: z.string(),
          }),
        })
      }))
      .handle(async ({ query }) => ({
        receivedQuery: query,
      }));

    HonoEndpoint.addRoutes(
      [endpoint] as Endpoint<any, any, any, any, any, any>[],
      serviceDiscovery,
      app,
    );

    // Test with both arrays and nested objects
    const response = await app.request(
      '/api/filter?ids=1&ids=2&ids=3&filter.status=active&filter.type=user',
    );
    const data = await response.json();

    expect(data).toEqual({
      receivedQuery: {
        ids: ['1', '2', '3'],
        filter: {
          status: 'active',
          type: 'user',
        },
      },
    });
  });
});
