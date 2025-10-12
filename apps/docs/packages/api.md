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
import type { Service } from '@geekmidas/api/services';
import type { EnvironmentParser } from '@geekmidas/envkit';

const databaseService = {
  serviceName: 'database' as const,
  async register(envParser: EnvironmentParser<{}>) {
    const config = envParser.create((get) => ({
      url: get('DATABASE_URL').string()
    })).parse();

    const db = await createConnection(config.url);
    return db;
  }
} satisfies Service<'database', Database>;

// Use in endpoint
const endpoint = e
  .get('/data')
  .services([databaseService])
  .handle(async ({ services }) => {
    const db = services.database;
    return await db.query('...');
  });
```