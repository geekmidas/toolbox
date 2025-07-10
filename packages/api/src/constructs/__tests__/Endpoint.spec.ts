import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { Endpoint } from '../Endpoint';

describe('Endpoint', () => {
  describe('toOpenApi3Route', () => {
    it('should generate basic OpenAPI spec for GET endpoint', async () => {
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

      const spec = await endpoint.toOpenApi3Route();

      expect(spec).toEqual({
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
      });
    });

    it('should include response schema when output is defined', async () => {
      const outputSchema = z.object({
        id: z.string(),
        name: z.string(),
      });

      const endpoint = new Endpoint({
        route: '/users/:id',
        method: 'GET',
        description: 'Get user by ID',
        fn: async () => ({ id: '1', name: 'John' }),
        input: undefined,
        outputSchema,
        services: [],
        logger: {} as any,
        timeout: undefined,
      });

      const spec = await endpoint.toOpenApi3Route();

      expect(spec['/users/:id'].get.responses?.['200']).toHaveProperty(
        'content',
      );
      expect(
        (spec['/users/:id'].get.responses?.['200'] as any).content[
          'application/json'
        ].schema,
      ).toMatchObject({
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id', 'name'],
      });
    });

    it('should include request body for POST endpoint', async () => {
      const bodySchema = z.object({
        name: z.string(),
        email: z.string().email(),
      });

      const endpoint = new Endpoint({
        route: '/users',
        method: 'POST',
        description: 'Create a new user',
        fn: async (ctx) => ({ id: '1', ...(ctx as any).body }),
        input: {
          body: bodySchema,
        },
        outputSchema: undefined,
        services: [],
        logger: {} as any,
        timeout: undefined,
      });

      const spec = await endpoint.toOpenApi3Route();

      expect(spec['/users']!.post).toHaveProperty('requestBody');
      expect((spec['/users']!.post! as any).requestBody).toMatchObject({
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
      });
    });

    it('should include path parameters', async () => {
      const paramsSchema = z.object({
        id: z.string(),
        subId: z.string().optional(),
      });

      const endpoint = new Endpoint({
        route: '/users/:id/items/:subId',
        method: 'GET',
        description: 'Get user item',
        fn: async (ctx) => ({
          userId: (ctx as any).params.id,
          itemId: (ctx as any).params.subId,
        }),
        input: {
          params: paramsSchema,
        },
        outputSchema: undefined,
        services: [],
        logger: {} as any,
        timeout: undefined,
      });

      const spec = await endpoint.toOpenApi3Route();

      const doc = spec['/users/{id}/items/{subId}'];

      expect(doc.get).toHaveProperty('parameters');
      const parameters = doc.get.parameters;

      expect(parameters).toHaveLength(2);
      expect(parameters).toContainEqual({
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      });
      expect(parameters).toContainEqual({
        name: 'subId',
        in: 'path',
        required: false,
        schema: { type: 'string' },
      });
    });

    it('should include query parameters', async () => {
      const searchSchema = z.object({
        page: z.number().optional(),
        limit: z.number().optional(),
        sort: z.enum(['asc', 'desc']),
      });

      const endpoint = new Endpoint({
        route: '/users',
        method: 'GET',
        description: 'List users with pagination',
        fn: async (ctx) => [],
        input: {
          query: searchSchema,
        },
        outputSchema: undefined,
        services: [],
        logger: {} as any,
        timeout: undefined,
      });

      const spec = await endpoint.toOpenApi3Route();

      expect(spec['/users']!.get).toHaveProperty('parameters');
      const parameters = (spec['/users']!.get! as any).parameters;

      expect(parameters).toHaveLength(3);
      expect(parameters).toContainEqual({
        name: 'page',
        in: 'query',
        required: false,
        schema: { type: 'number' },
      });
      expect(parameters).toContainEqual({
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'number' },
      });
      expect(parameters).toContainEqual({
        name: 'sort',
        in: 'query',
        required: true,
        schema: { type: 'string', enum: ['asc', 'desc'] },
      });
    });

    it('should handle PUT endpoint with body and params', async () => {
      const bodySchema = z.object({
        name: z.string(),
        email: z.string().email(),
      });
      const paramsSchema = z.object({
        id: z.string(),
      });
      const outputSchema = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
        updatedAt: z.string(),
      });

      const endpoint = new Endpoint({
        route: '/users/:id',
        method: 'PUT',
        description: 'Update user',
        fn: async (ctx) => ({
          id: (ctx as any).params.id,
          ...(ctx as any).body,
          updatedAt: new Date().toISOString(),
        }),
        input: {
          body: bodySchema,
          params: paramsSchema,
        },
        outputSchema,
        services: [],
        logger: {} as any,
        timeout: undefined,
      });

      const spec = await endpoint.toOpenApi3Route();

      // Check request body
      expect(spec['/users/:id']!.put).toHaveProperty('requestBody');
      expect(
        (spec['/users/:id']!.put! as any).requestBody.content[
          'application/json'
        ].schema,
      ).toMatchObject({
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
        },
      });

      // Check parameters
      expect((spec['/users/:id']!.put! as any).parameters).toHaveLength(1);
      expect((spec['/users/:id']!.put! as any).parameters[0]).toEqual({
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      });

      // Check response
      expect(
        (spec['/users/:id']!.put!.responses['200'] as any).content[
          'application/json'
        ].schema,
      ).toMatchObject({
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
          updatedAt: { type: 'string' },
        },
      });
    });

    it('should handle endpoint without any schemas', async () => {
      const endpoint = new Endpoint({
        route: '/health',
        method: 'GET',
        fn: async () => ({ status: 'ok' }),
        input: undefined,
        outputSchema: undefined,
        services: [],
        logger: {} as any,
        timeout: undefined,
        description: undefined,
      });

      const spec = await endpoint.toOpenApi3Route();

      expect(spec).toEqual({
        '/health': {
          get: {
            responses: {
              '200': {
                description: 'Successful response',
              },
            },
          },
        },
      });
    });

    it('should not include body for GET endpoint even if provided', async () => {
      const bodySchema = z.object({ invalid: z.string() });

      const endpoint = new Endpoint({
        route: '/users',
        method: 'GET',
        fn: async () => [],
        input: {
          body: bodySchema,
        },
        outputSchema: undefined,
        services: [],
        logger: {} as any,
        timeout: undefined,
        description: undefined,
      });

      const spec = await endpoint.toOpenApi3Route();

      expect(spec['/users']!.get).not.toHaveProperty('requestBody');
    });
  });
});
