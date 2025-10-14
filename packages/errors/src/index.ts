// http-errors.ts - Core HTTP Error Classes and Types

/**
 * Base HTTP Error class that extends the native Error.
 * Provides a foundation for all HTTP-specific errors with status codes and structured error responses.
 *
 * @extends Error
 *
 * @example
 * ```typescript
 * throw new HttpError(400, 'Bad Request', {
 *   details: { field: 'email', message: 'Invalid format' }
 * });
 * ```
 */
export class HttpError extends Error {
  /** The HTTP status code (e.g., 400, 404, 500) */
  public readonly statusCode: number;
  /** The standard HTTP status message (e.g., 'Bad Request', 'Not Found') */
  public readonly statusMessage: string;
  /** Type discriminator for runtime type checking */
  public readonly isHttpError = true;
  /** Additional error details for debugging or client information */
  public readonly details?: any;
  /** Application-specific error code for client-side handling */
  public readonly code?: string;

  /**
   * Creates a new HttpError instance.
   *
   * @param statusCode - The HTTP status code
   * @param message - Optional error message for the client
   * @param options - Optional configuration object
   * @param options.statusMessage - Override the default status message
   * @param options.details - Additional error details or context
   * @param options.code - Application-specific error code
   * @param options.cause - The underlying error that caused this error (ES2022)
   */
  constructor(
    statusCode: number,
    message?: string,
    options?: {
      statusMessage?: string;
      details?: any;
      code?: string;
      cause?: Error;
    },
  ) {
    super(message || options?.statusMessage || 'HTTP Error');
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.statusMessage =
      options?.statusMessage || this.getDefaultStatusMessage(statusCode);
    this.details = options?.details;
    this.code = options?.code;

    // Set cause if provided (ES2022 feature)
    if (options?.cause) {
      this.cause = options.cause;
    }
    // @ts-ignore
    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Gets the error response body as a JSON string.
   * Used for sending the error response to clients.
   *
   * @returns JSON string containing message, code, and error details
   */
  get body() {
    return JSON.stringify({
      message: this.message,
      code: this.code,
      error: this.details,
    });
  }

  /**
   * Gets the default HTTP status message for a given status code.
   *
   * @param statusCode - The HTTP status code
   * @returns The standard HTTP status message or 'Unknown Error' if not found
   * @private
   */
  private getDefaultStatusMessage(statusCode: number): string {
    const statusMessages: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      406: 'Not Acceptable',
      408: 'Request Timeout',
      409: 'Conflict',
      410: 'Gone',
      422: 'Unprocessable Entity',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      501: 'Not Implemented',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      504: 'Gateway Timeout',
    };
    return statusMessages[statusCode] || 'Unknown Error';
  }

