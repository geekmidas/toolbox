# API Reference - @geekmidas/api

## Core Classes

### `Endpoint`

The main endpoint builder class for creating type-safe HTTP endpoints.

```typescript
class Endpoint<TConfig extends EndpointConfig = EndpointConfig> {
  // HTTP Methods
  get(path: string): Endpoint
  post(path: string): Endpoint
  put(path: string): Endpoint
  patch(path: string): Endpoint
  delete(path: string): Endpoint
  head(path: string): Endpoint
  options(path: string): Endpoint
  
  // Schema Definitions
  params<T>(schema: StandardSchema<T>): Endpoint
  query<T>(schema: StandardSchema<T>): Endpoint
  headers<T>(schema: StandardSchema<T>): Endpoint
  body<T>(schema: StandardSchema<T>): Endpoint
  output<T>(schema: StandardSchema<T>): Endpoint
  
  // Middleware
  services<T extends HermodServiceConstructor[]>(services: T): Endpoint
  authorize<T>(authorizer: Authorizer<T>): Endpoint
  session<T>(sessionResolver: SessionResolver<T>): Endpoint
  
  // Route Grouping
  route(prefix: string): Endpoint
  
  // Handler
  handle<T>(handler: EndpointHandler<TConfig, T>): CompiledEndpoint<TConfig, T>
  
  // OpenAPI
  openapi(metadata: OpenAPIMetadata): Endpoint
}
```

### `CompiledEndpoint`

A compiled endpoint ready for execution.

```typescript
class CompiledEndpoint<TConfig, TOutput> {
  readonly method: HttpMethod
  readonly path: string
  readonly config: TConfig
  readonly handler: EndpointHandler<TConfig, TOutput>
  
  // Execution
  execute(request: Request, context?: Context): Promise<Response>
}
```

### `HermodService`

Base class for creating injectable services.

```typescript
abstract class HermodService<T> {
  static readonly serviceName: string
  
  abstract register(context: ServiceContext): Promise<T> | T
  cleanup?(service: T): Promise<void> | void
}
```

### `AWSApiGatewayV1EndpointAdaptor`

Adapter for AWS API Gateway v1 (REST API) Lambda integration.

```typescript
class AWSApiGatewayV1EndpointAdaptor {
  constructor(endpoint: CompiledEndpoint)
  
  readonly handler: APIGatewayProxyHandler
}
```

## Type Definitions

### Handler Context

The context object passed to endpoint handlers.

```typescript
interface HandlerContext<TConfig> {
  // Request data (based on schemas)
  params?: TConfig['params']
  query?: TConfig['query']
  headers?: TConfig['headers']
  body?: TConfig['body']
  
  // Services
  services: ServiceMap<TConfig['services']>
  
  // Authorization/Session
  auth?: TConfig['auth']
  session?: TConfig['session']
  
  // Utilities
  logger: Logger
  req: Request
}
```

### Service Types

```typescript
// Service constructor
type HermodServiceConstructor = {
  new (): HermodService<any>
  readonly serviceName: string
}

// Service map in handler context
type ServiceMap<T extends HermodServiceConstructor[]> = {
  [K in T[number]['serviceName']]: InstanceType<Extract<T[number], { serviceName: K }>>
}

// Service context passed to register()
interface ServiceContext {
  logger: Logger
  [key: string]: any
}
```

### Authorization Types

```typescript
type Authorizer<T = any> = (context: {
  req: Request
  logger: Logger
}) => Promise<T | false> | T | false

type SessionResolver<T = any> = (context: {
  req: Request
  logger: Logger
}) => Promise<T | null> | T | null
```

### Schema Types

The framework accepts any schema that implements the StandardSchema specification:

```typescript
interface StandardSchema<T = unknown> {
  '~standard': StandardSchemaProps<T>
}

interface StandardSchemaProps<T = unknown> {
  version: 1
  vendor: string
  validate: (value: unknown) => StandardResult<T>
}
```

## Error Classes

### Base Error Class

```typescript
abstract class HttpError extends Error {
  readonly statusCode: number
  readonly statusMessage: string
  readonly data?: unknown
  
  constructor(statusCode: number, message?: string, data?: unknown)
}
```

### Specific Error Classes

| Class | Status | Usage |
|-------|--------|-------|
| `BadRequestError` | 400 | Invalid request data |
| `UnauthorizedError` | 401 | Missing or invalid authentication |
| `PaymentRequiredError` | 402 | Payment required |
| `ForbiddenError` | 403 | Authenticated but not authorized |
| `NotFoundError` | 404 | Resource not found |
| `MethodNotAllowedError` | 405 | HTTP method not allowed |
| `NotAcceptableError` | 406 | Cannot produce acceptable response |
| `ProxyAuthenticationRequiredError` | 407 | Proxy authentication required |
| `RequestTimeoutError` | 408 | Request timeout |
| `ConflictError` | 409 | Resource conflict |
| `GoneError` | 410 | Resource permanently removed |
| `LengthRequiredError` | 411 | Content-Length required |
| `PreconditionFailedError` | 412 | Precondition failed |
| `PayloadTooLargeError` | 413 | Request entity too large |
| `URITooLongError` | 414 | URI too long |
| `UnsupportedMediaTypeError` | 415 | Unsupported media type |
| `RangeNotSatisfiableError` | 416 | Range not satisfiable |
| `ExpectationFailedError` | 417 | Expectation failed |
| `ImATeapotError` | 418 | I'm a teapot |
| `MisdirectedRequestError` | 421 | Misdirected request |
| `UnprocessableEntityError` | 422 | Validation errors |
| `LockedError` | 423 | Resource locked |
| `FailedDependencyError` | 424 | Failed dependency |
| `TooEarlyError` | 425 | Too early |
| `UpgradeRequiredError` | 426 | Upgrade required |
| `PreconditionRequiredError` | 428 | Precondition required |
| `TooManyRequestsError` | 429 | Rate limit exceeded |
| `RequestHeaderFieldsTooLargeError` | 431 | Header fields too large |
| `UnavailableForLegalReasonsError` | 451 | Unavailable for legal reasons |
| `InternalServerError` | 500 | Server error |
| `NotImplementedError` | 501 | Not implemented |
| `BadGatewayError` | 502 | Bad gateway |
| `ServiceUnavailableError` | 503 | Service unavailable |
| `GatewayTimeoutError` | 504 | Gateway timeout |
| `HTTPVersionNotSupportedError` | 505 | HTTP version not supported |
| `VariantAlsoNegotiatesError` | 506 | Variant also negotiates |
| `InsufficientStorageError` | 507 | Insufficient storage |
| `LoopDetectedError` | 508 | Loop detected |
| `NotExtendedError` | 510 | Not extended |
| `NetworkAuthenticationRequiredError` | 511 | Network authentication required |

