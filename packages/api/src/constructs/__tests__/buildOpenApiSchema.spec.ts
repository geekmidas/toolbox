import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { Endpoint } from '../Endpoint';

describe('buildOpenApiSchema', () => {
  it('should generate OpenAPI document with basic endpoints', async () => {
    const endpoints = [
      new Endpoint({
        route: '/users',
        method: 'GET',
        description: 'Get all users',
        fn: async () => [],
        input: undefined,
        output: z.array(z.object({ id: z.string(), name: z.string() })),
        services: [],
        logger: {} as any,
        timeout: undefined,
        status: undefined,
        authorize: undefined,
        getSession: undefined,
      }),
      new Endpoint({
        route: '/users/:id',
        method: 'GET',
        description: 'Get user by ID',
        fn: async () => ({ id: '1', name: 'John' }),
        input: {
          params: z.object({ id: z.string() }),
        },
        output: z.object({ id: z.string(), name: z.string() }),
        services: [],
        logger: {} as any,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
      }),
    ];

    const schema = await Endpoint.buildOpenApiSchema(endpoints);

    expect(schema).toMatchObject({
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
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' },
                        },
                        required: ['id', 'name'],
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/users/{id}': {
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          get: {
            description: 'Get user by ID',
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
                      },
                      required: ['id', 'name'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('should use provided options for title, version, and description', async () => {
    const endpoints = [
      new Endpoint({
        route: '/health',
        method: 'GET',
        fn: async () => ({ status: 'ok' }),
        input: undefined,
        output: undefined,
        services: [],
        logger: {} as any,
        timeout: undefined,
        authorize: undefined,
        description: undefined,
        status: undefined,
        getSession: undefined,
      }),
    ];

    const schema = await Endpoint.buildOpenApiSchema(endpoints, {
      title: 'My Custom API',
      version: '2.5.0',
      description: 'This is my custom API description',
    });

    expect(schema.info).toEqual({
      title: 'My Custom API',
      version: '2.5.0',
      description: 'This is my custom API description',
    });
  });

  it('should merge multiple methods on the same path', async () => {
    const endpoints = [
      new Endpoint({
        route: '/users',
        method: 'GET',
        description: 'List users',
        fn: async () => [],
        input: undefined,
        output: z.array(z.object({ id: z.string() })),
        services: [],
        logger: {} as any,
        authorize: undefined,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
      }),
      new Endpoint({
        route: '/users',
        method: 'POST',
        description: 'Create user',
        fn: async (ctx) => ({ id: '1', ...(ctx as any).body }),
        input: {
          body: z.object({ name: z.string(), email: z.email() }),
        },
        authorize: undefined,
        output: z.object({
          id: z.string(),
          name: z.string(),
          email: z.string(),
        }),
        services: [],
        logger: {} as any,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
      }),
    ];

    const schema = await Endpoint.buildOpenApiSchema(endpoints);

    expect(schema.paths?.['/users']).toHaveProperty('get');
    expect(schema.paths?.['/users']).toHaveProperty('post');
    expect(schema.paths?.['/users']!.get!.description).toBe('List users');
    expect(schema.paths?.['/users']!.post!.description).toBe('Create user');
  });

  it('should handle empty endpoints array', async () => {
    const schema = await Endpoint.buildOpenApiSchema([]);

    expect(schema).toEqual({
      openapi: '3.0.0',
      info: {
        title: 'API',
        version: '1.0.0',
      },
      paths: {},
    });
  });

  it('should generate schema with all input types', async () => {
    const endpoint = new Endpoint({
      route: '/users/:userId/items/:itemId',
      method: 'PUT',
      description: 'Update user item',
      fn: async (ctx) => ({
        id: (ctx as any).params.itemId,
        userId: (ctx as any).params.userId,
        ...(ctx as any).body,
      }),
      authorize: undefined,
      input: {
        params: z.object({
          userId: z.string(),
          itemId: z.string(),
        }),
        query: z.object({
          includeMetadata: z.boolean().optional(),
          fields: z.array(z.string()).optional(),
        }),
        body: z.object({
          name: z.string(),
          description: z.string().optional(),
          price: z.number().positive(),
        }),
      },
      output: z.object({
        id: z.string(),
        userId: z.string(),
        name: z.string(),
        description: z.string().optional(),
        price: z.number(),
      }),
      services: [],
      logger: {} as any,
      timeout: undefined,
      status: undefined,
      getSession: undefined,
    });

    const schema = await Endpoint.buildOpenApiSchema([endpoint]);

    const route = schema.paths?.['/users/{userId}/items/{itemId}']!;
    const operation = route.put!;

    // Check path parameters at route level
    expect(route.parameters).toBeDefined();
    expect(route.parameters).toHaveLength(2);
    expect(route.parameters).toContainEqual({
      name: 'userId',
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });
    expect(route.parameters).toContainEqual({
      name: 'itemId',
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });

    // Check query parameters at operation level
    expect(operation.parameters).toBeDefined();
    expect(operation.parameters).toHaveLength(2);
    expect(operation.parameters).toContainEqual({
      name: 'includeMetadata',
      in: 'query',
      required: false,
      schema: { type: 'boolean' },
    });
    expect(operation.parameters).toContainEqual({
      name: 'fields',
      in: 'query',
      required: false,
      schema: { type: 'array', items: { type: 'string' } },
    });

    // Check request body
    expect(operation.requestBody).toMatchObject({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              price: { type: 'number' },
            },
            required: ['name', 'price'],
          },
        },
      },
    });

    // Check response
    expect(
      (operation.responses['200'] as any).content['application/json'].schema,
    ).toMatchObject({
      type: 'object',
      properties: {
        id: { type: 'string' },
        userId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        price: { type: 'number' },
      },
      required: ['id', 'userId', 'name', 'price'],
    });
  });

  it('should handle PATCH method with body', async () => {
    const endpoint = new Endpoint({
      route: '/users/:id',
      method: 'PATCH',
      description: 'Partially update user',
      authorize: undefined,
      fn: async (ctx) => ({ id: (ctx as any).params.id, ...(ctx as any).body }),
      input: {
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().optional(),
          email: z.string().email().optional(),
        }),
      },
      output: undefined,
      services: [],
      logger: {} as any,
      timeout: undefined,
      status: undefined,
      getSession: undefined,
    });

    const schema = await Endpoint.buildOpenApiSchema([endpoint]);
    const operation = schema.paths?.['/users/{id}']!.patch!;

    expect(operation).toHaveProperty('requestBody');
    expect(operation.requestBody).toMatchObject({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string', format: 'email' },
            },
          },
        },
      },
    });
  });

  it('should handle DELETE method with path params only', async () => {
    const endpoint = new Endpoint({
      route: '/users/:id',
      method: 'DELETE',
      authorize: undefined,
      description: 'Delete user',
      fn: async () => {},
      input: {
        params: z.object({ id: z.string() }),
      },
      output: undefined,
      services: [],
      logger: {} as any,
      timeout: undefined,
      status: undefined,
      getSession: undefined,
    });

    const schema = await Endpoint.buildOpenApiSchema([endpoint]);
    const route = schema.paths?.['/users/{id}']!;
    const operation = route.delete!;

    expect(operation.description).toBe('Delete user');
    // Path parameters should be at route level
    expect(route.parameters).toBeDefined();
    expect(route.parameters).toHaveLength(1);
    expect(route.parameters![0]).toEqual({
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });
    // Operation should not have parameters
    expect(operation.parameters).toBeUndefined();
    expect(operation).not.toHaveProperty('requestBody');
  });

  it('should handle complex nested schemas', async () => {
    const endpoint = new Endpoint({
      route: '/organizations/:orgId/projects',
      method: 'POST',
      authorize: undefined,
      description: 'Create project',
      fn: async (ctx) => ({ id: '1', ...(ctx as any).body }),
      input: {
        params: z.object({ orgId: z.string() }),
        body: z.object({
          name: z.string(),
          settings: z.object({
            isPublic: z.boolean(),
            maxMembers: z.number().positive(),
            features: z.array(z.enum(['issue-tracking', 'wiki', 'ci-cd'])),
          }),
          metadata: z.record(z.string(), z.any()).optional(),
        }),
      },
      output: z.object({
        id: z.string(),
        name: z.string(),
        createdAt: z.string(),
      }),
      services: [],
      logger: {} as any,
      timeout: undefined,
      status: undefined,
      getSession: undefined,
    });

    const schema = await Endpoint.buildOpenApiSchema([endpoint]);
    const operation = schema.paths?.['/organizations/{orgId}/projects']!.post!;

    expect(
      (operation.requestBody as any).content['application/json'].schema,
    ).toMatchObject({
      type: 'object',
      properties: {
        name: { type: 'string' },
        settings: {
          type: 'object',
          properties: {
            isPublic: { type: 'boolean' },
            maxMembers: { type: 'number' },
            features: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['issue-tracking', 'wiki', 'ci-cd'],
              },
            },
          },
          required: ['isPublic', 'maxMembers', 'features'],
        },
        metadata: {
          type: 'object',
          additionalProperties: {},
        },
      },
      required: ['name', 'settings'],
    });
  });

  it('should handle route with multiple parameters', async () => {
    const endpoint = new Endpoint({
      route: '/orgs/:orgId/teams/:teamId/members/:userId',
      method: 'GET',
      description: 'Get team member details',
      fn: async () => ({}),
      input: {
        params: z.object({
          orgId: z.string(),
          teamId: z.string(),
          userId: z.string(),
        }),
      },
      output: undefined,
      services: [],
      logger: {} as any,
      authorize: undefined,
      timeout: undefined,
      status: undefined,
      getSession: undefined,
    });

    const schema = await Endpoint.buildOpenApiSchema([endpoint]);
    const path = '/orgs/{orgId}/teams/{teamId}/members/{userId}';
    const route = schema.paths?.[path]!;
    const operation = route.get!;

    // Path parameters should be at route level
    expect(route.parameters).toBeDefined();
    expect(route.parameters).toHaveLength(3);
    expect(route.parameters).toContainEqual({
      name: 'orgId',
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });
    expect(route.parameters).toContainEqual({
      name: 'teamId',
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });
    expect(route.parameters).toContainEqual({
      name: 'userId',
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });
    // Operation should not have parameters since all are path params
    expect(operation.parameters).toBeUndefined();
  });

  it('should not include info description when not provided', async () => {
    const endpoints = [
      new Endpoint({
        route: '/test',
        method: 'GET',
        fn: async () => {},
        authorize: undefined,
        input: undefined,
        output: undefined,
        services: [],
        logger: {} as any,
        timeout: undefined,
        description: undefined,
        status: undefined,
        getSession: undefined,
      }),
    ];

    const schema = await Endpoint.buildOpenApiSchema(endpoints, {
      title: 'Test API',
      version: '1.0.0',
    });

    expect(schema.info).toEqual({
      title: 'Test API',
      version: '1.0.0',
    });
    expect(schema.info).not.toHaveProperty('description');
  });
});
