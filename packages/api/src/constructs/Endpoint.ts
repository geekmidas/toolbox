import type { StandardSchemaV1 } from '@standard-schema/spec';
import pick from 'lodash.pick';
import set from 'lodash.set';
import type { OpenAPIV3_1 } from 'openapi-types';
import { UnprocessableEntityError } from '../errors';
import type { Logger } from '../logger';
import type { RateLimitConfig } from '../rate-limit';

import type { Service, ServiceRecord } from '../services';
import {
  Function,
  type FunctionContext,
  type FunctionHandler,
} from './Function';
import type { EventPublisher, MappedEvent, PublishableMessage } from './events';
import {
  convertSchemaWithComponents,
  convertStandardSchemaToJsonSchema,
} from './helpers';
import {
  type ComponentCollector,
  type OpenApiSchemaOptions,
  buildOpenApiSchema,
} from './openapi';
import {
  FunctionType,
  type HttpMethod,
  type InferComposableStandardSchema,
  type InferStandardSchema,
  type LowerHttpMethod,
  type RemoveUndefined,
} from './types';

/**
 * Represents an HTTP endpoint that can handle requests with type-safe input/output validation,
 * dependency injection, session management, and authorization.
 *
 * @template TRoute - The route path string with parameter placeholders (e.g., '/users/:id')
 * @template TMethod - The HTTP method (GET, POST, PUT, DELETE, PATCH)
 * @template TInput - The input schema definition for body, query, and path parameters
 * @template OutSchema - The output schema for response validation
 * @template TServices - Array of service dependencies to inject
 * @template TLogger - The logger instance type
 * @template TSession - The session data type
 *
 * @extends Function - Base function construct for handler execution
 *
 * @example
 * ```typescript
 * const endpoint = new Endpoint({
 *   route: '/users/:id',
 *   method: 'GET',
 *   input: { params: userIdSchema },
 *   output: userSchema,
 *   fn: async ({ params }) => getUserById(params.id)
 * });
 * ```
 */
export class Endpoint<
  TRoute extends string,
  TMethod extends HttpMethod,
  TInput extends EndpointSchemas = {},
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
  TEventPublisher extends
    | EventPublisher<PublishableMessage<string, any>>
    | undefined = undefined,
