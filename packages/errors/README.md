# @geekmidas/errors

Type-safe HTTP error classes with full TypeScript support, providing structured error handling for REST APIs and HTTP-based applications.

## Features

- **Type-Safe Errors**: Full TypeScript support with proper error hierarchies
- **HTTP Status Codes**: Pre-built error classes for all common HTTP errors
- **Structured Error Details**: Include additional context and debugging information
- **Error Factories**: Convenient factory functions for creating errors
- **Type Guards**: Runtime type checking for error instances
- **JSON Serialization**: Built-in support for error serialization
- **Error Wrapping**: Wrap unknown errors into HTTP errors
- **Cause Chaining**: ES2022 error cause support for error chains

## Installation

```bash
pnpm add @geekmidas/errors
```

## Quick Start

### Basic Usage

```typescript
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  InternalServerError
} from '@geekmidas/errors';

// Throw specific error types
throw new NotFoundError('User not found');
throw new BadRequestError('Invalid email format');
throw new UnauthorizedError('Invalid token');
throw new InternalServerError('Database connection failed');
```

### With Error Details

```typescript
import { BadRequestError, NotFoundError } from '@geekmidas/errors';

// Include additional context
throw new NotFoundError('User not found', { userId: '123' });

throw new BadRequestError('Validation failed', {
  field: 'email',
  value: 'invalid-email',
  message: 'Must be a valid email address'
});
```

## Available Error Classes

### Client Errors (4xx)

```typescript
import {
  BadRequestError,           // 400
  UnauthorizedError,        // 401
  ForbiddenError,           // 403
  NotFoundError,            // 404
  MethodNotAllowedError,    // 405
  ConflictError,            // 409
  UnprocessableEntityError, // 422
  TooManyRequestsError      // 429
} from '@geekmidas/errors';

// 400 Bad Request
throw new BadRequestError('Invalid input');

// 401 Unauthorized
throw new UnauthorizedError('Authentication required');

// 403 Forbidden
throw new ForbiddenError('Insufficient permissions', {
  required: 'admin',
  current: 'user'
});

// 404 Not Found
throw new NotFoundError('Resource not found');

// 405 Method Not Allowed
throw new MethodNotAllowedError('DELETE not supported', ['GET', 'POST', 'PUT']);

// 409 Conflict
throw new ConflictError('Email already exists', {
  email: 'user@example.com'
});

// 422 Unprocessable Entity
throw new UnprocessableEntityError('Validation failed', {
  email: 'Invalid email format',
  age: 'Must be 18 or older'
});

// 429 Too Many Requests
throw new TooManyRequestsError('Rate limit exceeded', 60); // retry after 60 seconds
```

### Server Errors (5xx)

```typescript
import {
  InternalServerError, // 500
  NotImplementedError, // 501
  BadGatewayError,     // 502
  ServiceUnavailableError, // 503
  GatewayTimeoutError  // 504
} from '@geekmidas/errors';

// 500 Internal Server Error
throw new InternalServerError('Database connection failed');

// 501 Not Implemented
throw new NotImplementedError('Feature not yet implemented');

// 502 Bad Gateway
throw new BadGatewayError('Upstream server error');

// 503 Service Unavailable
throw new ServiceUnavailableError('Maintenance in progress', 300); // retry after 5 minutes

// 504 Gateway Timeout
throw new GatewayTimeoutError('Upstream server timeout');
```

## Error Factories

Use convenient factory functions for creating errors:

```typescript
import { createError } from '@geekmidas/errors';

// Short, descriptive method names
throw createError.badRequest('Invalid input');
throw createError.notFound('User not found');
throw createError.unauthorized('Invalid token');
throw createError.forbidden('Access denied');
throw createError.conflict('Resource already exists');
throw createError.internalServerError('Something went wrong');

// With details
throw createError.notFound('User not found', { userId: '123' });
throw createError.badRequest('Validation failed', {
  errors: ['Invalid email', 'Password too short']
});
```

## Generic Error Factory

Create errors dynamically with type-safe options:

```typescript
import { createHttpError } from '@geekmidas/errors';

// TypeScript knows which options are valid for each status code
throw createHttpError(404, 'Not found');
throw createHttpError(429, 'Rate limited', { retryAfter: 60 });
throw createHttpError(422, 'Validation failed', {
  validationErrors: {
    email: 'Invalid format',
    age: 'Must be 18+'
  }
});
```

## Type Guards

Check error types at runtime:

```typescript
import {
  isHttpError,
  isClientError,
  isServerError,
  NotFoundError
} from '@geekmidas/errors';

try {
  // some code
} catch (error) {
  if (isHttpError(error)) {
    console.log(`HTTP ${error.statusCode}: ${error.message}`);
    console.log('Details:', error.details);
  }

  if (isClientError(error)) {
    // 4xx errors - client's fault
    console.log('Client error:', error.message);
  }

  if (isServerError(error)) {
    // 5xx errors - server's fault
    console.error('Server error:', error.message);
    // Alert monitoring system
  }

  if (error instanceof NotFoundError) {
    // Specific error type
    console.log('Resource not found');
  }
}
```

## Error Wrapping

Wrap unknown errors into HTTP errors:

```typescript
import { wrapError } from '@geekmidas/errors';

try {
  await someOperation();
} catch (error) {
  // Wrap unknown error as 500
  throw wrapError(error);

  // Or wrap with specific status and message
  throw wrapError(error, 503, 'Service temporarily unavailable');
}
```

## Error Serialization

Serialize errors to JSON:

