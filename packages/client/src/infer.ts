import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Endpoint, EndpointSchemas } from '@geekmidas/constructs/endpoints';
import type { HttpMethod } from '@geekmidas/constructs/types';

/**
 * Infers path parameters from a route string as an object
 * @example '/users/{id}/posts/{postId}' -> { id: string, postId: string }
 */
type InferPathParams<TRoute extends string> =
  TRoute extends `${string}{${infer Param}}${infer Rest}`
    ? { [K in Param]: string } & InferPathParams<Rest>
    : {};

/**
 * Converts an HTTP method to lowercase for TypedFetcher compatibility
 */
type LowercaseMethod<T extends HttpMethod> = Lowercase<T>;

/**
 * Infers route-level parameters (path params)
 */
type InferRouteParameters<TRoute extends string> =
  InferPathParams<TRoute> extends Record<string, never>
    ? {}
    : {
        parameters: {
          path: InferPathParams<TRoute>;
        };
      };

/**
 * Infers operation-level parameters (query params)
 */
type InferOperationParameters<TInput extends EndpointSchemas> =
  TInput extends { query: infer Q }
    ? {
        parameters: {
          query: InferStandardSchema<Q>;
        };
      }
    : {};

/**
 * Infers the operation object compatible with TypedFetcher
 */
type InferOperation<
  TInput extends EndpointSchemas,
  TOutput extends StandardSchemaV1 | undefined,
> = InferOperationParameters<TInput> & {
  requestBody?: TInput extends { body: infer B }
    ? {
        content: {
          'application/json': InferStandardSchema<B>;
        };
      }
    : never;
  responses: {
    200: {
      content: TOutput extends StandardSchemaV1
        ? {
            'application/json': InferStandardSchema<TOutput>;
          }
        : never;
    };
  };
};

/**
 * Infers the TypedFetcher-compatible paths structure from a single endpoint
 *
 * This generates a structure compatible with @geekmidas/client TypedFetcher,
 * allowing you to create a typed client directly from endpoint definitions
 * without needing OpenAPI JSON + codegen.
 *
 * @example
 * ```typescript
 * import { e } from '@geekmidas/constructs';
 * import { createTypedFetcher, type InferOpenApiFromEndpoint } from '@geekmidas/client';
 * import { z } from 'zod';
 *
 * const endpoint = e
 *   .get('/users/{id}')
 *   .params(z.object({ id: z.string() }))
 *   .output(z.object({ id: z.string(), name: z.string() }))
 *   .handle(async ({ params }) => ({ id: params.id, name: 'John' }));
 *
 * type Paths = InferOpenApiFromEndpoint<typeof endpoint>['paths'];
 * const client = createTypedFetcher<Paths>({ baseURL: 'http://localhost:3000' });
 * const user = await client('GET /users/{id}', { params: { id: '123' } });
 * ```
 */
export type InferOpenApiFromEndpoint<T> = T extends Endpoint<
  infer TRoute,
  infer TMethod,
  infer TInput,
  infer TOutput,
  any,
  any,
  any
>
  ? {
      paths: {
        [K in TRoute]: InferRouteParameters<TRoute> & {
          [M in LowercaseMethod<TMethod>]: InferOperation<TInput, TOutput>;
        };
      };
    }
  : never;

/**
 * Infers TypedFetcher-compatible paths structure from multiple endpoints
 *
 * Merges multiple endpoint definitions into a single paths object that can be
 * used with @geekmidas/client TypedFetcher for fully type-safe API calls.
 *
 * @example
 * ```typescript
 * import { e } from '@geekmidas/constructs';
 * import { createTypedFetcher, type InferOpenApi } from '@geekmidas/client';
 * import { z } from 'zod';
 *
 * // Define endpoints
 * const getUserEndpoint = e
 *   .get('/users/{id}')
 *   .params(z.object({ id: z.string() }))
 *   .output(z.object({ id: z.string(), name: z.string() }))
 *   .handle(async ({ params }) => ({ id: params.id, name: 'John' }));
 *
 * const createUserEndpoint = e
 *   .post('/users')
 *   .body(z.object({ name: z.string() }))
 *   .output(z.object({ id: z.string(), name: z.string() }))
 *   .handle(async ({ body }) => ({ id: '123', name: body.name }));
 *
 * // Export for client
 * export const endpoints = [getUserEndpoint, createUserEndpoint] as const;
 * export type Paths = InferOpenApi<typeof endpoints>['paths'];
 *
 * // Client usage
 * import type { Paths } from './endpoints';
 * const client = createTypedFetcher<Paths>({ baseURL: 'http://localhost:3000' });
 *
 * const user = await client('GET /users/{id}', { params: { id: '123' } });
 * const newUser = await client('POST /users', { body: { name: 'Jane' } });
 * ```
 */
export type InferOpenApi<TEndpoints extends readonly any[]> =
  TEndpoints extends readonly [infer First, ...infer Rest]
    ? InferOpenApiFromEndpoint<First> extends { paths: infer P1 }
      ? Rest extends []
        ? { paths: P1 }
        : InferOpenApi<Rest> extends { paths: infer P2 }
          ? { paths: P1 & P2 }
          : { paths: P1 }
      : InferOpenApi<Rest>
    : { paths: {} };
