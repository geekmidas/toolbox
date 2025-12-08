import { e } from '@geekmidas/constructs/endpoints';
import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import type { InferOpenApi, InferOpenApiFromEndpoint } from '../infer';

describe('InferOpenApi', () => {
  describe('single endpoint', () => {
    it('should infer OpenAPI structure for GET endpoint', () => {
      const endpoint = e
        .get('/users/{id}')
        .params(z.object({ id: z.string() }))
        .output(z.object({ id: z.string(), name: z.string() }))
        .handle(async ({ params }) => ({
          id: params.id,
          name: 'John',
        }));

      type API = InferOpenApiFromEndpoint<typeof endpoint>;

      expectTypeOf<API>().toMatchTypeOf<{
        paths: {
          '/users/{id}': {
            get: {
              responses: {
                '200': {
                  description: string;
                };
              };
            };
          };
        };
      }>();
    });

    it('should infer OpenAPI structure for POST endpoint with body', () => {
      const endpoint = e
        .post('/users')
        .body(z.object({ name: z.string(), email: z.string() }))
        .output(z.object({ id: z.string(), name: z.string() }))
        .handle(async ({ body }) => ({
          id: '123',
          name: body.name,
        }));

      type API = InferOpenApiFromEndpoint<typeof endpoint>;

      expectTypeOf<API>().toMatchTypeOf<{
        paths: {
          '/users': {
            post: {
              responses: {
                '200': {
                  description: string;
                };
              };
            };
          };
        };
      }>();
    });
  });

  describe('multiple endpoints', () => {
    it('should merge OpenAPI specs from multiple endpoints', () => {
      const getUserEndpoint = e
        .get('/users/{id}')
        .params(z.object({ id: z.string() }))
        .output(z.object({ id: z.string(), name: z.string() }))
        .handle(async ({ params }) => ({
          id: params.id,
          name: 'John',
        }));

      const createUserEndpoint = e
        .post('/users')
        .body(z.object({ name: z.string() }))
        .output(z.object({ id: z.string(), name: z.string() }))
        .handle(async ({ body }) => ({
          id: '123',
          name: body.name,
        }));

      const endpoints = [getUserEndpoint, createUserEndpoint] as const;

      type API = InferOpenApi<typeof endpoints>;

      // Should have both paths
      expectTypeOf<API>().toMatchTypeOf<{
        paths: {
          '/users/{id}': {
            get: unknown;
          };
          '/users': {
            post: unknown;
          };
        };
      }>();
    });

    it('should handle endpoints with different HTTP methods on same path', () => {
      const getUserEndpoint = e
        .get('/users')
        .output(z.object({ users: z.array(z.object({ id: z.string() })) }))
        .handle(async () => ({
          users: [],
        }));

      const createUserEndpoint = e
        .post('/users')
        .body(z.object({ name: z.string() }))
        .output(z.object({ id: z.string() }))
        .handle(async ({ body }) => ({
          id: '123',
        }));

      const endpoints = [getUserEndpoint, createUserEndpoint] as const;

      type API = InferOpenApi<typeof endpoints>;

      // Should have both methods on same path
      expectTypeOf<API>().toMatchTypeOf<{
        paths: {
          '/users': {
            get: unknown;
            post: unknown;
          };
        };
      }>();
    });
  });

  describe('complex schemas', () => {
    it('should handle endpoints with query parameters', () => {
      const endpoint = e
        .get('/users')
        .query(
          z.object({
            page: z.coerce.number().optional(),
            limit: z.coerce.number().optional(),
          }),
        )
        .output(z.object({ users: z.array(z.object({ id: z.string() })) }))
        .handle(async ({ query }) => ({
          users: [],
        }));

      type API = InferOpenApiFromEndpoint<typeof endpoint>;

      expectTypeOf<API>().toMatchTypeOf<{
        paths: {
          '/users': {
            get: {
              responses: {
                '200': unknown;
              };
            };
          };
        };
      }>();
    });

    it('should handle endpoints with body, params, and query', () => {
      const endpoint = e
        .put('/users/{id}')
        .params(z.object({ id: z.string() }))
        .query(z.object({ notify: z.coerce.boolean().optional() }))
        .body(z.object({ name: z.string() }))
        .output(z.object({ id: z.string(), name: z.string() }))
        .handle(async ({ params, body }) => ({
          id: params.id,
          name: body.name,
        }));

      type API = InferOpenApiFromEndpoint<typeof endpoint>;

      expectTypeOf<API>().toMatchTypeOf<{
        paths: {
          '/users/{id}': {
            put: {
              responses: {
                '200': unknown;
              };
            };
          };
        };
      }>();
    });
  });
});
