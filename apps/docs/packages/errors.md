# @geekmidas/errors

HTTP error classes and error handling utilities.

## Installation

```bash
pnpm add @geekmidas/errors
```

## Features

- Comprehensive HTTP error classes (4xx and 5xx)
- Type-safe error factories with status codes
- Error serialization for API responses
- Integration with validation errors
- Stack trace support for debugging

## Basic Usage

### Error Factory

```typescript
import { createError } from '@geekmidas/errors';

// Client errors (4xx)
throw createError.badRequest('Invalid input');
throw createError.unauthorized('Not authenticated');
throw createError.forbidden('Not authorized');
throw createError.notFound('Resource not found');
throw createError.conflict('Resource already exists');
throw createError.unprocessableEntity('Validation failed');
throw createError.tooManyRequests('Rate limit exceeded');

// Server errors (5xx)
throw createError.internalServerError('Something went wrong');
throw createError.serviceUnavailable('Service temporarily unavailable');
```

### HTTP Error Class

```typescript
import { HttpError } from '@geekmidas/errors';

// Create custom error with details
throw new HttpError(422, 'Validation failed', {
  errors: [
    { field: 'email', message: 'Invalid email format' },
    { field: 'password', message: 'Password too short' },
  ],
});
```

### Error with Additional Context

```typescript
import { createError } from '@geekmidas/errors';

// Bad request with field information
throw createError.badRequest('Invalid input', {
  field: 'email',
  value: 'not-an-email',
});

// Not found with entity type
throw createError.notFound('User not found', {
  entityType: 'user',
  entityId: '123',
});
```

## Error Structure

All HTTP errors serialize to:

```typescript
{
  statusCode: number;
  message: string;
  error: string; // HTTP status text
  details?: unknown; // Additional context
}
```

## Usage with Endpoints

```typescript
import { e } from '@geekmidas/constructs/endpoints';
import { createError } from '@geekmidas/errors';

const endpoint = e
  .get('/users/:id')
  .params(z.object({ id: z.string() }))
  .handle(async ({ params, services }) => {
    const user = await services.database.users.findById(params.id);

    if (!user) {
      throw createError.notFound('User not found', {
        entityType: 'user',
        entityId: params.id,
      });
    }

    return user;
  });
```

## Available Error Types

| Status | Method | Description |
|--------|--------|-------------|
| 400 | `badRequest` | Invalid request data |
| 401 | `unauthorized` | Authentication required |
| 403 | `forbidden` | Insufficient permissions |
| 404 | `notFound` | Resource not found |
| 409 | `conflict` | Resource conflict |
| 422 | `unprocessableEntity` | Validation failed |
| 429 | `tooManyRequests` | Rate limit exceeded |
| 500 | `internalServerError` | Server error |
| 503 | `serviceUnavailable` | Service unavailable |
