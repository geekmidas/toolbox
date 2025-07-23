# @geekmidas/api

A comprehensive REST API framework for building type-safe HTTP endpoints with AWS Lambda support.

## Installation

```bash
pnpm add @geekmidas/api
```

## Features

- ✅ Fluent endpoint builder pattern
- ✅ Full TypeScript type inference
- ✅ StandardSchema validation (Zod, Valibot, etc.)
- ✅ AWS Lambda adapter support
- ✅ Service dependency injection
- ✅ Built-in error handling
- ✅ Session and authorization management
- ✅ Structured logging

## Basic Usage

### Creating an Endpoint

```typescript
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

export const getUserEndpoint = e
  .get('/users/:id')
  .params(z.object({
    id: z.string().uuid(),
  }))
  .output(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  }))
  .handle(async ({ params }) => {
    const user = await db.users.findById(params.id);
    if (!user) {
      throw createError.notFound('User not found');
    }
    return user;
  });
```

### Error Handling

```typescript
import { createError } from '@geekmidas/api/errors';

// Built-in HTTP errors
throw createError.badRequest('Invalid input');
throw createError.unauthorized('Not authenticated');
throw createError.forbidden('Not authorized');
throw createError.notFound('Resource not found');
throw createError.conflict('Resource already exists');
throw createError.internalServerError('Something went wrong');
```

### AWS Lambda Integration

```typescript
import { createLambdaHandler } from '@geekmidas/api/aws-lambda';

export const handler = createLambdaHandler([
  getUserEndpoint,
  createUserEndpoint,
  updateUserEndpoint,
]);
```

### Service Pattern

```typescript
import { HermodService } from '@geekmidas/api/server';

export class DatabaseService extends HermodService {
  static serviceName = 'database' as const;

  async register() {
    // Initialize database connection
    this.db = await createConnection();
  }

  async cleanup() {
    // Close database connection
    await this.db.close();
  }
}

// Use in endpoint
const endpoint = e
  .get('/data')
  .services(['database'])
  .handle(async ({ services }) => {
    const db = services.database;
    return await db.query('...');
  });
```