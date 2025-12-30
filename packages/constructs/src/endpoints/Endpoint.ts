import type { AuditStorage, AuditableAction, Auditor } from '@geekmidas/audit';
import type {
  EventPublisher,
  ExtractPublisherMessage,
  MappedEvent,
} from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type { RateLimitConfig } from '@geekmidas/rate-limit';
import type {
  InferComposableStandardSchema,
  InferStandardSchema,
} from '@geekmidas/schema';
import {
  convertSchemaWithComponents,
  convertStandardSchemaToJsonSchema,
} from '@geekmidas/schema/conversion';
import {
  type ComponentCollector,
  type OpenApiSchemaOptions,
  buildOpenApiSchema,
} from '@geekmidas/schema/openapi';
import type { Service, ServiceRecord } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import pick from 'lodash.pick';
import set from 'lodash.set';
import type { OpenAPIV3_1 } from 'openapi-types';
import { ConstructType } from '../Construct';
import { Function, type FunctionHandler } from '../functions';
import type { HttpMethod, LowerHttpMethod, RemoveUndefined } from '../types';
import type { Authorizer } from './Authorizer';
import type { ActorExtractor, MappedAudit } from './audit';
import type { RlsConfig } from './rls';

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
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
  TAuditStorage extends AuditStorage | undefined = undefined,
  TAuditStorageServiceName extends string = string,
  TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
    string,
    unknown
  >,
  TDatabase = undefined,
  TDatabaseServiceName extends string = string,
> extends Function<
  TInput,
  TServices,
  TLogger,
  OutSchema,
  TEventPublisher,
  TEventPublisherServiceName,
  TAuditStorage,
  TAuditStorageServiceName,
  TDatabase,
  TDatabaseServiceName,
  TAuditAction,
  FunctionHandler<
    TInput,
    TServices,
    TLogger,
    OutSchema,
    TDatabase,
    TAuditStorage,
    TAuditAction
  >
