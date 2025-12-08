import { e } from '@geekmidas/constructs/endpoints';
import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import type { InferOpenApi } from '../infer';

describe('InferOpenApi - TypedFetcher Integration', () => {
  it('should generate paths structure compatible with TypedFetcher', () => {
    // Define some endpoints
    const getUserEndpoint = e
      .get('/users/{id}')
      .params(z.object({ id: z.string() }))
      .output(z.object({ id: z.string(), name: z.string(), email: z.string() }))
      .handle(async ({ params }) => ({
        id: params.id,
        name: 'John Doe',
        email: 'john@example.com',
      }));

    const createUserEndpoint = e
      .post('/users')
      .body(z.object({ name: z.string(), email: z.string() }))
      .output(z.object({ id: z.string(), name: z.string(), email: z.string() }))
      .handle(async ({ body }) => ({
        id: '123',
        name: body.name,
        email: body.email,
      }));

    const listUsersEndpoint = e
      .get('/users')
      .query(z.object({ page: z.coerce.number().optional() }))
      .output(
        z.object({
          users: z.array(
            z.object({ id: z.string(), name: z.string(), email: z.string() }),
          ),
        }),
      )
      .handle(async ({ query }) => ({
        users: [],
      }));

    // Infer paths from endpoints
    const endpoints = [
      getUserEndpoint,
      createUserEndpoint,
      listUsersEndpoint,
    ] as const;
    type Paths = InferOpenApi<typeof endpoints>['paths'];

    // Verify the structure matches TypedFetcher expectations
    expectTypeOf<Paths>().toMatchTypeOf<{
      '/users/{id}': {
        get: {
          parameters: {
            path: { id: string };
          };
          responses: {
            200: {
              content: {
                'application/json': {
                  id: string;
                  name: string;
                  email: string;
                };
              };
            };
          };
        };
      };
      '/users': {
        get: {
          parameters: {
            query: { page?: number };
          };
          responses: {
            200: {
              content: {
                'application/json': {
                  users: Array<{ id: string; name: string; email: string }>;
                };
              };
            };
          };
        };
        post: {
          requestBody: {
            content: {
              'application/json': {
                name: string;
                email: string;
              };
            };
          };
          responses: {
            200: {
              content: {
                'application/json': {
                  id: string;
                  name: string;
                  email: string;
                };
              };
            };
          };
        };
      };
    }>();
  });

  it('should handle endpoints with multiple parameter types', () => {
    const updateUserEndpoint = e
      .put('/users/{id}')
      .params(z.object({ id: z.string() }))
      .query(z.object({ notify: z.coerce.boolean().optional() }))
      .body(z.object({ name: z.string() }))
      .output(z.object({ id: z.string(), name: z.string() }))
      .handle(async ({ params, query, body }) => ({
        id: params.id,
        name: body.name,
      }));

    type Paths = InferOpenApi<[typeof updateUserEndpoint]>['paths'];

    // Verify all parameter types are present
    expectTypeOf<Paths>().toMatchTypeOf<{
      '/users/{id}': {
        parameters: {
          path: { id: string };
          query: { notify?: boolean };
        };
        put: {
          parameters: {
            path: { id: string };
            query: { notify?: boolean };
          };
          requestBody: {
            content: {
              'application/json': {
                name: string;
              };
            };
          };
          responses: {
            200: {
              content: {
                'application/json': {
                  id: string;
                  name: string;
                };
              };
            };
          };
        };
      };
    }>();
  });

  it('should handle endpoints without output schema', () => {
    const deleteUserEndpoint = e
      .delete('/users/{id}')
      .params(z.object({ id: z.string() }))
      .handle(async ({ params }) => {
        // No return value
      });

    type Paths = InferOpenApi<[typeof deleteUserEndpoint]>['paths'];

    // Verify response content is never when no output schema
    expectTypeOf<Paths>().toMatchTypeOf<{
      '/users/{id}': {
        parameters: {
          path: { id: string };
        };
        delete: {
          parameters: {
            path: { id: string };
          };
          responses: {
            200: {
              content: never;
            };
          };
        };
      };
    }>();
  });
});
