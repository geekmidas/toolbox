import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  type HttpError,
  InternalServerError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
  UnprocessableEntityError,
  createError,
  createHttpError,
  isHttpError,
} from '@geekmidas/api/errors';
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

// Example 1: Using specific error classes
const userEndpoint = e
  .get('/users/:id')
  .params(z.object({ id: z.string() }))
  .handle(async ({ params, logger }) => {
    // Simulate different error scenarios

    if (params.id === 'not-found') {
      throw new NotFoundError('User not found');
    }

    if (params.id === 'forbidden') {
      throw new ForbiddenError('You do not have permission to view this user');
    }

    if (params.id === 'server-error') {
      throw new InternalServerError('Database connection failed');
    }

    return { id: params.id, name: 'Test User' };
  });

// Example 2: Error with additional data
const loginEndpoint = e
  .post('/login')
  .body(
    z.object({
      email: z.string().email(),
      password: z.string(),
    }),
  )
  .handle(async ({ body }) => {
    if (body.email === 'locked@example.com') {
      throw new UnauthorizedError('Account locked', {
        reason: 'too_many_attempts',
        lockedUntil: new Date(Date.now() + 3600000).toISOString(),
      });
    }

    if (body.password !== 'correct-password') {
      throw new UnauthorizedError('Invalid credentials');
    }

    return { token: 'jwt-token', userId: '123' };
  });

// Example 3: Validation errors with details
const createProductEndpoint = e
  .post('/products')
  .body(
    z.object({
      name: z.string().min(1).max(100),
      price: z.number().positive(),
      category: z.string(),
      stock: z.number().int().min(0),
    }),
  )
  .handle(async ({ body }) => {
    // Custom validation beyond schema
    const validationErrors: Record<string, string> = {};

    if (body.name === 'reserved') {
      validationErrors.name = 'This product name is reserved';
    }

    if (body.price > 10000) {
      validationErrors.price = 'Price cannot exceed $10,000';
    }

    if (body.category === 'discontinued') {
      validationErrors.category =
        'Cannot create products in discontinued category';
    }

    if (Object.keys(validationErrors).length > 0) {
      throw new UnprocessableEntityError('Validation failed', {
        errors: validationErrors,
      });
    }

    return { id: '123', ...body };
  });

// Example 4: Using createError factory
const resourceEndpoint = e
  .put('/resources/:id')
  .params(z.object({ id: z.string() }))
  .body(z.object({ status: z.string() }))
  .handle(async ({ params, body }) => {
    if (params.id === 'conflict') {
      throw createError.conflict(
        'Resource is being modified by another process',
        {
          conflictId: 'abc123',
          retryAfter: 5,
        },
      );
    }

    if (body.status === 'invalid') {
      throw createError.unprocessableEntity('Invalid status transition', {
        currentStatus: 'active',
        requestedStatus: body.status,
        allowedTransitions: ['paused', 'completed'],
      });
    }

    return { id: params.id, status: body.status };
  });

// Example 5: Rate limiting with custom error
const rateLimitedEndpoint = e
  .post('/api/expensive-operation')
  .handle(async ({ req }) => {
    const clientId = req.headers.get('x-client-id') || 'anonymous';

    // Simulate rate limit check
    if (clientId === 'rate-limited') {
      throw new TooManyRequestsError('Rate limit exceeded', 3600);
    }

    return { result: 'Operation completed' };
  });

// Example 6: Creating custom HTTP errors by status code
const dynamicErrorEndpoint = e
  .get('/errors/:code')
  .params(z.object({ code: z.string().transform(Number) }))
  .handle(async ({ params }) => {
    // Create error by status code
    throw createHttpError(params.code);
  });

// Example 7: Error chaining and wrapping
const dataProcessingEndpoint = e
  .post('/process')
  .body(z.object({ data: z.string() }))
  .handle(async ({ body, logger }) => {
    try {
      // Simulate processing that might fail
      if (body.data === 'malformed') {
        throw new Error('JSON parsing failed');
      }

      return { processed: true };
    } catch (error) {
      logger.error({ error }, 'Processing failed');

      // Wrap non-HTTP errors
      if (!isHttpError(error)) {
        throw new BadRequestError('Failed to process data', {
          originalError: error instanceof Error ? error.message : String(error),
        });
      }

      throw error;
    }
  });

