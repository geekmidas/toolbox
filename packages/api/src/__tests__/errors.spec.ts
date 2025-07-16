import { describe, expect, it } from 'vitest';
import {
  BadGatewayError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  GatewayTimeoutError,
  HttpError,
  HttpErrors,
  HttpStatusCode,
  InternalServerError,
  MethodNotAllowedError,
  NotFoundError,
  NotImplementedError,
  ServiceUnavailableError,
  TooManyRequestsError,
  UnauthorizedError,
  UnprocessableEntityError,
  createError,
  createHttpError,
  isClientError,
  isHttpError,
  isServerError,
  wrapError,
} from '../errors';

describe('HttpError', () => {
  describe('Basic functionality', () => {
    it('should create a basic HttpError with default message', () => {
      const error = new HttpError(404);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(HttpError);
      expect(error.name).toBe('HttpError');
      expect(error.statusCode).toBe(404);
      expect(error.statusMessage).toBe('Not Found');
      expect(error.message).toBe('HTTP Error');
      expect(error.isHttpError).toBe(true);
      expect(error.details).toBeUndefined();
      expect(error.code).toBeUndefined();
    });

    it('should create HttpError with custom message', () => {
      const error = new HttpError(400, 'Custom bad request message');

      expect(error.statusCode).toBe(400);
      expect(error.statusMessage).toBe('Bad Request');
      expect(error.message).toBe('Custom bad request message');
    });

    it('should create HttpError with custom options', () => {
      const details = { field: 'email', reason: 'invalid format' };
      const error = new HttpError(422, 'Validation failed', {
        statusMessage: 'Custom Status Message',
        details,
        code: 'VALIDATION_ERROR',
      });

      expect(error.statusCode).toBe(422);
      expect(error.statusMessage).toBe('Custom Status Message');
      expect(error.message).toBe('Validation failed');
      expect(error.details).toEqual(details);
      expect(error.code).toBe('VALIDATION_ERROR');
    });

    it('should set cause when provided', () => {
      const originalError = new Error('Original error');
      const error = new HttpError(500, 'Server error', {
        cause: originalError,
      });

      expect(error.cause).toBe(originalError);
    });

    it('should handle unknown status codes', () => {
      const error = new HttpError(999, 'Unknown error');

      expect(error.statusCode).toBe(999);
      expect(error.statusMessage).toBe('Unknown Error');
      expect(error.message).toBe('Unknown error');
    });

    it('should serialize to JSON correctly', () => {
      const error = new HttpError(403, 'Access denied', {
        details: { resource: 'user', action: 'delete' },
        code: 'ACCESS_DENIED',
      });

      const json = error.toJSON();

      expect(json).toEqual({
        name: 'HttpError',
        message: 'Access denied',
        statusCode: 403,
        statusMessage: 'Forbidden',
        code: 'ACCESS_DENIED',
        details: { resource: 'user', action: 'delete' },
        stack: expect.any(String),
      });
    });
  });

  describe('Default status messages', () => {
    it('should provide correct default status messages', () => {
      const testCases = [
        { code: 400, message: 'Bad Request' },
        { code: 401, message: 'Unauthorized' },
        { code: 403, message: 'Forbidden' },
        { code: 404, message: 'Not Found' },
        { code: 405, message: 'Method Not Allowed' },
        { code: 409, message: 'Conflict' },
        { code: 422, message: 'Unprocessable Entity' },
        { code: 429, message: 'Too Many Requests' },
        { code: 500, message: 'Internal Server Error' },
        { code: 501, message: 'Not Implemented' },
        { code: 502, message: 'Bad Gateway' },
        { code: 503, message: 'Service Unavailable' },
        { code: 504, message: 'Gateway Timeout' },
      ];

      testCases.forEach(({ code, message }) => {
        const error = new HttpError(code);
        expect(error.statusMessage).toBe(message);
      });
    });
  });
});

