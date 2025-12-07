import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { Endpoint, e } from '../';

import { HonoEndpoint } from '../HonoEndpointAdaptor';

describe('HonoEndpoint OpenAPI Documentation', () => {
  const logger = {
    child: () => logger,
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  } as unknown as Logger;
  const mockEnvParser = {} as EnvironmentParser<{}>;

  it('should generate OpenAPI documentation at /docs by default', async () => {
    // Create test endpoints
    const getUserEndpoint = new Endpoint({
      route: '/users/:id',
      method: 'GET',
      fn: async ({ params }) => ({ id: params.id, name: 'John Doe' }),
      input: {
        params: z.object({
          id: z.string().describe('User ID'),
        }),
      },
      output: z.object({
        id: z.string(),
        name: z.string(),
      }),
      description: 'Get user by ID',
      services: [],
      logger,
      timeout: undefined,
        memorySize: undefined,
      authorize: undefined,
      getSession: undefined,
      status: undefined,
    });

    const createUserEndpoint = e
      .post('/users')
      .description('Create a new user')
      .body(
        z.object({
          name: z.string().describe('User name'),
        }),
      )
      .output(
        z.object({
          id: z.string(),
          name: z.string(),
        }),
      )
      .handle(({ body }) => ({ id: '123', name: body.name }));

    const endpoints = [getUserEndpoint, createUserEndpoint] as Endpoint<
      any,
      any,
      any,
      any,
      any,
      any,
      any
    >[];

    const app = new Hono();

    // Manually add routes for testing
    HonoEndpoint.addRoutes(
      endpoints,
      { register: async () => ({}) } as any,
      app,
    );

    // Test the docs endpoint
    const response = await app.request('/docs');
    expect(response.status).toBe(200);

    const openApiSchema = await response.json();
    expect(openApiSchema).toMatchObject({
      openapi: '3.0.0',
      info: {
        title: 'API',
        version: '1.0.0',
      },
      paths: {
        '/users/{id}': {
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: expect.objectContaining({
                type: 'string',
                description: 'User ID',
              }),
            },
          ],
          get: {
            description: 'Get user by ID',
            responses: {
              '200': expect.objectContaining({
                description: 'Successful response',
              }),
            },
          },
        },
        '/users': {
          post: {
            description: 'Create a new user',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: expect.any(Object),
                },
              },
            },
            responses: {
              '200': expect.objectContaining({
                description: 'Successful response',
              }),
            },
          },
        },
      },
    });
  });

  it('should allow custom docs path', async () => {
    const endpoint = new Endpoint({
      route: '/test',
      method: 'GET',
      fn: async () => ({ message: 'test' }),
      output: z.object({ message: z.string() }),
      services: [],
      logger,
      timeout: undefined,
        memorySize: undefined,
      authorize: undefined,
      getSession: undefined,
      status: undefined,
      description: undefined,
      input: undefined,
    });

    const endpoints = [endpoint] as Endpoint<
      any,
      any,
      any,
      any,
      any,
      any,
      any
    >[];

    const app = new Hono();
    HonoEndpoint.addRoutes(
      endpoints,
      { register: async () => ({}) } as any,
      app,
      { docsPath: '/api-docs' },
    );

    const response = await app.request('/api-docs');
    expect(response.status).toBe(200);

    const openApiSchema = await response.json();
    expect(openApiSchema.paths).toHaveProperty('/test');
  });

  it('should disable docs route when docsPath is false', async () => {
    const endpoint = new Endpoint({
      route: '/test',
      method: 'GET',
      fn: async () => ({ message: 'test' }),
      services: [],
      logger,
      timeout: undefined,
        memorySize: undefined,
      authorize: undefined,
      getSession: undefined,
      status: undefined,
      description: undefined,
      input: undefined,
      output: undefined,
    });

    const endpoints = [endpoint] as Endpoint<
      any,
      any,
      any,
      any,
      any,
      any,
      any
    >[];

    const app = new Hono();
    HonoEndpoint.addRoutes(
      endpoints,
      { register: async () => ({}) } as any,
      app,
      { docsPath: false },
    );

    const response = await app.request('/docs');
    expect(response.status).toBe(404);
  });

  it('should include custom OpenAPI options', async () => {
    const endpoint = new Endpoint({
      route: '/test',
      method: 'GET',
      fn: async () => ({ message: 'test' }),
      services: [],
      logger,
      timeout: undefined,
        memorySize: undefined,
      authorize: undefined,
      getSession: undefined,
      status: undefined,
      description: undefined,
      input: undefined,
      output: undefined,
    });
    const endpoints = [endpoint] as Endpoint<
      any,
      any,
      any,
      any,
      any,
      any,
      any
    >[];

    const app = new Hono();
    HonoEndpoint.addRoutes(
      endpoints,
      { register: async () => ({}) } as any,
      app,
      {
        openApiOptions: {
          title: 'My Custom API',
          version: '2.0.0',
          description: 'This is a custom API description',
        },
      },
    );

    const response = await app.request('/docs');
    const openApiSchema = await response.json();

    expect(openApiSchema.info).toEqual({
      title: 'My Custom API',
      version: '2.0.0',
      description: 'This is a custom API description',
    });
  });

  it('should include tags in OpenAPI documentation', async () => {
    const userEndpoint = e
      .get('/users/:id')
      .description('Get user by ID')
      .tags(['users', 'profile'])
      .params(z.object({ id: z.string().describe('User ID') }))
      .output(z.object({ id: z.string(), name: z.string() }))
      .handle(({ params }) => ({ id: params.id, name: 'John Doe' }));

    const adminEndpoint = e
      .post('/admin/settings')
      .description('Update admin settings')
      .tags(['admin', 'settings'])
      .body(z.object({ setting: z.string() }))
      .output(z.object({ success: z.boolean() }))
      .handle(() => ({ success: true }));

    const endpoints = [userEndpoint, adminEndpoint] as Endpoint<
      any,
      any,
      any,
      any,
      any,
      any,
      any
    >[];

    const app = new Hono();
    HonoEndpoint.addRoutes(
      endpoints,
      { register: async () => ({}) } as any,
      app,
    );

    const response = await app.request('/docs');
    expect(response.status).toBe(200);

    const openApiSchema = await response.json();

    // Check that the user endpoint has the correct tags
    expect(openApiSchema.paths['/users/{id}'].get.tags).toEqual([
      'users',
      'profile',
    ]);

    // Check that the admin endpoint has the correct tags
    expect(openApiSchema.paths['/admin/settings'].post.tags).toEqual([
      'admin',
      'settings',
    ]);
  });
});
