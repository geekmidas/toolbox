import type {
  UseMutationOptions,
  UseQueryOptions,
} from '@tanstack/react-query';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createTypedFetcher } from './fetcher';
import type { FetcherOptions } from './types';

// Simplified type helpers for OpenAPI paths
type HttpMethods = 'get' | 'post' | 'put' | 'patch' | 'delete';

// Extract all operations from paths
type AllOperations<Paths> = {
  [Path in keyof Paths]: {
    [Method in keyof Paths[Path] & HttpMethods]: Paths[Path][Method] extends {
      operationId: infer OpId;
    }
      ? OpId extends string
        ? {
            operationId: OpId;
            path: Path;
            method: Method;
            spec: Paths[Path][Method] & {
              _pathParams?: Paths[Path] extends {
                parameters: { path: infer P };
              }
                ? P
                : never;
            };
          }
        : never
      : never;
  }[keyof Paths[Path] & HttpMethods];
}[keyof Paths];

// Create operation map
type OperationMap<Paths> = {
  [Op in AllOperations<Paths> as Op extends {
    operationId: infer Id extends string;
  }
    ? Id
    : never]: Op;
};

// Get operation IDs
type OperationId<Paths> = keyof OperationMap<Paths>;

// Get operations by method
type OperationsByMethod<Paths, Method extends HttpMethods> = {
  [K in OperationId<Paths>]: OperationMap<Paths>[K] extends { method: Method }
    ? K
    : never;
}[OperationId<Paths>];

// Extract parameter types
type OperationParams<
  Paths,
  OpId extends OperationId<Paths>,
> = OperationMap<Paths>[OpId] extends {
  path: infer Path extends keyof Paths;
  spec: infer Spec;
}
  ? {
      params?: Paths[Path] extends { parameters: { path: infer P } }
        ? P
        : Spec extends { parameters: { path: infer P } }
          ? P
          : never;
      query?: Spec extends { parameters: { query?: infer Q } } ? Q : never;
      body?: Spec extends {
        requestBody: { content: { 'application/json': infer Body } };
      }
        ? Body
        : Spec extends {
              requestBody: {
                required: true;
                content: { 'application/json': infer Body };
              };
            }
          ? Body
          : never;
    }
  : never;

// Extract response type
type OperationResponse<
  Paths,
  OpId extends OperationId<Paths>,
> = OperationMap<Paths>[OpId] extends { spec: infer Spec }
  ? Spec extends {
      responses: { 200: { content: { 'application/json': infer R } } };
    }
    ? R
    : Spec extends {
          responses: { 201: { content: { 'application/json': infer R } } };
        }
      ? R
      : Spec extends { responses: { 204: any } }
        ? void
        : unknown
  : never;

// Remove never properties
type RemoveNever<T> = Pick<
  T,
  {
    [K in keyof T]: T[K] extends never ? never : K;
  }[keyof T]
>;

// Check if type is empty
type IsEmpty<T> = keyof T extends never ? true : false;

// Runtime operation registry (would be generated)
interface OperationRegistry {
  [operationId: string]: {
    path: string;
    method: string;
  };
}

export function createOpenAPIHooks<Paths>(
  options: FetcherOptions & { operations?: OperationRegistry } = {},
) {
  const { operations, ...fetcherOptions } = options;
  const fetcher = createTypedFetcher<Paths>(fetcherOptions);

  function buildEndpoint<OpId extends OperationId<Paths>>(
    operationId: OpId,
  ): string {
    // Runtime lookup from registry
    const op = operations?.[operationId as string];
    if (op) {
      return `${op.method.toUpperCase()} ${op.path}`;
    }
    // Fallback for compile-time only usage
    return operationId as string;
  }

  return {
    useQuery: <OpId extends OperationsByMethod<Paths, 'get'>>(
      operationId: OpId,
      config?: RemoveNever<OperationParams<Paths, OpId>>,
      options?: Omit<
        UseQueryOptions<OperationResponse<Paths, OpId>, Error>,
        'queryKey' | 'queryFn'
      >,
    ) => {
      const endpoint = buildEndpoint(operationId);
      const queryKey = [operationId, ...(config ? [config] : [])];

      return useQuery<OperationResponse<Paths, OpId>, Error>({
        queryKey,
        queryFn: async () => {
          const response = await fetcher(endpoint as any, config as any);
          return response as OperationResponse<Paths, OpId>;
        },
        ...options,
      });
    },

    useMutation: <
      OpId extends Exclude<
        OperationId<Paths>,
        OperationsByMethod<Paths, 'get'>
      >,
    >(
      operationId: OpId,
      options?: Omit<
        UseMutationOptions<
          OperationResponse<Paths, OpId>,
          Error,
          RemoveNever<OperationParams<Paths, OpId>>
        >,
        'mutationFn'
      >,
    ) => {
      const endpoint = buildEndpoint(operationId);

      return useMutation<
        OperationResponse<Paths, OpId>,
        Error,
        RemoveNever<OperationParams<Paths, OpId>>
      >({
        mutationFn: async (variables) => {
          const response = await fetcher(endpoint as any, variables as any);
          return response as OperationResponse<Paths, OpId>;
        },
        ...options,
      });
    },
  };
}