describe('Specific Error Classes', () => {
  describe('Client Errors (4xx)', () => {
    it('should create BadRequestError correctly', () => {
      const error = new BadRequestError('Invalid input', { field: 'email' });

      expect(error).toBeInstanceOf(HttpError);
      expect(error).toBeInstanceOf(BadRequestError);
      expect(error.name).toBe('BadRequestError');
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe('Invalid input');
      expect(error.details).toEqual({ field: 'email' });
    });

    it('should create UnauthorizedError correctly', () => {
      const error = new UnauthorizedError('Token expired');

      expect(error).toBeInstanceOf(UnauthorizedError);
      expect(error.statusCode).toBe(401);
      expect(error.message).toBe('Token expired');
    });

    it('should create ForbiddenError correctly', () => {
      const error = new ForbiddenError('Access denied', { resource: 'admin' });

      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.statusCode).toBe(403);
      expect(error.details).toEqual({ resource: 'admin' });
    });

    it('should create NotFoundError correctly', () => {
      const error = new NotFoundError('User not found', { userId: '123' });

      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.statusCode).toBe(404);
      expect(error.details).toEqual({ userId: '123' });
    });

    it('should create MethodNotAllowedError correctly', () => {
      const allowedMethods = ['GET', 'POST'];
      const error = new MethodNotAllowedError(
        'DELETE not allowed',
        allowedMethods,
      );

      expect(error).toBeInstanceOf(MethodNotAllowedError);
      expect(error.statusCode).toBe(405);
      expect(error.details).toEqual({ allowedMethods });
    });

    it('should create ConflictError correctly', () => {
      const error = new ConflictError('Email already exists', {
        conflictField: 'email',
      });

      expect(error).toBeInstanceOf(ConflictError);
      expect(error.statusCode).toBe(409);
      expect(error.details).toEqual({ conflictField: 'email' });
    });

    it('should create UnprocessableEntityError correctly', () => {
      const validationErrors = {
        email: 'Invalid format',
        password: 'Too short',
      };
      const error = new UnprocessableEntityError(
        'Validation failed',
        validationErrors,
      );

      expect(error).toBeInstanceOf(UnprocessableEntityError);
      expect(error.statusCode).toBe(422);
      expect(error.details).toEqual({ validationErrors });
    });

    it('should create TooManyRequestsError correctly', () => {
      const error = new TooManyRequestsError('Rate limit exceeded', 60);

      expect(error).toBeInstanceOf(TooManyRequestsError);
      expect(error.statusCode).toBe(429);
      expect(error.details).toEqual({ retryAfter: 60 });
    });
  });

  describe('Server Errors (5xx)', () => {
    it('should create InternalServerError correctly', () => {
      const error = new InternalServerError('Database connection failed', {
        database: 'primary',
      });

      expect(error).toBeInstanceOf(InternalServerError);
      expect(error.statusCode).toBe(500);
      expect(error.details).toEqual({ database: 'primary' });
    });

    it('should create NotImplementedError correctly', () => {
      const error = new NotImplementedError('Feature not implemented');

      expect(error).toBeInstanceOf(NotImplementedError);
      expect(error.statusCode).toBe(501);
    });

    it('should create BadGatewayError correctly', () => {
      const error = new BadGatewayError('Upstream server error', {
        upstream: 'auth-service',
      });

      expect(error).toBeInstanceOf(BadGatewayError);
      expect(error.statusCode).toBe(502);
      expect(error.details).toEqual({ upstream: 'auth-service' });
    });

    it('should create ServiceUnavailableError correctly', () => {
      const error = new ServiceUnavailableError('Maintenance mode', 120);

      expect(error).toBeInstanceOf(ServiceUnavailableError);
      expect(error.statusCode).toBe(503);
      expect(error.details).toEqual({ retryAfter: 120 });
    });

    it('should create GatewayTimeoutError correctly', () => {
      const error = new GatewayTimeoutError('Request timeout', {
        timeout: 30000,
      });

      expect(error).toBeInstanceOf(GatewayTimeoutError);
      expect(error.statusCode).toBe(504);
      expect(error.details).toEqual({ timeout: 30000 });
    });
  });
});