> extends Function<TInput, TServices, TLogger, OutSchema> {
  operationId?: string;
  /** The route path pattern with parameter placeholders */
  route: TRoute;
  /** The HTTP method for this endpoint */
  method: TMethod;
  /** Optional description for OpenAPI documentation */
  description?: string;
  /** Optional tags for OpenAPI documentation */
  tags?: string[];
  /** The HTTP success status code to return (default: 200) */
  public readonly status: SuccessStatus;
  /** Function to extract session data from the request context */
  public getSession: SessionFn<TServices, TLogger, TSession> = () =>
    ({}) as TSession;
  /** Function to determine if the request is authorized */
  public authorize: AuthorizeFn<TServices, TLogger, TSession> = () => true;
  /** Optional rate limiting configuration */
  public rateLimit?: RateLimitConfig;

  /**
   * Builds a complete OpenAPI 3.1 schema from an array of endpoints.
   *
   * @param endpoints - Array of endpoint instances to document
   * @param options - Optional configuration for OpenAPI generation
   * @returns OpenAPI 3.1 specification object
   *
   * @example
   * ```typescript
   * const schema = await Endpoint.buildOpenApiSchema([
   *   getUserEndpoint,
   *   createUserEndpoint
   * ], {
   *   title: 'User API',
   *   version: '1.0.0'
   * });
   * ```
   */
  static async buildOpenApiSchema(
    endpoints: Endpoint<any, any, any, any, any, any>[],
    options?: OpenApiSchemaOptions,
  ) {
    return buildOpenApiSchema(endpoints, options);
  }

  /**
   * Validates data against a StandardSchema.
   *
   * @param schema - The StandardSchema to validate against
   * @param data - The data to validate
   * @returns Validation result with value or issues
   */
  static validate<T extends StandardSchemaV1>(schema: T, data: unknown) {
    return schema['~standard'].validate(data);
  }

  /**
   * Gets the full path including HTTP method and route.
   * @returns Formatted string like 'GET /users/{id}'
   */
  get fullPath() {
    return `${this.method} ${this._path}` as const;
  }

  /**
   * Parses and validates data against a schema, throwing an error if validation fails.
   *
   * @param schema - The StandardSchema to validate against
   * @param data - The data to parse and validate
   * @returns The validated data with proper typing
   * @throws {UnprocessableEntityError} When validation fails
   */
  static async parseSchema<T extends StandardSchemaV1>(
    schema: T,
    data: unknown,
  ): Promise<InferStandardSchema<T>> {
    if (!schema) {
      return undefined as InferStandardSchema<T>;
    }

    const parsed = await Endpoint.validate(
      schema as unknown as StandardSchemaV1,
      data,
    );
    if (parsed.issues) {
      throw new UnprocessableEntityError('Validation failed', parsed.issues);
    }

    return parsed.value as InferStandardSchema<T>;
  }

  /**
   * Parses and validates the endpoint output against the output schema.
   *
   * @param output - The raw output data to validate
   * @returns The validated output data
   * @throws {UnprocessableEntityError} When output validation fails
   */
  async parseOutput(output: unknown): Promise<InferStandardSchema<OutSchema>> {
    return Endpoint.parseSchema(
      this.outputSchema as StandardSchemaV1,
      output,
    ) as Promise<InferStandardSchema<OutSchema>>;
  }

  /**
   * Parses and validates input data for a specific input type (body, query, params).
   *
   * @param input - The raw input data to validate
   * @param key - The input type key ('body', 'query', or 'params')
   * @returns The validated input data for the specified key
   * @throws {UnprocessableEntityError} When validation fails
   */
  async parseInput<K extends keyof TInput>(
    input: unknown,
    key: K,
  ): Promise<InferComposableStandardSchema<TInput[K]>> {
    const schema = this.input?.[key];
    return Endpoint.parseSchema(schema as StandardSchemaV1, input) as Promise<
      InferComposableStandardSchema<TInput[K]>
    >;
  }

  /**
   * Parses and validates the request body against the body schema.
   *
   * @param body - The raw request body to validate
   * @returns The validated body data
   * @throws {UnprocessableEntityError} When body validation fails
   */
  async parseBody(body: unknown): Promise<InferStandardSchema<TInput['body']>> {
    return this.parseInput(body, 'body') as Promise<
      InferStandardSchema<TInput['body']>
    >;
  }

  /**
   * Creates a case-insensitive header lookup function from a headers object.
   *
   * @param headers - Object containing header key-value pairs
   * @returns Function to retrieve header values by case-insensitive key
   *
   * @example
   * ```typescript
   * const headerFn = Endpoint.createHeaders({ 'Content-Type': 'application/json' });
   * headerFn('content-type'); // Returns 'application/json'
   * ```
   */
  static createHeaders(headers: Record<string, string>): HeaderFn {
    const headerMap = new Map<string, string>();
    for (const [k, v] of Object.entries(headers)) {
      const key = k.toLowerCase();
      headerMap.set(key, v);
    }

    return function get(key: string): string | undefined {
      return headerMap.get(key.toLowerCase());
    };
  }

  /**
   * Extracts and refines input data from the endpoint context.
   *
   * @param ctx - The endpoint execution context
   * @returns Object containing only the input data (body, query, params)
   * @internal
   */
  refineInput(
    ctx: EndpointContext<TInput, TServices, TLogger, TSession>,
  ): InferComposableStandardSchema<TInput> {
    const input = pick(ctx, [
      'body',
      'query',
      'params',
    ]) as InferComposableStandardSchema<TInput>;

    return input;
  }

  handler: EndpointHandler<TInput, TServices, TLogger, OutSchema, TSession> = (
    ctx: EndpointContext<TInput, TServices, TLogger, TSession>,
  ): OutSchema extends StandardSchemaV1
    ? InferStandardSchema<OutSchema> | Promise<InferStandardSchema<OutSchema>>
    : void | Promise<void> => {
    return this.fn({
      ...this.refineInput(ctx),
      services: ctx.services,
      logger: ctx.logger,
      header: ctx.header,
      session: ctx.session,
    } as unknown as FunctionContext<TInput, TServices, TLogger>);
  };

  /**
   * Type guard to check if an object is an Endpoint instance.
   *
   * @param obj - The object to check
   * @returns True if the object is an Endpoint
   */
  static isEndpoint(obj: any): obj is Endpoint<any, any, any, any> {
    return (
      obj &&
      (obj as Function).__IS_FUNCTION__ === true &&
      obj.type === FunctionType.Endpoint
    );
  }

  /**
   * Converts Express-style route params to OpenAPI format.
   * @returns Route with ':param' converted to '{param}'
   * @internal
   */
  get _path() {
    return this.route.replace(/:(\w+)/g, '{$1}') as ConvertRouteParams<TRoute>;
  }

  /**
   * Generates OpenAPI 3.1 schema for this endpoint.
   *
   * @returns OpenAPI route definition with operation details
   */
  async toOpenApi3Route(
    componentCollector?: ComponentCollector,
  ): Promise<EndpointOpenApiSchema<TRoute, TMethod>> {
    const operation: OpenAPIV3_1.OperationObject = {
      operationId: this.operationId,
      ...(this.description && { description: this.description }),
      ...(this.tags && this.tags.length > 0 && { tags: this.tags }),
      responses: {
        '200': {
          description: 'Successful response',
        } as OpenAPIV3_1.ResponseObject,
      },
    };

    // Add response schema
    if (this.outputSchema) {
      const responseSchema = await convertSchemaWithComponents(
        this.outputSchema,
        componentCollector,
      );
      if (responseSchema) {
        set(
          operation,
          ['responses', '200', 'content', 'application/json', 'schema'],
          responseSchema,
        );
      }
    }

    // Separate path and query parameters
    const pathParameters: OpenAPIV3_1.ParameterObject[] = [];
    const queryParameters: OpenAPIV3_1.ParameterObject[] = [];

    // Since the EndpointBuilder doesn't have body/search/params methods yet,
    // and the input is a composite type, we need to check if input exists
    // and has the expected shape
    if (this.input && typeof this.input === 'object') {
      // Add request body for methods that support it
      if (
        ['POST', 'PUT', 'PATCH'].includes(this.method) &&
        'body' in this.input &&
        this.input.body
      ) {
        const bodySchema = await convertSchemaWithComponents(
          this.input.body as StandardSchemaV1,
          componentCollector,
        );
        if (bodySchema) {
          set(operation, ['requestBody'], {
            required: true,
            content: {
              'application/json': {
                schema: bodySchema,
              },
            },
          });
        }
      }

      // Add path parameters
      if ('params' in this.input && this.input.params) {
        const paramsSchema = await convertStandardSchemaToJsonSchema(
          this.input.params as StandardSchemaV1,
        );
        if (
          paramsSchema &&
          paramsSchema.type === 'object' &&
          paramsSchema.properties
        ) {
          for (const [name, schema] of Object.entries(
            paramsSchema.properties,
          )) {
            pathParameters.push({
              name,
              in: 'path',
              required: paramsSchema.required?.includes(name) ?? true,
              schema: schema as any,
            });
          }
        }
      }

      // Add query parameters
      if ('query' in this.input && this.input.query) {
        const querySchema = await convertStandardSchemaToJsonSchema(
          this.input.query,
        );
        if (
          querySchema &&
          querySchema.type === 'object' &&
          querySchema.properties
        ) {
          for (const [name, schema] of Object.entries(querySchema.properties)) {
            queryParameters.push({
              name,
              in: 'query',
              required: querySchema.required?.includes(name) ?? false,
              schema: schema as any,
            });
          }
        }
      }
    }

    // Only add query parameters to the operation
    if (queryParameters.length > 0) {
      operation.parameters = queryParameters;
    }

    // Build the route object with path parameters at the route level
    const routeObject: any = {};
    if (pathParameters.length > 0) {
      routeObject.parameters = pathParameters;
    }
    routeObject[this.method.toLowerCase()] = operation;

    return {
      [this._path]: routeObject,
    } as EndpointOpenApiSchema<TRoute, TMethod>;
  }

  /**
   * Creates a new Endpoint instance.
   *
   * @param options - Configuration options for the endpoint
   * @param options.fn - The handler function to execute
   * @param options.method - HTTP method
   * @param options.route - Route path with parameter placeholders
   * @param options.description - Optional description for documentation
   * @param options.input - Input schemas for validation
   * @param options.logger - Logger instance
   * @param options.output - Output schema for response validation
   * @param options.services - Service dependencies
   * @param options.timeout - Execution timeout in milliseconds
   * @param options.getSession - Session extraction function
   * @param options.authorize - Authorization check function
   * @param options.status - Success HTTP status code (default: 200)
   */
  constructor({
    fn,
    method,
    route,
    description,
    tags,
    input,
    logger,
    output: outputSchema,
    services,
    timeout,
    getSession,
    authorize,
    rateLimit,
    status = SuccessStatus.OK,
  }: EndpointOptions<
    TRoute,
    TMethod,
    TInput,
    OutSchema,
    TServices,
    TLogger,
    TSession,
    OutSchema,
    TEventPublisher
  >) {
    super(
      fn as unknown as FunctionHandler<TInput, TServices, TLogger, OutSchema>,
      timeout,
      FunctionType.Endpoint,
      input,
      outputSchema,
      services,
      logger,
    );

    this.route = route;
    this.method = method;
    this.description = description;
    this.tags = tags;
    this.status = status;
    if (getSession) {
      this.getSession = getSession;
    }

    if (authorize) {
      this.authorize = authorize;
    }

    if (rateLimit) {
      this.rateLimit = rateLimit;
    }
  }
}

