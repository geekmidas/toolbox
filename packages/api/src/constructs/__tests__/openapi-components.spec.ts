import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { Endpoint } from '../Endpoint';
import { buildOpenApiSchema } from '../openapi';

describe('OpenAPI Components', () => {
  it('should extract schemas with metadata to components section', async () => {
    // Define reusable schemas with metadata
    const UserSchema = z
      .object({
        id: z.string(),
        name: z.string(),
        email: z.email(),
      })
      .meta({ id: 'User' });

    const CreateUserSchema = z
      .object({
        name: z.string(),
        email: z.email(),
      })
      .meta({ id: 'CreateUser' });

    // Create endpoints using the schemas
    const getUserEndpoint = new Endpoint({
      route: '/users/:id',
      method: 'GET',
      input: {
        params: z.object({ id: z.string() }),
      },
      output: UserSchema,
      fn: async () => ({
        id: '123',
        name: 'John Doe',
        email: 'john@example.com',
      }),
      authorize: undefined,
      description: undefined,
      timeout: undefined,
      services: [],
      status: undefined,
      getSession: undefined,
      logger: {} as any,
    });

    const createUserEndpoint = new Endpoint({
      route: '/users',
      method: 'POST',
      input: {
        body: CreateUserSchema,
      },
      output: UserSchema,
      fn: async ({ body }) => ({
        id: '123',
        ...body,
      }),
      authorize: undefined,
      description: undefined,
      timeout: undefined,
      services: [],
      status: undefined,
      getSession: undefined,
      logger: {} as any,
    });

    // Generate OpenAPI schema
    const openApiSchema = await buildOpenApiSchema(
      [getUserEndpoint, createUserEndpoint],
      {
        title: 'User API',
        version: '1.0.0',
      },
    );

    // Verify components section was created
    expect(openApiSchema.components).toBeDefined();
    expect(openApiSchema.components?.schemas).toBeDefined();
    expect(openApiSchema.components?.schemas?.User).toBeDefined();
    expect(openApiSchema.components?.schemas?.CreateUser).toBeDefined();

    // Verify the schemas in components
    expect(openApiSchema.components?.schemas?.User).toMatchObject({
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
      },
      required: ['id', 'name', 'email'],
    });

    // Verify references are used in paths
    const getUserResponse =
      openApiSchema.paths?.['/users/{id}']?.get?.responses?.['200'];
    expect(
      (getUserResponse as any)?.content?.['application/json']?.schema,
    ).toEqual({
      $ref: '#/components/schemas/User',
    });

    const createUserRequest =
      openApiSchema.paths?.['/users']?.post?.requestBody;
    expect(
      (createUserRequest as any)?.content?.['application/json']?.schema,
    ).toEqual({
      $ref: '#/components/schemas/CreateUser',
    });

    const createUserResponse =
      openApiSchema.paths?.['/users']?.post?.responses?.['200'];
    expect(
      (createUserResponse as any)?.content?.['application/json']?.schema,
    ).toEqual({
      $ref: '#/components/schemas/User',
    });
  });

  it('should handle schemas without metadata normally', async () => {
    const endpoint = new Endpoint({
      route: '/health',
      method: 'GET',
      output: z.object({
        status: z.string(),
      }),
      fn: async () => ({ status: 'ok' }),
      authorize: undefined,
      description: undefined,
      timeout: undefined,
      input: undefined,
      services: [],
      status: undefined,
      getSession: undefined,
      logger: {} as any,
    });

    const openApiSchema = await buildOpenApiSchema([endpoint]);

    // Should not have components when no schemas have metadata
    expect(openApiSchema.components).toBeUndefined();

    // Should have inline schema
    const response = openApiSchema.paths?.['/health']?.get?.responses?.['200'];
    expect(
      (response as any)?.content?.['application/json']?.schema,
    ).toMatchObject({
      type: 'object',
      properties: {
        status: { type: 'string' },
      },
      required: ['status'],
    });
  });

  it('should handle mixed schemas (with and without metadata)', async () => {
    const SharedErrorSchema = z
      .object({
        code: z.string(),
        message: z.string(),
      })
      .meta({ id: 'Error' });

    const endpoint1 = new Endpoint({
      route: '/test1',
      method: 'POST',
      input: {
        body: SharedErrorSchema,
      },
      output: z.object({ success: z.boolean() }),
      fn: async () => ({ success: true }),
      authorize: undefined,
      description: undefined,
      timeout: undefined,
      services: [],
      status: undefined,
      getSession: undefined,
      logger: {} as any,
    });

    const endpoint2 = new Endpoint({
      route: '/test2',
      method: 'GET',
      output: SharedErrorSchema,
      fn: async () => ({ code: 'TEST', message: 'Test error' }),
      authorize: undefined,
      description: undefined,
      timeout: undefined,
      input: undefined,
      services: [],
      status: undefined,
      getSession: undefined,
      logger: {} as any,
    });

    const openApiSchema = await buildOpenApiSchema([endpoint1, endpoint2]);

    // Should have components with the Error schema
    expect(openApiSchema.components?.schemas?.Error).toBeDefined();

    // First endpoint should use reference for body, inline for output
    const post1 = openApiSchema.paths?.['/test1']?.post;
    expect(
      (post1?.requestBody as any)?.content?.['application/json']?.schema,
    ).toEqual({
      $ref: '#/components/schemas/Error',
    });
    expect(
      (post1?.responses?.['200'] as any)?.content?.['application/json']?.schema,
    ).toMatchObject({
      type: 'object',
      properties: { success: { type: 'boolean' } },
    });

    // Second endpoint should use reference for output
    const get2 = openApiSchema.paths?.['/test2']?.get;
    expect(
      (get2?.responses?.['200'] as any)?.content?.['application/json']?.schema,
    ).toEqual({
      $ref: '#/components/schemas/Error',
    });
  });
});