### Error Factory Functions

```typescript
// Create specific errors
const createError = {
  badRequest: (message?: string, data?: unknown) => HttpError,
  unauthorized: (message?: string, data?: unknown) => HttpError,
  forbidden: (message?: string, data?: unknown) => HttpError,
  notFound: (message?: string, data?: unknown) => HttpError,
  // ... all HTTP status codes
}

// Create by status code
function createHttpError(
  statusCode: number,
  message?: string,
  data?: unknown
): HttpError

// Check if value is HTTP error
function isHttpError(value: unknown): value is HttpError
```

## Logger Interface

```typescript
interface Logger {
  trace(obj: object, msg?: string): void
  trace(msg: string): void
  
  debug(obj: object, msg?: string): void
  debug(msg: string): void
  
  info(obj: object, msg?: string): void
  info(msg: string): void
  
  warn(obj: object, msg?: string): void
  warn(msg: string): void
  
  error(obj: object, msg?: string): void
  error(msg: string): void
  
  fatal(obj: object, msg?: string): void
  fatal(msg: string): void
  
  child(bindings: object): Logger
}
```

## Request/Response Types

### Request Interface

The framework uses the standard Fetch API `Request` interface with additional helpers:

```typescript
interface Request {
  readonly method: string
  readonly url: string
  readonly headers: Headers
  
  // Body methods
  text(): Promise<string>
  json(): Promise<any>
  formData(): Promise<FormData>
  arrayBuffer(): Promise<ArrayBuffer>
  blob(): Promise<Blob>
}
```

### Response Interface

The framework uses the standard Fetch API `Response` interface:

```typescript
interface Response {
  readonly status: number
  readonly statusText: string
  readonly headers: Headers
  readonly body: ReadableStream<Uint8Array> | null
  
  // Static constructors
  static json(data: any, init?: ResponseInit): Response
  static error(): Response
  static redirect(url: string | URL, status?: number): Response
}
```

## OpenAPI Integration

### OpenAPI Metadata

```typescript
interface OpenAPIMetadata {
  summary?: string
  description?: string
  tags?: string[]
  operationId?: string
  deprecated?: boolean
  security?: SecurityRequirement[]
  externalDocs?: {
    description?: string
    url: string
  }
  servers?: {
    url: string
    description?: string
    variables?: Record<string, {
      default: string
      description?: string
      enum?: string[]
    }>
  }[]
}
```

### OpenAPI Generation

```typescript
function generateOpenApiDocument(
  endpoints: CompiledEndpoint[],
  config?: OpenAPIConfig
): OpenAPIDocument

interface OpenAPIConfig {
  info: {
    title: string
    version: string
    description?: string
    termsOfService?: string
    contact?: {
      name?: string
      url?: string
      email?: string
    }
    license?: {
      name: string
      url?: string
    }
  }
  servers?: OpenAPIServer[]
  components?: {
    securitySchemes?: Record<string, SecurityScheme>
  }
}
```

## Testing Utilities

### Test Endpoint Function

```typescript
async function testEndpoint<T>(
  endpoint: CompiledEndpoint<any, T>,
  options: TestEndpointOptions
): Promise<TestEndpointResult<T>>

interface TestEndpointOptions {
  method?: string
  path?: string
  params?: Record<string, string>
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: any
  services?: Record<string, any>
  auth?: any
  session?: any
}

interface TestEndpointResult<T> {
  status: number
  headers: Headers
  body: T
}
```

## Utility Functions

### Path Utilities

```typescript
// Join path segments
function joinPaths(...paths: string[]): string

// Parse path parameters
function parsePathParams(
  pattern: string,
  path: string
): Record<string, string> | null

// Match path pattern
function matchPath(
  pattern: string,
  path: string
): boolean
```

### Schema Utilities

```typescript
// Check if value implements StandardSchema
function isStandardSchema(value: unknown): value is StandardSchema

// Validate value against schema
function validateSchema<T>(
  schema: StandardSchema<T>,
  value: unknown
): { success: true; data: T } | { success: false; error: Error }
```

## Environment Variables

The framework respects these environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Logging level (trace, debug, info, warn, error, fatal) | `info` |
| `NODE_ENV` | Environment (development, production, test) | `development` |

## Constants

```typescript
// HTTP Methods
const HttpMethod = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
  HEAD: 'HEAD',
  OPTIONS: 'OPTIONS'
} as const

// Content Types
const ContentType = {
  JSON: 'application/json',
  TEXT: 'text/plain',
  HTML: 'text/html',
  FORM: 'application/x-www-form-urlencoded',
  MULTIPART: 'multipart/form-data'
} as const

// Status Codes
const StatusCode = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  // ... etc
} as const
```