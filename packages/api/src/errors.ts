// http-errors.ts - Core HTTP Error Classes and Types

/**
 * Base HTTP Error class that extends the native Error
 */
export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly statusMessage: string;
  public readonly isHttpError = true;
  public readonly details?: any;
  public readonly code?: string;

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

  get body() {
    return JSON.stringify({
      message: this.message,
      code: this.code,
      error: this.details,
    });
  }

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
export class BadRequestError extends HttpError {
  constructor(message?: string, details?: any) {
    super(400, message, { details });
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message?: string, details?: any) {
    super(401, message, { details });
  }
}

export class ForbiddenError extends HttpError {
  constructor(message?: string, details?: any) {
    super(403, message, { details });
  }
}

export class NotFoundError extends HttpError {
  constructor(message?: string, details?: any) {
    super(404, message, { details });
  }
}

export class MethodNotAllowedError extends HttpError {
  constructor(message?: string, allowedMethods?: string[]) {
    super(405, message, {
      details: allowedMethods ? { allowedMethods } : undefined,
    });
  }
}

export class ConflictError extends HttpError {
  constructor(message?: string, details?: any) {
    super(409, message, { details });
  }
}

export class UnprocessableEntityError extends HttpError {
  constructor(message?: string, validationErrors?: any) {
    super(422, message, {
      details: validationErrors ? { validationErrors } : undefined,
    });
  }
}

export class TooManyRequestsError extends HttpError {
  constructor(message?: string, retryAfter?: number) {
    super(429, message, {
      details: retryAfter ? { retryAfter } : undefined,
    });
  }
}

// Server Error Classes (5xx)
export class InternalServerError extends HttpError {
  constructor(message?: string, details?: any) {
    super(500, message, { details });
  }
}

export class NotImplementedError extends HttpError {
  constructor(message?: string, details?: any) {
    super(501, message, { details });
  }
}

export class BadGatewayError extends HttpError {
  constructor(message?: string, details?: any) {
    super(502, message, { details });
  }
}

export class ServiceUnavailableError extends HttpError {
  constructor(message?: string, retryAfter?: number) {
    super(503, message, {
      details: retryAfter ? { retryAfter } : undefined,
    });
  }
}

export class GatewayTimeoutError extends HttpError {
  constructor(message?: string, details?: any) {
    super(504, message, { details });
  }
}

// Type definitions for different error factory signatures
type StandardErrorFactory = (message?: string, details?: any) => HttpError;
type MethodNotAllowedFactory = (
  message?: string,
  allowedMethods?: string[],
) => MethodNotAllowedError;
type RetryAfterFactory = (message?: string, retryAfter?: number) => HttpError;
type ValidationErrorFactory = (
  message?: string,
  validationErrors?: any,
) => UnprocessableEntityError;

// Discriminated union for all factory types
type ErrorFactory =
  | { type: 'standard'; factory: StandardErrorFactory }
  | { type: 'methodNotAllowed'; factory: MethodNotAllowedFactory }
  | { type: 'retryAfter'; factory: RetryAfterFactory }
  | { type: 'validation'; factory: ValidationErrorFactory };

// Type-safe error registry
const errorRegistry = {
  400: { type: 'standard', factory: (m, d) => new BadRequestError(m, d) },
  401: { type: 'standard', factory: (m, d) => new UnauthorizedError(m, d) },
  403: { type: 'standard', factory: (m, d) => new ForbiddenError(m, d) },
  404: { type: 'standard', factory: (m, d) => new NotFoundError(m, d) },
  405: {
    type: 'methodNotAllowed',
    factory: (m, am) => new MethodNotAllowedError(m, am),
  },
  409: { type: 'standard', factory: (m, d) => new ConflictError(m, d) },
  422: {
    type: 'validation',
    factory: (m, ve) => new UnprocessableEntityError(m, ve),
  },
  429: {
    type: 'retryAfter',
    factory: (m, ra) => new TooManyRequestsError(m, ra),
  },
  500: { type: 'standard', factory: (m, d) => new InternalServerError(m, d) },
  501: { type: 'standard', factory: (m, d) => new NotImplementedError(m, d) },
  502: { type: 'standard', factory: (m, d) => new BadGatewayError(m, d) },
  503: {
    type: 'retryAfter',
    factory: (m, ra) => new ServiceUnavailableError(m, ra),
  },
  504: { type: 'standard', factory: (m, d) => new GatewayTimeoutError(m, d) },
} as const;

// Extract valid status codes from registry
type ValidStatusCode = keyof typeof errorRegistry;

// Type-safe options based on status code
type ErrorOptions<T extends number> = T extends 405
  ? { allowedMethods?: string[]; code?: string; cause?: Error }
  : T extends 422
    ? { validationErrors?: any; code?: string; cause?: Error }
    : T extends 429 | 503
      ? { retryAfter?: number; code?: string; cause?: Error }
      : { details?: any; code?: string; cause?: Error };

// Handler functions for each factory type
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

// Overloaded factory function for type safety
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

// Type-safe error creation with status code literals
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
export function isHttpError(error: unknown): error is HttpError {
  return (
    error instanceof HttpError ||
    (error !== null &&
      typeof error === 'object' &&
      'isHttpError' in error &&
      error.isHttpError === true)
  );
}

export function isClientError(error: unknown): error is HttpError {
  return (
    isHttpError(error) && error.statusCode >= 400 && error.statusCode < 500
  );
}

export function isServerError(error: unknown): error is HttpError {
  return (
    isHttpError(error) && error.statusCode >= 500 && error.statusCode < 600
  );
}

// Utility functions
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
export interface HttpErrorOptions {
  statusMessage?: string;
  details?: any;
  code?: string;
  cause?: Error;
}

export type HttpErrorConstructor = new (
  message?: string,
  options?: HttpErrorOptions,
) => HttpError;

// Status code enum for type safety
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

// Export all errors as a namespace for easier imports
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