  /**
   * Serializes the error to a JSON-compatible object.
   * Useful for logging and debugging purposes.
   *
   * @returns Object representation of the error including stack trace
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      statusMessage: this.statusMessage,
      code: this.code,
      details: this.details,
      stack: this.stack,
    };
  }
}

// Client Error Classes (4xx)

/**
 * Represents a 400 Bad Request error.
 * Used when the client sends a malformed or invalid request.
 *
 * @extends HttpError
 *
 * @example
 * ```typescript
 * throw new BadRequestError('Invalid JSON', { line: 5, column: 12 });
 * ```
 */
export class BadRequestError extends HttpError {
  constructor(message?: string, details?: any) {
    super(400, message, { details });
  }
}

/**
 * Represents a 401 Unauthorized error.
 * Used when authentication is required but not provided or invalid.
 *
 * @extends HttpError
 *
 * @example
 * ```typescript
 * throw new UnauthorizedError('Invalid token');
 * ```
 */
export class UnauthorizedError extends HttpError {
  constructor(message?: string, details?: any) {
    super(401, message, { details });
  }
}

/**
 * Represents a 403 Forbidden error.
 * Used when the client is authenticated but lacks permission for the resource.
 *
 * @extends HttpError
 *
 * @example
 * ```typescript
 * throw new ForbiddenError('Insufficient permissions', { required: 'admin' });
 * ```
 */
export class ForbiddenError extends HttpError {
  constructor(message?: string, details?: any) {
    super(403, message, { details });
  }
}

/**
 * Represents a 404 Not Found error.
 * Used when the requested resource doesn't exist.
 *
 * @extends HttpError
 *
 * @example
 * ```typescript
 * throw new NotFoundError('User not found', { userId: '123' });
 * ```
 */
export class NotFoundError extends HttpError {
  constructor(message?: string, details?: any) {
    super(404, message, { details });
  }
}

/**
 * Represents a 405 Method Not Allowed error.
 * Used when the HTTP method is not supported for the requested resource.
 *
 * @extends HttpError
 *
 * @example
 * ```typescript
 * throw new MethodNotAllowedError('DELETE not supported', ['GET', 'POST', 'PUT']);
 * ```
 */
export class MethodNotAllowedError extends HttpError {
  /**
   * @param message - Optional error message
   * @param allowedMethods - Array of allowed HTTP methods for this resource
   */
  constructor(message?: string, allowedMethods?: string[]) {
    super(405, message, {
      details: allowedMethods ? { allowedMethods } : undefined,
    });
  }
}

/**
 * Represents a 409 Conflict error.
 * Used when the request conflicts with the current state of the resource.
 *
 * @extends HttpError
 *
 * @example
 * ```typescript
 * throw new ConflictError('Email already exists', { email: 'user@example.com' });
 * ```
 */
export class ConflictError extends HttpError {
  constructor(message?: string, details?: any) {
    super(409, message, { details });
  }
}

/**
 * Represents a 422 Unprocessable Entity error.
 * Used when the request is well-formed but contains semantic errors.
 *
 * @extends HttpError
 *
 * @example
 * ```typescript
 * throw new UnprocessableEntityError('Validation failed', {
 *   email: 'Invalid format',
 *   age: 'Must be 18 or older'
 * });
 * ```
 */
export class UnprocessableEntityError extends HttpError {
  /**
   * @param message - Optional error message
   * @param validationErrors - Object containing field-specific validation errors
   */
  constructor(message?: string, validationErrors?: any) {
    super(422, message, {
      details: validationErrors ? { validationErrors } : undefined,
    });
  }
}

/**
 * Represents a 429 Too Many Requests error.
 * Used when the client has exceeded rate limits.
 *
 * @extends HttpError
 *
 * @example
 * ```typescript
 * throw new TooManyRequestsError('Rate limit exceeded', 60); // retry after 60 seconds
 * ```
 */
export class TooManyRequestsError extends HttpError {
  /**
   * @param message - Optional error message
   * @param retryAfter - Number of seconds the client should wait before retrying
   */
  constructor(message?: string, retryAfter?: number) {
    super(429, message, {
      details: retryAfter ? { retryAfter } : undefined,
    });
  }
}

// Server Error Classes (5xx)

/**
 * Represents a 500 Internal Server Error.
 * Used for unexpected server-side errors.
 *
 * @extends HttpError
 *
 * @example
 * ```typescript
 * throw new InternalServerError('Database connection failed');
 * ```
 */
export class InternalServerError extends HttpError {
  constructor(message?: string, details?: any) {
    super(500, message, { details });
  }
}

/**
 * Represents a 501 Not Implemented error.
 * Used when the server doesn't support the requested functionality.
 *
 * @extends HttpError
 *
 * @example
 * ```typescript
 * throw new NotImplementedError('WebSocket support not implemented');
 * ```
 */
export class NotImplementedError extends HttpError {
  constructor(message?: string, details?: any) {
    super(501, message, { details });
  }
}

/**
 * Represents a 502 Bad Gateway error.
 * Used when the server receives an invalid response from an upstream server.
 *
 * @extends HttpError
 *
 * @example
 * ```typescript
 * throw new BadGatewayError('Upstream server error');
 * ```
 */
export class BadGatewayError extends HttpError {
  constructor(message?: string, details?: any) {
    super(502, message, { details });
  }
}

/**
 * Represents a 503 Service Unavailable error.
 * Used when the server is temporarily unable to handle requests.
 *
 * @extends HttpError
 *
 * @example
 * ```typescript
 * throw new ServiceUnavailableError('Maintenance in progress', 300); // retry after 5 minutes
 * ```
 */
export class ServiceUnavailableError extends HttpError {
  /**
   * @param message - Optional error message
   * @param retryAfter - Number of seconds the client should wait before retrying
   */
  constructor(message?: string, retryAfter?: number) {
    super(503, message, {
      details: retryAfter ? { retryAfter } : undefined,
    });
  }
}

/**
 * Represents a 504 Gateway Timeout error.
 * Used when the server doesn't receive a timely response from an upstream server.
 *
 * @extends HttpError
 *
 * @example
 * ```typescript
 * throw new GatewayTimeoutError('Upstream server timeout');
 * ```
 */
export class GatewayTimeoutError extends HttpError {
  constructor(message?: string, details?: any) {
    super(504, message, { details });
  }
}

// Type definitions for different error factory signatures

/** Factory function for standard HTTP errors with optional details */
type StandardErrorFactory = (message?: string, details?: any) => HttpError;
/** Factory function for Method Not Allowed errors with allowed methods */
type MethodNotAllowedFactory = (
  message?: string,
  allowedMethods?: string[],
) => MethodNotAllowedError;
/** Factory function for errors that include retry-after information */
type RetryAfterFactory = (message?: string, retryAfter?: number) => HttpError;
/** Factory function for validation errors with field-specific errors */
type ValidationErrorFactory = (
  message?: string,
  validationErrors?: any,
) => UnprocessableEntityError;

/** Discriminated union for all factory types */
type ErrorFactory =
  | { type: 'standard'; factory: StandardErrorFactory }
  | { type: 'methodNotAllowed'; factory: MethodNotAllowedFactory }
  | { type: 'retryAfter'; factory: RetryAfterFactory }
  | { type: 'validation'; factory: ValidationErrorFactory };

/** Type-safe error registry mapping status codes to their factory functions */
const errorRegistry = {
  400: {
    type: 'standard',
    factory: (m: string, d: any) => new BadRequestError(m, d),
  },
  401: {
    type: 'standard',
    factory: (m: string, d: any) => new UnauthorizedError(m, d),
  },
  403: {
    type: 'standard',
    factory: (m: string, d: any) => new ForbiddenError(m, d),
  },
  404: {
    type: 'standard',
    factory: (m: string, d: any) => new NotFoundError(m, d),
  },
  405: {
    type: 'methodNotAllowed',
    factory: (m: string, am: string[]) => new MethodNotAllowedError(m, am),
  },
  409: {
    type: 'standard',
    factory: (m: string, d: any) => new ConflictError(m, d),
  },
  422: {
    type: 'validation',
    factory: (m: string, ve: any) => new UnprocessableEntityError(m, ve),
  },
  429: {
    type: 'retryAfter',
    factory: (m: string, ra: number) => new TooManyRequestsError(m, ra),
  },
  500: {
    type: 'standard',
    factory: (m: string, d: any) => new InternalServerError(m, d),
  },
  501: {
    type: 'standard',
    factory: (m: string, d: any) => new NotImplementedError(m, d),
  },
  502: {
    type: 'standard',
    factory: (m: string, d: any) => new BadGatewayError(m, d),
  },
  503: {
    type: 'retryAfter',
    factory: (m: string, ra: number) => new ServiceUnavailableError(m, ra),
  },
  504: {
    type: 'standard',
    factory: (m: string, d: any) => new GatewayTimeoutError(m, d),
  },
} as const;

/** Valid status codes that have registered error factories */
type ValidStatusCode = keyof typeof errorRegistry;

/** Type-safe options based on status code, ensuring correct parameters for each error type */
type ErrorOptions<T extends number> = T extends 405
  ? { allowedMethods?: string[]; code?: string; cause?: Error }
  : T extends 422
    ? { validationErrors?: any; code?: string; cause?: Error }
    : T extends 429 | 503
      ? { retryAfter?: number; code?: string; cause?: Error }
      : { details?: any; code?: string; cause?: Error };

/** Handler functions for each factory type */
const factoryHandlers: Record<
  ErrorFactory['type'],
  (entry: any, message?: string, options?: any) => HttpError
> = {
  standard: (entry, message, options) =>
    entry.factory(message, options?.details),
  methodNotAllowed: (entry, message, options) =>
    entry.factory(message, options?.allowedMethods),
  retryAfter: (entry, message, options) =>
    entry.factory(message, options?.retryAfter),
  validation: (entry, message, options) =>
    entry.factory(message, options?.validationErrors),
};

/**
 * Creates an HTTP error with type-safe options based on the status code.
 * Provides IntelliSense support for status-code-specific options.
 *
 * @overload For known status codes with specific options
 * @param statusCode - A valid HTTP status code from the registry
 * @param message - Optional error message
 * @param options - Status-code-specific options
 * @returns The appropriate HttpError subclass
 *
 * @example
 * ```typescript
 * // TypeScript knows allowedMethods is valid for 405
 * createHttpError(405, 'Method not allowed', { allowedMethods: ['GET', 'POST'] });
 *
 * // TypeScript knows retryAfter is valid for 429
 * createHttpError(429, 'Rate limited', { retryAfter: 60 });
 * ```
 */
export function createHttpError<T extends ValidStatusCode>(
  statusCode: T,
  message?: string,
  options?: ErrorOptions<T>,
): HttpError;
export function createHttpError(
  statusCode: number,
  message?: string,
  options?: HttpErrorOptions,
): HttpError;
export function createHttpError(
  statusCode: number,
  message?: string,
  options?: any,
): HttpError {
  const entry = errorRegistry[statusCode as ValidStatusCode];

  if (entry) {
    const handler = factoryHandlers[entry.type];
    return handler(entry, message, options);
  }

  // Fallback to generic HttpError for unknown status codes
  return new HttpError(statusCode, message, options);
}

/**
 * Type-safe error creation utilities with descriptive method names.
 * Provides a fluent API for creating specific HTTP errors.
 *
 * @example
 * ```typescript
 * createError.notFound('User not found');
 * createError.badRequest('Invalid input', { field: 'email' });
 * createError.methodNotAllowed('DELETE not supported', ['GET', 'POST']);
 * ```
 */
export const createError = {
  badRequest: (message?: string, details?: any) =>
    new BadRequestError(message, details),

  unauthorized: (message?: string, details?: any) =>
    new UnauthorizedError(message, details),

  forbidden: (message?: string, details?: any) =>
    new ForbiddenError(message, details),

  notFound: (message?: string, details?: any) =>
    new NotFoundError(message, details),

  methodNotAllowed: (message?: string, allowedMethods?: string[]) =>
    new MethodNotAllowedError(message, allowedMethods),

  conflict: (message?: string, details?: any) =>
    new ConflictError(message, details),

  unprocessableEntity: (message?: string, validationErrors?: any) =>
    new UnprocessableEntityError(message, validationErrors),

  tooManyRequests: (message?: string, retryAfter?: number) =>
    new TooManyRequestsError(message, retryAfter),

  internalServerError: (message?: string, details?: any) =>
    new InternalServerError(message, details),

  notImplemented: (message?: string, details?: any) =>
    new NotImplementedError(message, details),

  badGateway: (message?: string, details?: any) =>
    new BadGatewayError(message, details),

  serviceUnavailable: (message?: string, retryAfter?: number) =>
    new ServiceUnavailableError(message, retryAfter),

  gatewayTimeout: (message?: string, details?: any) =>
    new GatewayTimeoutError(message, details),
} as const;

// Type guards

/**
 * Type guard to check if an error is an HttpError.
 * Works with both instanceof checks and duck typing.
 *
 * @param error - The error to check
 * @returns True if the error is an HttpError
 *
 * @example
 * ```typescript
 * try {
 *   // some code
 * } catch (error) {
 *   if (isHttpError(error)) {
 *     console.log(`HTTP ${error.statusCode}: ${error.message}`);
 *   }
 * }
 * ```
 */
export function isHttpError(error: unknown): error is HttpError {
  return (
    error instanceof HttpError ||
    (error !== null &&
      typeof error === 'object' &&
      'isHttpError' in error &&
      error.isHttpError === true)
  );
}

/**
 * Type guard to check if an error is a client error (4xx status code).
 *
 * @param error - The error to check
 * @returns True if the error is an HttpError with a 4xx status code
 *
 * @example
 * ```typescript
 * if (isClientError(error)) {
 *   // Log client error metrics
 * }
 * ```
 */
export function isClientError(error: unknown): error is HttpError {
  return (
    isHttpError(error) && error.statusCode >= 400 && error.statusCode < 500
  );
}

/**
 * Type guard to check if an error is a server error (5xx status code).
 *
 * @param error - The error to check
 * @returns True if the error is an HttpError with a 5xx status code
 *
 * @example
 * ```typescript
 * if (isServerError(error)) {
 *   // Trigger alerts for server errors
 * }
 * ```
 */
export function isServerError(error: unknown): error is HttpError {
  return (
    isHttpError(error) && error.statusCode >= 500 && error.statusCode < 600
  );
}

// Utility functions

/**
 * Wraps an unknown error into an HttpError.
 * If the error is already an HttpError, returns it unchanged.
 *
 * @param error - The error to wrap
 * @param statusCode - The HTTP status code to use (defaults to 500)
 * @param message - Optional message to override the original error message
 * @returns An HttpError instance
 *
 * @example
 * ```typescript
 * try {
 *   await someOperation();
 * } catch (error) {
 *   throw wrapError(error, 503, 'Service temporarily unavailable');
 * }
 * ```
 */
export function wrapError(
  error: unknown,
  statusCode = 500,
  message?: string,
): HttpError {
  if (isHttpError(error)) {
    return error;
  }

  if (error instanceof HttpError) {
    return error;
  }

  return new HttpError(statusCode, message || 'An unknown error occurred', {
    details: { originalError: error },
  });
}

// Types for better TypeScript support

/**
 * Options for creating an HttpError.
 */
export interface HttpErrorOptions {
  statusMessage?: string;
  details?: any;
  code?: string;
  cause?: Error;
}

/**
 * Constructor type for HttpError classes.
 * Useful for factory patterns and dependency injection.
 */
export type HttpErrorConstructor = new (
  message?: string,
  options?: HttpErrorOptions,
) => HttpError;

/**
 * HTTP status code enum for type-safe status code usage.
 * Includes common 2xx, 3xx, 4xx, and 5xx status codes.
 */
export enum HttpStatusCode {
  // 2xx Success
  OK = 200,
  CREATED = 201,
  ACCEPTED = 202,
  NO_CONTENT = 204,