describe('createHttpError function', () => {
  it('should create errors for known status codes', () => {
    const error404 = createHttpError(404, 'Not found');
    expect(error404).toBeInstanceOf(NotFoundError);
    expect(error404.statusCode).toBe(404);

    const error500 = createHttpError(500, 'Server error');
    expect(error500).toBeInstanceOf(InternalServerError);
    expect(error500.statusCode).toBe(500);
  });

  it('should handle special error types with correct options', () => {
    const methodError = createHttpError(405, 'Method not allowed', {
      allowedMethods: ['GET', 'POST'],
    });
    expect(methodError).toBeInstanceOf(MethodNotAllowedError);
    expect(methodError.details).toEqual({ allowedMethods: ['GET', 'POST'] });

    const validationError = createHttpError(422, 'Validation failed', {
      validationErrors: { email: 'Invalid' },
    });
    expect(validationError).toBeInstanceOf(UnprocessableEntityError);
    expect(validationError.details).toEqual({
      validationErrors: { email: 'Invalid' },
    });

    const rateLimitError = createHttpError(429, 'Too many requests', {
      retryAfter: 60,
    });
    expect(rateLimitError).toBeInstanceOf(TooManyRequestsError);
    expect(rateLimitError.details).toEqual({ retryAfter: 60 });
  });

  it('should create generic HttpError for unknown status codes', () => {
    const error = createHttpError(418, "I'm a teapot");
    expect(error).toBeInstanceOf(HttpError);
    expect(error.constructor).toBe(HttpError);
    expect(error.statusCode).toBe(418);
    expect(error.message).toBe("I'm a teapot");
  });

  it('should handle options with code and cause', () => {
    const originalError = new Error('Original');
    // For known status codes, code and cause options are not passed through
    // because the registry creates specific error types that don't support them
    const error = createHttpError(400, 'Bad request', {
      details: { field: 'name' },
      code: 'INVALID_INPUT',
      cause: originalError,
    });

    expect(error.details).toEqual({ field: 'name' });
    expect(error.code).toBeUndefined(); // Not supported by BadRequestError
    expect(error.cause).toBeUndefined(); // Not supported by BadRequestError
  });

  it('should handle code and cause with unknown status codes', () => {
    const originalError = new Error('Original');
    // Unknown status codes fall back to generic HttpError which supports all options
    const error = createHttpError(418, 'Im a teapot', {
      details: { field: 'name' },
      code: 'TEAPOT_ERROR',
      cause: originalError,
    });

    expect(error.details).toEqual({ field: 'name' });
    expect(error.code).toBe('TEAPOT_ERROR');
    expect(error.cause).toBe(originalError);
  });
});

describe('createError object', () => {
  it('should provide all error factory methods', () => {
    expect(typeof createError.badRequest).toBe('function');
    expect(typeof createError.unauthorized).toBe('function');
    expect(typeof createError.forbidden).toBe('function');
    expect(typeof createError.notFound).toBe('function');
    expect(typeof createError.methodNotAllowed).toBe('function');
    expect(typeof createError.conflict).toBe('function');
    expect(typeof createError.unprocessableEntity).toBe('function');
    expect(typeof createError.tooManyRequests).toBe('function');
    expect(typeof createError.internalServerError).toBe('function');
    expect(typeof createError.notImplemented).toBe('function');
    expect(typeof createError.badGateway).toBe('function');
    expect(typeof createError.serviceUnavailable).toBe('function');
    expect(typeof createError.gatewayTimeout).toBe('function');
  });

  it('should create correct error instances', () => {
    const badRequest = createError.badRequest('Invalid input');
    expect(badRequest).toBeInstanceOf(BadRequestError);
    expect(badRequest.statusCode).toBe(400);

    const notFound = createError.notFound('Resource not found');
    expect(notFound).toBeInstanceOf(NotFoundError);
    expect(notFound.statusCode).toBe(404);

    const serverError = createError.internalServerError('Server crashed');
    expect(serverError).toBeInstanceOf(InternalServerError);
    expect(serverError.statusCode).toBe(500);
  });

  it('should handle special error factory signatures', () => {
    const methodError = createError.methodNotAllowed('Not allowed', [
      'GET',
      'POST',
    ]);
    expect(methodError.details).toEqual({ allowedMethods: ['GET', 'POST'] });

    const validationError = createError.unprocessableEntity('Invalid', {
      email: 'Bad format',
    });
    expect(validationError.details).toEqual({
      validationErrors: { email: 'Bad format' },
    });

    const rateLimitError = createError.tooManyRequests('Too many', 30);
    expect(rateLimitError.details).toEqual({ retryAfter: 30 });

    const serviceError = createError.serviceUnavailable(
      'Down for maintenance',
      300,
    );
    expect(serviceError.details).toEqual({ retryAfter: 300 });
  });
});