/**
 * Defines the input schema structure for an endpoint.
 *
 * @template TBody - Schema for request body validation
 * @template TSearch - Schema for query string validation
 * @template TParams - Schema for URL path parameters validation
 *
 * @example
 * ```typescript
 * type UserInput = EndpointInput<
 *   typeof createUserBodySchema,
 *   typeof userQuerySchema,
 *   typeof userParamsSchema
 * >;
 * ```
 */
export type EndpointInput<
  TBody extends StandardSchemaV1 | undefined = undefined,
  TSearch extends StandardSchemaV1 | undefined = undefined,
  TParams extends StandardSchemaV1 | undefined = undefined,
> = RemoveUndefined<{
  body: TBody;
  search: TSearch;
  params: TParams;
}>;

/**
 * Configuration options for creating an Endpoint instance.
 *
 * @template TRoute - The route path string
 * @template TMethod - The HTTP method
 * @template TInput - Input schema definitions
 * @template TOutput - Output schema definition
 * @template TServices - Service dependencies array
 * @template TLogger - Logger type
 * @template TSession - Session data type
 */
export interface EndpointOptions<
  TRoute extends string,
  TMethod extends HttpMethod,
  TInput extends EndpointSchemas = {},
  TOutput extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TEventPublisher extends
    | EventPublisher<PublishableMessage<string, any>>
    | undefined = undefined,