> {
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
  /** Default headers to apply to all responses */
  public readonly defaultHeaders: Record<string, string> = {};
  /** Function to extract session data from the request context */
  public getSession: SessionFn<TServices, TLogger, TSession, TDatabase> = () =>
    ({}) as TSession;
  /** Function to determine if the request is authorized */
  public authorize: AuthorizeFn<TServices, TLogger, TSession> = () => true;
  /** Optional rate limiting configuration */
  public rateLimit?: RateLimitConfig;
  /** Optional authorizer for this endpoint */
  public authorizer?: Authorizer;
  /** Optional actor extractor for audit records */
  public actorExtractor?: ActorExtractor<TServices, TSession, TLogger>;
  /** Declarative audit definitions */
  public audits: MappedAudit<TAuditAction, OutSchema>[] = [];
  /** Database service for this endpoint */
  public declare databaseService?: Service<TDatabaseServiceName, TDatabase>;
  /** RLS configuration for this endpoint */
  public rlsConfig?: RlsConfig<TServices, TSession, TLogger>;
  /** Whether to bypass RLS for this endpoint */
  public rlsBypass?: boolean;
  /** The endpoint handler function */
  private endpointFn!: EndpointHandler<
    TInput,
    TServices,
    TLogger,
    OutSchema,
    TSession,
    TDatabase,
    TAuditStorage,
    TAuditAction
  >;

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
   * Gets the full path including HTTP method and route.
   * @returns Formatted string like 'GET /users/{id}'
   */
  get fullPath() {
    return `${this.method} ${this._path}` as const;
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

  static isSuccessStatus(status: number): boolean {
    return status >= 200 && status < 300;
  }

  /**
   * Creates a case-insensitive header lookup function from a headers object.
   *
   * @param headers - Object containing header key-value pairs
   * @returns Function to retrieve header values by case-insensitive key, or all headers
   *
   * @example
   * ```typescript
   * const headerFn = Endpoint.createHeaders({ 'Content-Type': 'application/json' });
   * headerFn('content-type'); // Returns 'application/json'
   * headerFn(); // Returns { 'content-type': 'application/json' }
   * ```
   */
  static createHeaders(headers: Record<string, string>): HeaderFn {
    const headerMap = new Map<string, string>();
    for (const [k, v] of Object.entries(headers)) {
      const key = k.toLowerCase();
      headerMap.set(key, v);
    }

    function get(): Record<string, string>;
    function get(key: string): string | undefined;
    function get(key?: string): string | undefined | Record<string, string> {
      if (key === undefined) {
        // Return all headers as plain object
        return Object.fromEntries(headerMap.entries());
      }
      return headerMap.get(key.toLowerCase());
    }

    return get;
  }

  /**
   * Parses cookie string and creates a cookie lookup function.
   *
   * @param cookieHeader - The Cookie header value
   * @returns Function to retrieve cookie values by name, or all cookies
   *
   * @example
   * ```typescript
   * const cookieFn = Endpoint.createCookies('session=abc123; theme=dark');
   * cookieFn('session'); // Returns 'abc123'
   * cookieFn(); // Returns { session: 'abc123', theme: 'dark' }
   * ```
   */
  static createCookies(cookieHeader: string | undefined): CookieFn {
    const cookieMap = new Map<string, string>();

    if (cookieHeader) {
      // Parse cookie string: "name1=value1; name2=value2"
      const cookies = cookieHeader.split(';');
      for (const cookie of cookies) {
        const [name, ...valueParts] = cookie.trim().split('=');
        if (name) {
          const value = valueParts.join('='); // Handle values with = in them
          cookieMap.set(name, decodeURIComponent(value));
        }
      }
    }

    function get(): Record<string, string>;
    function get(name: string): string | undefined;
    function get(name?: string): string | undefined | Record<string, string> {
      if (name === undefined) {
        // Return all cookies as plain object
        return Object.fromEntries(cookieMap.entries());
      }
      return cookieMap.get(name);
    }

    return get;
  }

  /**
   * Formats a cookie as a Set-Cookie header string.
   *
   * @param name - Cookie name
   * @param value - Cookie value
   * @param options - Cookie options (httpOnly, secure, sameSite, etc.)
   * @returns Formatted Set-Cookie header string
   *
   * @example
   * ```typescript
   * const header = Endpoint.formatCookieHeader('session', 'abc123', {
   *   httpOnly: true,
   *   secure: true,
   *   sameSite: 'strict',
   *   maxAge: 3600
   * });
   * // Returns: "session=abc123; Max-Age=3600; HttpOnly; Secure; SameSite=Strict"
   * ```
   */
  static formatCookieHeader(
    name: string,
    value: string,
    options?: CookieOptions,
  ): string {
    let cookie = `${name}=${value}`;

    if (options) {
      if (options.domain) cookie += `; Domain=${options.domain}`;
      if (options.path) cookie += `; Path=${options.path}`;
      if (options.expires)
        cookie += `; Expires=${options.expires.toUTCString()}`;
      if (options.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`;
      if (options.httpOnly) cookie += '; HttpOnly';
      if (options.secure) cookie += '; Secure';
      if (options.sameSite) {
        cookie += `; SameSite=${options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)}`;
      }
    }

    return cookie;
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

  handler = (
    ctx: EndpointContext<
      TInput,
      TServices,
      TLogger,
      TSession,
      TAuditAction,
      TDatabase,
      TAuditStorage
    >,
    response: ResponseBuilder,
  ): OutSchema extends StandardSchemaV1
    ?
        | InferStandardSchema<OutSchema>
        | ResponseWithMetadata<InferStandardSchema<OutSchema>>
        | Promise<InferStandardSchema<OutSchema>>
        | Promise<ResponseWithMetadata<InferStandardSchema<OutSchema>>>
    :
        | any
        | ResponseWithMetadata<any>
        | Promise<any>
        | Promise<ResponseWithMetadata<any>> => {
    // Apply default headers to response builder
    for (const [key, value] of Object.entries(this.defaultHeaders)) {
      response.header(key, value);
    }

    // Build context object, conditionally including auditor and db
    const handlerCtx = {
      ...this.refineInput(ctx),
      services: ctx.services,
      logger: ctx.logger,
      header: ctx.header,
      cookie: ctx.cookie,
      session: ctx.session,
      // These are conditionally present based on configuration
      ...('auditor' in ctx && { auditor: ctx.auditor }),
      ...('db' in ctx && { db: ctx.db }),
    } as EndpointContext<
      TInput,
      TServices,
      TLogger,
      TSession,
      TAuditAction,
      TDatabase,
      TAuditStorage
    >;

    return this.endpointFn(handlerCtx, response);
  };

  /**
   * Type guard to check if an object is an Endpoint instance.
   *
   * @param obj - The object to check
   * @returns True if the object is an Endpoint
   */
  static isEndpoint(obj: any): obj is Endpoint<any, any, any, any> {
    return Boolean(
      obj &&
        (obj as Function).__IS_FUNCTION__ === true &&
        obj.type === ConstructType.Endpoint,
    );
  }

  /**
   * Helper to check if response has metadata
   */
  static hasMetadata<T>(
    response: T | ResponseWithMetadata<T>,
  ): response is ResponseWithMetadata<T> {
    return (
      response !== null &&
      typeof response === 'object' &&
      'data' in response &&
      'metadata' in response
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
   * @param options.authorizer - Optional authorizer configuration
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
    memorySize,
    getSession,
    authorize,
    rateLimit,
    status = SuccessStatus.OK,
    publisherService,
    events,
    authorizer,
    auditorStorageService,
    actorExtractor,
    audits,
    databaseService,
    rlsConfig,
    rlsBypass,
  }: EndpointOptions<
    TRoute,
    TMethod,
    TInput,
    OutSchema,
    TServices,
    TLogger,
    TSession,
    OutSchema,
    TEventPublisher,
    TEventPublisherServiceName,
    TAuditStorage,
    TAuditStorageServiceName,
    TAuditAction,
    TDatabase,
    TDatabaseServiceName
  >) {
    super(
      fn as unknown as FunctionHandler<TInput, TServices, TLogger, OutSchema>,
      timeout,
      ConstructType.Endpoint,
      input,
      outputSchema,
      services,
      logger,
      publisherService,
      events,
      memorySize,
      auditorStorageService,
    );

    this.route = route;
    this.method = method;
    this.description = description;
    this.tags = tags;
    this.status = status;
    this.endpointFn = fn;

    if (getSession) {
      this.getSession = getSession;
    }

    if (authorize) {
      this.authorize = authorize;
    }

    if (rateLimit) {
      this.rateLimit = rateLimit;
    }

    if (authorizer) {
      this.authorizer = authorizer;
    }

    if (actorExtractor) {
      this.actorExtractor = actorExtractor;
    }

    if (audits) {
      this.audits = audits;
    }

    if (databaseService) {
      this.databaseService = databaseService;
    }

    if (rlsConfig) {
      this.rlsConfig = rlsConfig;
    }

    if (rlsBypass) {
      this.rlsBypass = rlsBypass;
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
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
  TAuditStorage extends AuditStorage | undefined = undefined,
  TAuditStorageServiceName extends string = string,
  TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
    string,
    unknown
  >,
  TDatabase = undefined,
  TDatabaseServiceName extends string = string,
> {
  /** The route path with parameter placeholders */
  route: TRoute;
  /** The HTTP method for this endpoint */
  method: TMethod;
  /** The handler function that implements the endpoint logic */
  fn: EndpointHandler<
    TInput,
    TServices,
    TLogger,
    TOutput,
    TSession,
    TDatabase,
    TAuditStorage,
    TAuditAction
  >;
  /** Optional authorization check function */
  authorize: AuthorizeFn<TServices, TLogger, TSession> | undefined;
  /** Optional description for documentation */
  description: string | undefined;
  /** Optional tags for OpenAPI documentation */
  tags?: string[];
  /** Optional execution timeout in milliseconds */
  timeout: number | undefined;
  /** Optional memory size in MB for serverless deployments */
  memorySize: number | undefined;
  /** Input validation schemas */
  input: TInput | undefined;
  /** Output validation schema */
  output: TOutput | undefined;
  /** Service dependencies to inject */
  services: TServices;
  /** Logger instance */
  logger: TLogger;
  /** Optional session extraction function */
  getSession: SessionFn<TServices, TLogger, TSession, TDatabase> | undefined;
  /** Optional rate limiting configuration */
  rateLimit?: RateLimitConfig;
  /** Success HTTP status code */
  status: SuccessStatus | undefined;
  /**
   * Event publisher service for publishing events from this endpoint
   */
  publisherService?: Service<TEventPublisherServiceName, TEventPublisher>;

  events?: MappedEvent<TEventPublisher, OutSchema>[];
  /** Optional authorizer configuration */
  authorizer?: Authorizer;
  /**
   * Auditor storage service for persisting audit records from this endpoint
   */
  auditorStorageService?: Service<TAuditStorageServiceName, TAuditStorage>;
  /** Optional actor extractor function for audit records */
  actorExtractor?: ActorExtractor<TServices, TSession, TLogger>;
  /** Declarative audit definitions */
  audits?: MappedAudit<TAuditAction, OutSchema>[];
  /** Database service for this endpoint */
  databaseService?: Service<TDatabaseServiceName, TDatabase>;
  /** RLS configuration for this endpoint */
  rlsConfig?: RlsConfig<TServices, TSession, TLogger>;
  /** Whether to bypass RLS for this endpoint */
  rlsBypass?: boolean;
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
  cookie: CookieFn;
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

/**
 * Base session context without database
 */
type BaseSessionContext<
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
> = {
  services: ServiceRecord<TServices>;
  logger: TLogger;
  header: HeaderFn;
  cookie: CookieFn;
};

/**
 * Conditional database context for session - only present when database service is configured
 */
type SessionDatabaseContext<TDatabase = undefined> = TDatabase extends undefined
  ? {}
  : {
      /**
       * Database instance for session extraction.
       * Available when a database service is configured via `.database()`.
       * Useful for looking up user data from the database based on auth tokens.
       */
      db: TDatabase;
    };

export type SessionContext<
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TDatabase = undefined,
> = BaseSessionContext<TServices, TLogger> & SessionDatabaseContext<TDatabase>;
/**
 * Function type for extracting session data from a request.
 *
 * @template TServices - Available service dependencies
 * @template TLogger - Logger type
 * @template TSession - Session data type to extract
 * @template TDatabase - Database type (when database service is configured)
 *
 * @param ctx - Context containing services, logger, headers, and optionally database
 * @returns The extracted session data
 *
 * @example
 * ```typescript
 * // Without database
 * const getSession: SessionFn<Services, Logger, UserSession> = async ({ header, services }) => {
 *   const token = header('authorization');
 *   return await services.auth.verifyToken(token);
 * };
 *
 * // With database
 * const getSession: SessionFn<Services, Logger, UserSession, Database> = async ({ header, db }) => {
 *   const token = header('authorization');
 *   const user = await db.selectFrom('users').where('token', '=', token).executeTakeFirst();
 *   return { userId: user?.id };
 * };
 * ```
 */
export type SessionFn<
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
  TDatabase = undefined,
> = (
  ctx: SessionContext<TServices, TLogger, TDatabase>,
) => Promise<TSession> | TSession;

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
 * Supports two calling patterns:
 * - `header(key)` - Get a single header value (case-insensitive)
 * - `header()` - Get all headers as a plain object
 *
 * @example
 * ```typescript
 * // Get single header
 * const contentType = header('content-type');
 *
 * // Get all headers
 * const allHeaders = header();
 * // { 'content-type': 'application/json', 'host': 'example.com', ... }
 * ```
 */
export interface HeaderFn {
  (): Record<string, string>;
  (key: string): string | undefined;
}

/**
 * Function type for retrieving cookie values.
 * Supports two calling patterns:
 * - `cookie(name)` - Get a single cookie value
 * - `cookie()` - Get all cookies as a plain object
 *
 * @example
 * ```typescript
 * // Get single cookie
 * const sessionId = cookie('session');
 *
 * // Get all cookies
 * const allCookies = cookie();
 * // { session: 'abc123', theme: 'dark', ... }
 * ```
 */
export interface CookieFn {
  (): Record<string, string>;
  (name: string): string | undefined;
}

/**
 * Cookie options matching standard Set-Cookie attributes
 */
export interface CookieOptions {
  domain?: string;
  path?: string;
  expires?: Date;
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
}

/**
 * Response metadata that handlers can set
 */
export interface ResponseMetadata {
  headers?: Record<string, string>;
  cookies?: Map<string, { value: string; options?: CookieOptions }>;
  status?: SuccessStatus;
}

/**
 * Return type for handlers that want to set response metadata
 */
export interface ResponseWithMetadata<T> {
  data: T;
  metadata: ResponseMetadata;
}

/**
 * Response builder for fluent API in handlers
 */
export class ResponseBuilder {
  private metadata: ResponseMetadata = {
    headers: {},
    cookies: new Map(),
  };

  header(key: string, value: string): this {
    this.metadata.headers![key] = value;
    return this;
  }

  cookie(name: string, value: string, options?: CookieOptions): this {
    this.metadata.cookies!.set(name, { value, options });
    return this;
  }

  deleteCookie(
    name: string,
    options?: Pick<CookieOptions, 'domain' | 'path'>,
  ): this {
    this.metadata.cookies!.set(name, {
      value: '',
      options: { ...options, maxAge: 0, expires: new Date(0) },
    });
    return this;
  }

  status(code: SuccessStatus): this {
    this.metadata.status = code;
    return this;
  }

  send<T>(data: T): ResponseWithMetadata<T> {
    return { data, metadata: this.metadata };
  }

  getMetadata(): ResponseMetadata {
    return this.metadata;
  }
}

/**
 * Base context properties that are always available
 */
type BaseEndpointContext<
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
  /** Function to retrieve request cookies */
  cookie: CookieFn;
  /** Session data extracted by getSession */
  session: TSession;
};

/**
 * Conditional auditor context - only present when audit storage is configured
 */
type AuditorContext<
  TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
    string,
    unknown
  >,
  TAuditStorage = undefined,
> = TAuditStorage extends undefined
  ? {}
  : {
      /**
       * Auditor instance for recording audit events.
       * Only present when audit storage is configured on the endpoint.
       * When a transactional database is used for audit storage,
       * the auditor is pre-configured with the transaction context.
       */
      auditor: Auditor<TAuditAction>;
    };

/**
 * Conditional database context - only present when database service is configured
 */
type DatabaseContext<TDatabase = undefined> = TDatabase extends undefined
  ? {}
  : {
      /**
       * Database instance for this request.
       * When audit storage is configured and uses the same database,
       * this will be the transaction for ACID compliance.
       * Otherwise, it's the raw database connection.
       */
      db: TDatabase;
    };

/**
 * The execution context provided to endpoint handlers.
 * Contains all parsed input data, services, logger, headers, cookies, and session.
 *
 * @template Input - The input schemas (body, query, params)
 * @template TServices - Available service dependencies
 * @template TLogger - Logger type
 * @template TSession - Session data type
 * @template TAuditAction - Audit action types (when auditor is configured)
 * @template TDatabase - Database type (when database service is configured)
 * @template TAuditStorage - Audit storage type (determines if auditor is present)
 */
export type EndpointContext<
  Input extends EndpointSchemas | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
  TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
    string,
    unknown
  >,
  TDatabase = undefined,
  TAuditStorage = undefined,
> = BaseEndpointContext<TServices, TLogger, TSession> &
  InferComposableStandardSchema<Input> &
  AuditorContext<TAuditAction, TAuditStorage> &
  DatabaseContext<TDatabase>;

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
 * @param response - Response builder for setting cookies, headers, and status
 * @returns The response data (validated if OutSchema is provided) or ResponseWithMetadata
 *
 * @example
 * ```typescript
 * // Simple response
 * const handler: EndpointHandler<Input, [UserService], Logger, UserSchema> =
 *   async ({ params, services }) => {
 *     return await services.users.findById(params.id);
 *   };
 *
 * // With response builder
 * const handler: EndpointHandler<Input, [UserService], Logger, UserSchema> =
 *   async ({ params, services }, response) => {
 *     const user = await services.users.findById(params.id);
 *     return response.header('X-User-Id', user.id).send(user);
 *   };
 * ```
 */
export type EndpointHandler<
  TInput extends EndpointSchemas | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TSession = unknown,
  TDatabase = undefined,
  TAuditStorage = undefined,
  TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
    string,
    unknown
  >,
> = (
  ctx: EndpointContext<
    TInput,
    TServices,
    TLogger,
    TSession,
    TAuditAction,
    TDatabase,
    TAuditStorage
  >,
  response: ResponseBuilder,
) => OutSchema extends StandardSchemaV1
  ?
      | InferStandardSchema<OutSchema>
      | ResponseWithMetadata<InferStandardSchema<OutSchema>>
      | Promise<InferStandardSchema<OutSchema>>
      | Promise<ResponseWithMetadata<InferStandardSchema<OutSchema>>>
  :
      | unknown
      | ResponseWithMetadata<unknown>
      | Promise<unknown>
      | Promise<ResponseWithMetadata<unknown>>;

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

export type EndpointOutput<T> = T extends Endpoint<
  any,
  any,
  any,
  infer OutSchema,
  any,
  any,
  any,
  any
>
  ? InferStandardSchema<OutSchema>
  : never;

export type EndpointEvent<T> = T extends Endpoint<
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  infer TEventPublisher
>
  ? ExtractPublisherMessage<TEventPublisher>
  : never;