  // 3xx Redirection
  MOVED_PERMANENTLY = 301,
  FOUND = 302,
  NOT_MODIFIED = 304,

  // 4xx Client Error
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  METHOD_NOT_ALLOWED = 405,
  NOT_ACCEPTABLE = 406,
  REQUEST_TIMEOUT = 408,
  CONFLICT = 409,
  GONE = 410,
  UNPROCESSABLE_ENTITY = 422,
  TOO_MANY_REQUESTS = 429,

  // 5xx Server Error
  INTERNAL_SERVER_ERROR = 500,
  NOT_IMPLEMENTED = 501,
  BAD_GATEWAY = 502,
  SERVICE_UNAVAILABLE = 503,
  GATEWAY_TIMEOUT = 504,
}

/**
 * Namespace containing all HTTP error classes.
 * Useful for importing all error types at once.
 *
 * @example
 * ```typescript
 * import { HttpErrors } from '@geekmidas/api/errors';
 * throw new HttpErrors.NotFoundError('Resource not found');
 * ```
 */
export const HttpErrors = {
  HttpError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  MethodNotAllowedError,
  ConflictError,
  UnprocessableEntityError,
  TooManyRequestsError,
  InternalServerError,
  NotImplementedError,
  BadGatewayError,
  ServiceUnavailableError,
  GatewayTimeoutError,
};

// Usage examples:
/*
// Basic usage
throw new NotFoundError('User not found');
throw new BadRequestError('Invalid email format', { field: 'email' });

// With validation errors
throw new UnprocessableEntityError('Validation failed', {
  email: 'Invalid email format',
  password: 'Password must be at least 8 characters',
});

// Type-safe factory function with IntelliSense support
throw createHttpError(405, 'Method not allowed', { 
  allowedMethods: ['GET', 'POST'] // TypeScript knows this is the correct option!
});

throw createHttpError(429, 'Too many requests', { 
  retryAfter: 60 // TypeScript knows this needs retryAfter, not details!
});

throw createHttpError(422, 'Validation failed', {
  validationErrors: { // TypeScript knows this is for validation errors
    email: 'Invalid format',
    age: 'Must be 18+'
  }
});

// Using the type-safe createError object
throw createError.methodNotAllowed('DELETE not supported', ['GET', 'POST']);
throw createError.tooManyRequests('Rate limit exceeded', 60);
throw createError.unprocessableEntity('Invalid input', {
  field: 'email',
  message: 'Invalid format'
});

// TypeScript will show errors for incorrect usage:
// throw createHttpError(404, 'Not found', { retryAfter: 60 }); // ❌ Type error!
// throw createError.notFound('User not found', 60); // ❌ Type error!

// Wrapping unknown errors
try {
  await someAsyncOperation();
} catch (error) {
  throw wrapError(error, 500, 'Failed to process request');
}

// In Express middleware
app.use(expressErrorHandler);

// Type checking
if (isClientError(error)) {
  console.log('Client made a bad request');
}
*/