// Example 8: Conditional error responses
const conditionalEndpoint = e
  .get('/conditional/:type')
  .params(
    z.object({
      type: z.enum(['success', 'client-error', 'server-error']),
    }),
  )
  .handle(async ({ params }) => {
    switch (params.type) {
      case 'client-error':
        // Randomly throw different client errors
        const clientErrors = [
          () => new BadRequestError('Invalid request format'),
          () => new UnauthorizedError('Authentication required'),
          () => new ForbiddenError('Insufficient permissions'),
          () => new NotFoundError('Resource not found'),
        ];
        throw clientErrors[Math.floor(Math.random() * clientErrors.length)]();

      case 'server-error':
        // Randomly throw different server errors
        const serverErrors = [
          () => new InternalServerError('Database connection lost'),
          () => createError.badGateway('Upstream service unavailable'),
          () => createError.serviceUnavailable('Service under maintenance'),
        ];
        throw serverErrors[Math.floor(Math.random() * serverErrors.length)]();

      default:
        return { message: 'Success!' };
    }
  });

// Example 9: Error recovery and fallbacks
const resilientEndpoint = e
  .get('/resilient/:service')
  .params(z.object({ service: z.string() }))
  .handle(async ({ params, logger }) => {
    try {
      // Try primary service
      if (params.service === 'primary-down') {
        throw new Error('Primary service unavailable');
      }

      return { data: 'From primary service', service: params.service };
    } catch (primaryError) {
      logger.warn(
        { error: primaryError },
        'Primary service failed, trying fallback',
      );

      try {
        // Try fallback service
        if (params.service === 'both-down') {
          throw new Error('Fallback service also unavailable');
        }

        return { data: 'From fallback service', service: 'fallback' };
      } catch (fallbackError) {
        logger.error({ primaryError, fallbackError }, 'All services failed');

        throw createError.serviceUnavailable(
          'All services are currently unavailable',
          60,
        );
      }
    }
  });

// Example 10: Complex error handling with multiple checks
const complexValidationEndpoint = e
  .post('/complex-validation')
  .body(
    z.object({
      user: z.object({
        id: z.string(),
        role: z.enum(['admin', 'user', 'guest']),
      }),
      action: z.string(),
      resources: z.array(z.string()).min(1),
    }),
  )
  .handle(async ({ body }) => {
    const errors: HttpError[] = [];

    // Check user exists
    if (body.user.id === 'non-existent') {
      errors.push(new NotFoundError('User not found'));
    }

    // Check permissions
    if (body.user.role === 'guest' && body.action === 'delete') {
      errors.push(new ForbiddenError('Guests cannot delete resources'));
    }

    // Check resource conflicts
    if (body.resources.includes('locked-resource')) {
      errors.push(new ConflictError('One or more resources are locked'));
    }

    // If multiple errors, throw the most severe one
    if (errors.length > 0) {
      // Sort by status code (lower = more severe for client errors)
      errors.sort((a, b) => a.statusCode - b.statusCode);
      throw errors[0];
    }

    return { success: true, processed: body.resources.length };
  });

// Example 11: Custom error handler wrapper
function withErrorHandling<T>(
  handler: () => Promise<T>,
  logger: any,
): Promise<T> {
  return handler().catch((error) => {
    // Log all errors
    logger.error({ error }, 'Request failed');

    // Add request ID to error data
    if (isHttpError(error)) {
      throw createHttpError(error.statusCode, error.message, {
        cause: error,
        details: {
          requestId: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Convert unknown errors to 500
    throw new InternalServerError('An unexpected error occurred', {
      requestId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    });
  });
}

// Using the wrapper
const wrappedEndpoint = e.get('/wrapped').handle(async ({ logger }) => {
  return withErrorHandling(async () => {
    // Your logic here
    throw new Error('Something went wrong');
  }, logger);
});

// Example 12: Testing error scenarios
export const errorScenarios = {
  notFound: () => {
    throw new NotFoundError('Test not found error');
  },

  unauthorized: () => {
    throw new UnauthorizedError('Test unauthorized error', {
      reason: 'invalid_token',
    });
  },

  validation: () => {
    throw new UnprocessableEntityError('Test validation error', {
      errors: {
        field1: 'Required',
        field2: 'Must be positive',
      },
    });
  },

  rateLimit: () => {
    throw new TooManyRequestsError('Test rate limit error', 60);
  },

  serverError: () => {
    throw new InternalServerError('Test server error');
  },
};
