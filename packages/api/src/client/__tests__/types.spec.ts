import { describe, expectTypeOf, it } from 'vitest';
import type { paths } from '../openapi-types';
import type {
  ExtractEndpointConfig,
  ExtractEndpointResponse,
  FilteredRequestConfig,
  TypedEndpoint,
  ValidEndpoint,
} from '../types';

describe('Type utilities', () => {
  it('should extract valid endpoints from paths', () => {
    type ValidEndpoints = TypedEndpoint<paths>;

    // Test that valid endpoints are correctly generated
    expectTypeOf<ValidEndpoints>().toExtend<
      | 'GET /users'
      | 'POST /users'
      | 'GET /users/{id}'
      | 'PUT /users/{id}'
      | 'DELETE /users/{id}'
      | 'GET /posts'
      | 'GET /protected'
      | 'GET /error'
    >();
  });

  it('should create typed endpoint strings', () => {
    type Endpoints = TypedEndpoint<paths>;

    // Test that TypedEndpoint resolves to the same as ValidEndpoint
    expectTypeOf<Endpoints>().toEqualTypeOf<ValidEndpoint<paths>>();
  });

  it('should extract response types correctly', () => {
    type UserResponse = ExtractEndpointResponse<paths, 'GET /users/{id}'>;
    type UsersResponse = ExtractEndpointResponse<paths, 'GET /users'>;
    type PostsResponse = ExtractEndpointResponse<paths, 'GET /posts'>;

    expectTypeOf<UserResponse>().toEqualTypeOf<{
      id: string;
      name: string;
      email: string;
    }>();

    expectTypeOf<UsersResponse>().toEqualTypeOf<{
      users: Array<{
        id: string;
        name: string;
        email: string;
      }>;
    }>();

    expectTypeOf<PostsResponse>().toEqualTypeOf<{
      posts: Array<{
        id: string;
        title: string;
        content: string;
        authorId: string;
        createdAt: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
      };
      sort: 'asc' | 'desc';
    }>();
  });

  it('should extract config types correctly', () => {
    type GetUserConfig = ExtractEndpointConfig<paths, 'GET /users/{id}'>;
    type PostUserConfig = ExtractEndpointConfig<paths, 'POST /users'>;
    type GetPostsConfig = ExtractEndpointConfig<paths, 'GET /posts'>;

    expectTypeOf<GetUserConfig>().toEqualTypeOf<{
      params?: { id: string };
      query?: never;
      body?: never;
      headers?: Record<string, string>;
    }>();

    expectTypeOf<PostUserConfig>().toEqualTypeOf<{
      params?: never;
      query?: never;
      body?: { name: string; email: string };
      headers?: Record<string, string>;
    }>();

    expectTypeOf<GetPostsConfig>().toEqualTypeOf<{
      params?: never;
      query?: {
        page?: number;
        limit?: number;
        sort?: 'asc' | 'desc';
      };
      body?: never;
      headers?: Record<string, string>;
    }>();
  });

  it('should filter config to only required properties', () => {
    type GetUserFiltered = FilteredRequestConfig<paths, 'GET /users/{id}'>;
    type PostUserFiltered = FilteredRequestConfig<paths, 'POST /users'>;
    type GetUsersFiltered = FilteredRequestConfig<paths, 'GET /users'>;

    // GET /users/{id} should require params
    expectTypeOf<GetUserFiltered>().toEqualTypeOf<{
      params?: { id: string };
      headers?: Record<string, string>;
    }>();

    // POST /users should allow body
    expectTypeOf<PostUserFiltered>().toEqualTypeOf<{
      body?: { name: string; email: string };
      headers?: Record<string, string>;
    }>();

    // GET /users should only allow headers (no params, query, or body)
    expectTypeOf<GetUsersFiltered>().toEqualTypeOf<{
      headers?: Record<string, string>;
    }>();
  });

  it('should handle endpoints with multiple parameter types', () => {
    type PutUserConfig = FilteredRequestConfig<paths, 'PUT /users/{id}'>;

    expectTypeOf<PutUserConfig>().toEqualTypeOf<{
      params?: { id: string };
      body?: { name?: string; email?: string };
      headers?: Record<string, string>;
    }>();
  });
});