> {
  /** The route path with parameter placeholders */
  route: TRoute;
  /** The HTTP method for this endpoint */
  method: TMethod;
  /** The handler function that implements the endpoint logic */
  fn: EndpointHandler<TInput, TServices, TLogger, TOutput, TSession>;
  /** Optional authorization check function */
  authorize: AuthorizeFn<TServices, TLogger, TSession> | undefined;
  /** Optional description for documentation */
  description: string | undefined;
  /** Optional tags for OpenAPI documentation */
  tags?: string[];
  /** Optional execution timeout in milliseconds */
  timeout: number | undefined;
  /** Input validation schemas */
  input: TInput | undefined;
  /** Output validation schema */
  output: TOutput | undefined;
  /** Service dependencies to inject */
  services: TServices;
  /** Logger instance */
  logger: TLogger;
  /** Optional session extraction function */
  getSession: SessionFn<TServices, TLogger, TSession> | undefined;
  /** Optional rate limiting configuration */
  rateLimit?: RateLimitConfig;
  /** Success HTTP status code */
  status: SuccessStatus | undefined;
  /**
   * Event publisher for publishing events from this endpoint
   */
  publisher?: TEventPublisher;

  events?: MappedEvent<
    TEventPublisher,
    TInput,
    TServices,
    TLogger,
    TSession,
    OutSchema
  >[];
}

/**
 * Defines the possible input schema types for an endpoint.
 * Each property represents a different part of the HTTP request.
 */
export type EndpointSchemas = Partial<{
  /** Schema for URL path parameters (e.g., /users/:id) */
  params: StandardSchemaV1;
  /** Schema for query string parameters */
  query: StandardSchemaV1;
  /** Schema for request body (POST, PUT, PATCH) */
  body: StandardSchemaV1;
}>;

export type AuthorizeContext<
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
> = {
  services: ServiceRecord<TServices>;
  logger: TLogger;
  header: HeaderFn;
  session: TSession;
};
/**
 * Function type for endpoint authorization checks.
 *
 * @template TServices - Available service dependencies
 * @template TLogger - Logger type
 * @template TSession - Session data type
 *
 * @param ctx - Context containing services, logger, headers, and session
 * @returns Boolean indicating if the request is authorized
 *
 * @example
 * ```typescript
 * const authorize: AuthorizeFn = ({ session }) => {
 *   return session.userId !== undefined;
 * };
 * ```
 */
export type AuthorizeFn<
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
> = (
  ctx: AuthorizeContext<TServices, TLogger, TSession>,
) => Promise<boolean> | boolean;

export type SessionContext<
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
> = {
  services: ServiceRecord<TServices>;
  logger: TLogger;
  header: HeaderFn;
};
/**
 * Function type for extracting session data from a request.
 *
 * @template TServices - Available service dependencies
 * @template TLogger - Logger type
 * @template TSession - Session data type to extract
 *
 * @param ctx - Context containing services, logger, and headers
 * @returns The extracted session data
 *
 * @example
 * ```typescript
 * const getSession: SessionFn<Services, Logger, UserSession> = async ({ header, services }) => {
 *   const token = header('authorization');
 *   return await services.auth.verifyToken(token);
 * };
 * ```
 */