```typescript
import { NotFoundError } from '@geekmidas/errors';

const error = new NotFoundError('User not found', { userId: '123' });

// Get JSON representation
const json = error.toJSON();
// {
//   name: 'NotFoundError',
//   message: 'User not found',
//   statusCode: 404,
//   statusMessage: 'Not Found',
//   details: { userId: '123' },
//   stack: '...'
// }

// Get error body for HTTP response
const body = error.body;
// JSON string: '{"message":"User not found","details":{"userId":"123"}}'
```

## Error Cause Chaining

Chain errors using ES2022 error cause:

```typescript
import { InternalServerError } from '@geekmidas/errors';

try {
  await database.connect();
} catch (originalError) {
  throw new InternalServerError('Failed to connect to database', {
    cause: originalError,
    details: { host: 'localhost', port: 5432 }
  });
}
```

## Express Middleware

Handle errors in Express applications:

```typescript
import { isHttpError } from '@geekmidas/errors';
import type { Request, Response, NextFunction } from 'express';

function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (isHttpError(error)) {
    res.status(error.statusCode).json({
      error: {
        message: error.message,
        code: error.code,
        details: error.details
      }
    });
  } else {
    // Unknown error
    console.error('Unexpected error:', error);
    res.status(500).json({
      error: {
        message: 'Internal Server Error'
      }
    });
  }
}

// Use in Express app
app.use(errorHandler);
```

## Hono Middleware

Handle errors in Hono applications:

```typescript
import { Hono } from 'hono';
import { isHttpError } from '@geekmidas/errors';

const app = new Hono();

app.onError((error, c) => {
  if (isHttpError(error)) {
    return c.json(
      {
        error: {
          message: error.message,
          code: error.code,
          details: error.details
        }
      },
      error.statusCode
    );
  }

  console.error('Unexpected error:', error);
  return c.json(
    { error: { message: 'Internal Server Error' } },
    500
  );
});
```

## Custom Error Classes

Extend base classes for custom errors:

```typescript
import { HttpError } from '@geekmidas/errors';

export class CustomBusinessError extends HttpError {
  constructor(message?: string, details?: any) {
    super(400, message, { details, code: 'BUSINESS_RULE_VIOLATION' });
  }
}

// Usage
throw new CustomBusinessError('Cannot delete user with active orders', {
  userId: '123',
  activeOrders: 5
});
```

## Error Context

Add context to errors for better debugging:

```typescript
import { NotFoundError } from '@geekmidas/errors';

function getUserById(id: string) {
  const user = database.findUser(id);

  if (!user) {
    throw new NotFoundError('User not found', {
      userId: id,
      requestId: req.headers['x-request-id'],
      timestamp: new Date().toISOString(),
      source: 'getUserById'
    });
  }

  return user;
}
```

## HTTP Status Codes

Use the HttpStatusCode enum for type-safe status codes:

```typescript
import { HttpStatusCode } from '@geekmidas/errors';

// Success
HttpStatusCode.OK                 // 200
HttpStatusCode.CREATED            // 201
HttpStatusCode.NO_CONTENT         // 204

// Redirection
HttpStatusCode.MOVED_PERMANENTLY  // 301
HttpStatusCode.NOT_MODIFIED       // 304

// Client Errors
HttpStatusCode.BAD_REQUEST        // 400
HttpStatusCode.UNAUTHORIZED       // 401
HttpStatusCode.FORBIDDEN          // 403
HttpStatusCode.NOT_FOUND          // 404
HttpStatusCode.CONFLICT           // 409
HttpStatusCode.UNPROCESSABLE_ENTITY // 422
HttpStatusCode.TOO_MANY_REQUESTS  // 429

// Server Errors
HttpStatusCode.INTERNAL_SERVER_ERROR // 500
HttpStatusCode.SERVICE_UNAVAILABLE   // 503
```

## Best Practices

### 1. Use Specific Error Classes

```typescript
// ❌ Don't use generic Error
throw new Error('User not found');

// ✅ Use specific HTTP error
throw new NotFoundError('User not found', { userId: '123' });
```

### 2. Include Helpful Details

```typescript
// ❌ Minimal information
throw new BadRequestError('Invalid input');

// ✅ Include context
throw new BadRequestError('Invalid email format', {
  field: 'email',
  value: userInput,
  expectedFormat: 'user@example.com'
});
```

### 3. Use Type Guards

```typescript
// ❌ Assume error type
catch (error: any) {
  console.log(error.statusCode); // Unsafe
}

// ✅ Check error type
catch (error) {
  if (isHttpError(error)) {
    console.log(error.statusCode); // Safe
  }
}
```

### 4. Chain Errors

```typescript
// ✅ Preserve original error context
try {
  await database.query();
} catch (originalError) {
  throw new InternalServerError('Database query failed', {
    cause: originalError,
    query: 'SELECT * FROM users'
  });
}
```

## TypeScript Types

```typescript
import type {
  HttpError,
  HttpErrorOptions,
  HttpErrorConstructor
} from '@geekmidas/errors';

// Options for creating errors
interface HttpErrorOptions {
  statusMessage?: string;
  details?: any;
  code?: string;
  cause?: Error;
}

// Constructor type for factory patterns
type HttpErrorConstructor = new (
  message?: string,
  options?: HttpErrorOptions
) => HttpError;
```

## Related Packages

- [@geekmidas/constructs](../constructs) - Uses these error classes in endpoints
- [@geekmidas/client](../client) - Handles these errors on the client side
- [@geekmidas/logger](../logger) - Log errors with structured context

## License

MIT
