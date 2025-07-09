import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { Endpoint } from '../Endpoint';
import { buildOpenApiSchema } from '../openapi';

describe('buildOpenApiSchema', () => {
  it('should generate empty OpenAPI schema for no endpoints', async () => {
    const schema = await buildOpenApiSchema([]);

    expect(schema).toEqual({
      openapi: '3.0.0',
      info: {
        title: 'API',
        version: '1.0.0',
      },
      paths: {},
    });
  });

  it('should use custom title and version from options', async () => {
    const schema = await buildOpenApiSchema([], {
      title: 'My Custom API',
      version: '2.1.0',
      description: 'A custom API description',
    });

    expect(schema).toEqual({
      openapi: '3.0.0',
      info: {
        title: 'My Custom API',
        version: '2.1.0',
        description: 'A custom API description',
      },
      paths: {},
    });
  });

  it('should generate OpenAPI schema for single endpoint', async () => {
    const endpoint = new Endpoint({
      route: '/users',
      method: 'GET',
      description: 'Get all users',
      fn: async () => [],
      input: undefined,
      outputSchema: undefined,
      services: [],
      logger: {} as any,
      timeout: undefined,
    });

    const schema = await buildOpenApiSchema([endpoint]);

    expect(schema).toEqual({
      openapi: '3.0.0',
      info: {
        title: 'API',
        version: '1.0.0',
      },
      paths: {
        '/users': {
          get: {
            description: 'Get all users',
            responses: {
              '200': {
                description: 'Successful response',
              },
            },
          },
        },
      },
    });
  });

  it('should generate OpenAPI schema for multiple endpoints on same route', async () => {
    const getEndpoint = new Endpoint({
      route: '/users',
      method: 'GET',
      description: 'Get all users',
      fn: async () => [],
      input: undefined,
      outputSchema: undefined,
      services: [],
      logger: {} as any,
      timeout: undefined,
    });

    const postEndpoint = new Endpoint({
      route: '/users',
      method: 'POST',
      description: 'Create a user',
      fn: async () => ({ id: '1' }),
      input: {
        body: z.object({ name: z.string() }),
      },
      outputSchema: undefined,
      services: [],
      logger: {} as any,
      timeout: undefined,
    });

    const schema = await buildOpenApiSchema([getEndpoint, postEndpoint]);

    expect(schema.paths!['/users']).toMatchObject({
      get: {
        description: 'Get all users',
        responses: {
          '200': {
            description: 'Successful response',
          },
        },
      },
      post: {
        description: 'Create a user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                },
                required: ['name'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Successful response',
          },
        },
      },
    });
  });

  it('should generate OpenAPI schema for multiple endpoints on different routes', async () => {
    const usersEndpoint = new Endpoint({
      route: '/users',
      method: 'GET',
      description: 'Get all users',
      fn: async () => [],
      input: undefined,
      outputSchema: undefined,
      services: [],
      logger: {} as any,
      timeout: undefined,
    });

    const postsEndpoint = new Endpoint({
      route: '/posts',
      method: 'GET',
      description: 'Get all posts',
      fn: async () => [],
      input: undefined,
      outputSchema: undefined,
      services: [],
      logger: {} as any,
      timeout: undefined,
    });

    const schema = await buildOpenApiSchema([usersEndpoint, postsEndpoint]);

    expect(schema.paths!).toEqual({
      '/users': {
        get: {
          description: 'Get all users',
          responses: {
            '200': {
              description: 'Successful response',
            },
          },
        },
      },
      '/posts': {
        get: {
          description: 'Get all posts',
          responses: {
            '200': {
              description: 'Successful response',
            },
          },
        },
      },
    });
  });

  it('should generate OpenAPI schema with complex endpoints', async () => {
    const outputSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
    });

    const createUserEndpoint = new Endpoint({
      route: '/users',
      method: 'POST',
      description: 'Create a new user',
      fn: async (ctx) => ({ id: '1', ...(ctx as any).body }),
      input: {
        body: z.object({
          name: z.string(),
          email: z.string().email(),
        }),
      },
      outputSchema,
      services: [],
      logger: {} as any,
      timeout: undefined,
    });

    const getUserEndpoint = new Endpoint({
      route: '/users/:id',
      method: 'GET',
      description: 'Get user by ID',
      fn: async (ctx) => ({
        id: (ctx as any).params.id,
        name: 'John',
        email: 'john@example.com',
      }),
      input: {
        params: z.object({ id: z.string() }),
        search: z.object({ include: z.array(z.string()).optional() }),
      },
      outputSchema,
      services: [],
      logger: {} as any,
      timeout: undefined,
    });

    const schema = await buildOpenApiSchema([
      createUserEndpoint,
      getUserEndpoint,
    ]);

    expect(schema.paths!['/users']).toMatchObject({
      post: {
        description: 'Create a new user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                },
                required: ['name', 'email'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    email: { type: 'string' },
                  },
                  required: ['id', 'name', 'email'],
                },
              },
            },
          },
        },
      },
    });

    expect(schema.paths!['/users/:id']).toMatchObject({
      get: {
        description: 'Get user by ID',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'include',
            in: 'query',
            required: false,
            schema: { type: 'array', items: { type: 'string' } },
          },
        ],
        responses: {
          '200': {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    email: { type: 'string' },
                  },
                  required: ['id', 'name', 'email'],
                },
              },
            },
          },
        },
      },
    });
  });

  it('should handle mixed HTTP methods correctly', async () => {
    const endpoints = [
      new Endpoint({
        route: '/users/:id',
        method: 'GET',
        description: 'Get user',
        fn: async () => ({ id: '1' }),
        input: { params: z.object({ id: z.string() }) },
        outputSchema: undefined,
        services: [],
        logger: {} as any,
        timeout: undefined,
      }),
      new Endpoint({
        route: '/users/:id',
        method: 'PUT',
        description: 'Update user',
        fn: async () => ({ id: '1' }),
        input: {
          params: z.object({ id: z.string() }),
          body: z.object({ name: z.string() }),
        },
        outputSchema: undefined,
        services: [],
        logger: {} as any,
        timeout: undefined,
      }),
      new Endpoint({
        route: '/users/:id',
        method: 'DELETE',
        description: 'Delete user',
        fn: async () => undefined,
        input: { params: z.object({ id: z.string() }) },
        outputSchema: undefined,
        services: [],
        logger: {} as any,
        timeout: undefined,
      }),
    ];

    const schema = await buildOpenApiSchema(endpoints);

    expect(Object.keys(schema.paths!['/users/:id']!)).toEqual([
      'get',
      'put',
      'delete',
    ]);
    expect(schema.paths!['/users/:id']!.get!.description).toBe('Get user');
    expect(schema.paths!['/users/:id']!.put!.description).toBe('Update user');
    expect(schema.paths!['/users/:id']!.delete!.description).toBe(
      'Delete user',
    );
  });
});