export type SessionFn<
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
> = (ctx: SessionContext<TServices, TLogger>) => Promise<TSession> | TSession;

/**
 * Utility type that converts Express-style route parameters to OpenAPI format.
 * Transforms ':param' syntax to '{param}' syntax.
 *
 * @template T - The route string to convert
 *
 * @example
 * ```typescript
 * type Route1 = ConvertRouteParams<'/users/:id'>; // '/users/{id}'
 * type Route2 = ConvertRouteParams<'/users/:userId/posts/:postId'>; // '/users/{userId}/posts/{postId}'
 * ```
 */
export type ConvertRouteParams<T extends string> =
  T extends `${infer Start}:${infer Param}/${infer Rest}`
    ? `${Start}{${Param}}/${ConvertRouteParams<Rest>}`
    : T extends `${infer Start}:${infer Param}`
      ? `${Start}{${Param}}`
      : T;

/**
 * Type representing the OpenAPI schema structure for an endpoint.
 *
 * @template TRoute - The route path
 * @template TMethod - The HTTP method
 *
 * @example
 * ```typescript
 * type Schema = EndpointOpenApiSchema<'/users/:id', 'GET'>;
 * // Results in: { '/users/{id}': { get: OperationObject, parameters?: ParameterObject[] } }
 * ```
 */
export type EndpointOpenApiSchema<
  TRoute extends string,
  TMethod extends HttpMethod,
> = {
  [key in ConvertRouteParams<TRoute>]: {
    [key in LowerHttpMethod<TMethod>]: OpenAPIV3_1.OperationObject<{}>;
  } & {
    parameters?: OpenAPIV3_1.ParameterObject[];
  };
};

export type SingleHeaderFn = (key: string) => string | undefined;
export type MultiHeaderFn = () => EndpointHeaders;
/**
 * Type representing HTTP headers as a Map.
 */
export type EndpointHeaders = Map<string, string>;

/**
 * Function type for retrieving HTTP header values.
 *
 * @param key - The header name (case-insensitive)
 * @returns The header value or undefined if not found
 */
export type HeaderFn = SingleHeaderFn;

/**
 * The execution context provided to endpoint handlers.
 * Contains all parsed input data, services, logger, headers, and session.
 *
 * @template Input - The input schemas (body, query, params)
 * @template TServices - Available service dependencies
 * @template TLogger - Logger type
 * @template TSession - Session data type
 */
export type EndpointContext<
  Input extends EndpointSchemas | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
> = {
  /** Injected service instances */
  services: ServiceRecord<TServices>;
  /** Logger instance for this request */
  logger: TLogger;
  /** Function to retrieve request headers */
  header: HeaderFn;
  /** Session data extracted by getSession */
  session: TSession;
} & InferComposableStandardSchema<Input>;

/**
 * Handler function type for endpoint implementations.
 *
 * @template TInput - Input schemas for validation
 * @template TServices - Available service dependencies
 * @template TLogger - Logger type
 * @template OutSchema - Output schema for response validation
 * @template TSession - Session data type
 *
 * @param ctx - The endpoint execution context
 * @returns The response data (validated if OutSchema is provided)
 *
 * @example
 * ```typescript
 * const handler: EndpointHandler<Input, [UserService], Logger, UserSchema> =
 *   async ({ params, services }) => {
 *     return await services.users.findById(params.id);
 *   };
 * ```
 */
export type EndpointHandler<
  TInput extends EndpointSchemas | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TSession = unknown,
> = (
  ctx: EndpointContext<TInput, TServices, TLogger, TSession>,
) => OutSchema extends StandardSchemaV1
  ? InferStandardSchema<OutSchema> | Promise<InferStandardSchema<OutSchema>>
  : any | Promise<any>;

/**
 * HTTP success status codes that can be returned by endpoints.
 */
export enum SuccessStatus {
  /** Standard response for successful HTTP requests */
  OK = 200,
  /** Request has been fulfilled and resulted in a new resource being created */
  Created = 201,
  /** Request has been accepted for processing, but processing is not complete */
  Accepted = 202,
  /** Server successfully processed the request but is not returning any content */
  NoContent = 204,
  /** Server successfully processed the request and is not returning any content, client should reset the document view */
  ResetContent = 205,
  /** Server is delivering only part of the resource due to a range header */
  PartialContent = 206,
}