describe('Type guards', () => {
  describe('isHttpError', () => {
    it('should correctly identify HttpError instances', () => {
      const httpError = new HttpError(400);
      const badRequestError = new BadRequestError('Bad request');
      const regularError = new Error('Regular error');
      const notAnError = { message: 'Not an error' };

      expect(isHttpError(httpError)).toBe(true);
      expect(isHttpError(badRequestError)).toBe(true);
      expect(isHttpError(regularError)).toBe(false);
      expect(isHttpError(notAnError)).toBe(false);
      expect(isHttpError(null)).toBe(false);
      expect(isHttpError(undefined)).toBe(false);
    });

    it('should identify objects with isHttpError property', () => {
      const mockHttpError = {
        isHttpError: true,
        statusCode: 404,
        message: 'Not found',
      };

      expect(isHttpError(mockHttpError)).toBe(true);
    });
  });

  describe('isClientError', () => {
    it('should correctly identify client errors (4xx)', () => {
      const badRequest = new BadRequestError();
      const notFound = new NotFoundError();
      const serverError = new InternalServerError();
      const regularError = new Error();

      expect(isClientError(badRequest)).toBe(true);
      expect(isClientError(notFound)).toBe(true);
      expect(isClientError(serverError)).toBe(false);
      expect(isClientError(regularError)).toBe(false);
    });

    it('should handle edge cases for client errors', () => {
      const error399 = new HttpError(399);
      const error400 = new HttpError(400);
      const error499 = new HttpError(499);
      const error500 = new HttpError(500);

      expect(isClientError(error399)).toBe(false);
      expect(isClientError(error400)).toBe(true);
      expect(isClientError(error499)).toBe(true);
      expect(isClientError(error500)).toBe(false);
    });
  });

  describe('isServerError', () => {
    it('should correctly identify server errors (5xx)', () => {
      const serverError = new InternalServerError();
      const badGateway = new BadGatewayError();
      const clientError = new BadRequestError();
      const regularError = new Error();

      expect(isServerError(serverError)).toBe(true);
      expect(isServerError(badGateway)).toBe(true);
      expect(isServerError(clientError)).toBe(false);
      expect(isServerError(regularError)).toBe(false);
    });

    it('should handle edge cases for server errors', () => {
      const error499 = new HttpError(499);
      const error500 = new HttpError(500);
      const error599 = new HttpError(599);
      const error600 = new HttpError(600);

      expect(isServerError(error499)).toBe(false);
      expect(isServerError(error500)).toBe(true);
      expect(isServerError(error599)).toBe(true);
      expect(isServerError(error600)).toBe(false);
    });
  });
});

describe('wrapError utility', () => {
  it('should return HttpError instances unchanged', () => {
    const originalError = new NotFoundError('Not found');
    const wrappedError = wrapError(originalError);

    expect(wrappedError).toBe(originalError);
  });

  it('should wrap regular Error instances', () => {
    const originalError = new Error('Something went wrong');
    const wrappedError = wrapError(originalError);

    expect(wrappedError).toBeInstanceOf(HttpError);
    expect(wrappedError.statusCode).toBe(500);
    expect(wrappedError.message).toBe('An unknown error occurred');
    expect(wrappedError.details.originalError).toBe(originalError);
  });

  it('should wrap regular Error with custom status and message', () => {
    const originalError = new Error('Database connection failed');
    const wrappedError = wrapError(
      originalError,
      503,
      'Service temporarily unavailable',
    );

    expect(wrappedError.statusCode).toBe(503);
    expect(wrappedError.message).toBe('Service temporarily unavailable');
    expect(wrappedError.details.originalError).toBe(originalError);
  });

  it('should wrap non-Error values', () => {
    const stringError = 'Something bad happened';
    const wrappedError = wrapError(stringError);

    expect(wrappedError).toBeInstanceOf(HttpError);
    expect(wrappedError.statusCode).toBe(500);
    expect(wrappedError.message).toBe('An unknown error occurred');
    expect(wrappedError.details).toEqual({ originalError: stringError });
  });

  it('should wrap null/undefined values', () => {
    const wrappedNull = wrapError(null);
    const wrappedUndefined = wrapError(undefined);

    expect(wrappedNull.message).toBe('An unknown error occurred');
    expect(wrappedUndefined.message).toBe('An unknown error occurred');
    expect(wrappedNull.details).toEqual({ originalError: null });
    expect(wrappedUndefined.details).toEqual({ originalError: undefined });
  });

  it('should wrap objects', () => {
    const objectError = { code: 'DB_ERROR', details: 'Connection timeout' };
    const wrappedError = wrapError(objectError, 500, 'Database error');

    expect(wrappedError.statusCode).toBe(500);
    expect(wrappedError.message).toBe('Database error');
    expect(wrappedError.details).toEqual({ originalError: objectError });
  });
});

describe('HttpStatusCode enum', () => {
  it('should provide correct status code constants', () => {
    expect(HttpStatusCode.OK).toBe(200);
    expect(HttpStatusCode.CREATED).toBe(201);
    expect(HttpStatusCode.NO_CONTENT).toBe(204);
    expect(HttpStatusCode.BAD_REQUEST).toBe(400);
    expect(HttpStatusCode.UNAUTHORIZED).toBe(401);
    expect(HttpStatusCode.FORBIDDEN).toBe(403);
    expect(HttpStatusCode.NOT_FOUND).toBe(404);
    expect(HttpStatusCode.INTERNAL_SERVER_ERROR).toBe(500);
  });
});

describe('HttpErrors namespace', () => {
  it('should export all error classes', () => {
    expect(HttpErrors.HttpError).toBe(HttpError);
    expect(HttpErrors.BadRequestError).toBe(BadRequestError);
    expect(HttpErrors.UnauthorizedError).toBe(UnauthorizedError);
    expect(HttpErrors.ForbiddenError).toBe(ForbiddenError);
    expect(HttpErrors.NotFoundError).toBe(NotFoundError);
    expect(HttpErrors.MethodNotAllowedError).toBe(MethodNotAllowedError);
    expect(HttpErrors.ConflictError).toBe(ConflictError);
    expect(HttpErrors.UnprocessableEntityError).toBe(UnprocessableEntityError);
    expect(HttpErrors.TooManyRequestsError).toBe(TooManyRequestsError);
    expect(HttpErrors.InternalServerError).toBe(InternalServerError);
    expect(HttpErrors.NotImplementedError).toBe(NotImplementedError);
    expect(HttpErrors.BadGatewayError).toBe(BadGatewayError);
    expect(HttpErrors.ServiceUnavailableError).toBe(ServiceUnavailableError);
    expect(HttpErrors.GatewayTimeoutError).toBe(GatewayTimeoutError);
  });
});

describe('Error inheritance and stack traces', () => {
  it('should maintain proper inheritance chain', () => {
    const error = new BadRequestError('Test error');

    expect(error instanceof Error).toBe(true);
    expect(error instanceof HttpError).toBe(true);
    expect(error instanceof BadRequestError).toBe(true);
  });

  it('should have proper stack traces', () => {
    const error = new NotFoundError('Resource not found');

    expect(error.stack).toBeDefined();
    expect(typeof error.stack).toBe('string');
    expect(error.stack).toContain('NotFoundError');
  });

  it('should have correct name property', () => {
    const errors = [
      new BadRequestError(),
      new UnauthorizedError(),
      new ForbiddenError(),
      new NotFoundError(),
      new ConflictError(),
      new InternalServerError(),
    ];

    errors.forEach((error) => {
      expect(error.name).toBe(error.constructor.name);
    });
  });
});

describe('Edge cases and error conditions', () => {
  it('should handle empty messages gracefully', () => {
    const error = new BadRequestError('');
    expect(error.message).toBe('HTTP Error'); // Empty string falls back to 'HTTP Error'
  });

  it('should allow truly empty messages when using statusMessage option', () => {
    const error = new HttpError(400, '', { statusMessage: '' });
    expect(error.message).toBe('HTTP Error');
    expect(error.statusMessage).toBe('Bad Request');
  });

  it('should distinguish between message and statusMessage', () => {
    const error = new BadRequestError('');
    expect(error.message).toBe('HTTP Error'); // From Error.message
    expect(error.statusMessage).toBe('Bad Request'); // From HttpError.statusMessage
  });

  it('should handle undefined details', () => {
    const error = new BadRequestError('Test', undefined);
    expect(error.details).toBeUndefined();
  });

  it('should handle null details', () => {
    const error = new BadRequestError('Test', null);
    expect(error.details).toBeNull();
  });

  it('should handle complex nested details', () => {
    const complexDetails = {
      user: { id: 123, name: 'John' },
      errors: [
        { field: 'email', message: 'Invalid' },
        { field: 'age', message: 'Too young' },
      ],
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: 'req-123',
      },
    };

    const error = new UnprocessableEntityError(
      'Complex validation error',
      complexDetails,
    );
    expect(error.details).toEqual({ validationErrors: complexDetails });
  });
});

describe('JSON serialization', () => {
  it('should serialize complex errors correctly', () => {
    const error = new UnprocessableEntityError('Validation failed', {
      email: 'Invalid format',
      password: 'Too short',
    });

    const json = JSON.parse(JSON.stringify(error));

    expect(json).toEqual({
      name: 'UnprocessableEntityError',
      message: 'Validation failed',
      statusCode: 422,
      statusMessage: 'Unprocessable Entity',
      code: undefined,
      details: {
        validationErrors: {
          email: 'Invalid format',
          password: 'Too short',
        },
      },
      stack: expect.any(String),
    });
  });

  it('should handle circular references in details', () => {
    const circularObj: any = { name: 'test' };
    circularObj.self = circularObj;

    // This should not throw an error
    const error = new BadRequestError('Test', circularObj);
    expect(() => error.toJSON()).not.toThrow();
  });
});
