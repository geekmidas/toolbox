# @geekmidas/api

:::warning DEPRECATED
This documentation is outdated. The API framework has been moved to `@geekmidas/constructs`.

Please see the [Constructs documentation](/packages/constructs) for the latest information.
:::

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

## Advanced Usage

### Response Handling

The endpoint handler receives two parameters: the context object and a response builder. The response builder allows you to set cookies, custom headers, and override status codes.

#### Setting Cookies

```typescript
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

const loginEndpoint = e
  .post('/auth/login')
  .body(z.object({
    email: z.string().email(),
    password: z.string(),
  }))
  .output(z.object({
    id: z.string(),
    email: z.string(),
  }))
  .handle(async ({ body }, response) => {
    const user = await authenticateUser(body);

    // Set authentication cookie
    return response
      .cookie('session', user.sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        maxAge: 60 * 60 * 24 * 7, // 7 days in seconds
        path: '/',
      })
      .send(user);
  });
```

**Cookie Options:**

- `domain`: Cookie domain
- `path`: Cookie path (default: '/')
- `expires`: Expiration date
- `maxAge`: Maximum age in seconds
- `httpOnly`: Prevent JavaScript access
- `secure`: Only send over HTTPS
- `sameSite`: CSRF protection ('strict' | 'lax' | 'none')

#### Deleting Cookies

```typescript
const logoutEndpoint = e
  .post('/auth/logout')
  .output(z.object({ success: z.boolean() }))
  .handle(async (ctx, response) => {
    // Delete the session cookie
    return response
      .deleteCookie('session', { path: '/' })
      .send({ success: true });
  });
```

#### Custom Headers

Set custom response headers for cache control, content disposition, or custom metadata:

```typescript
const downloadEndpoint = e
  .get('/files/:id/download')
  .params(z.object({ id: z.string() }))
  .handle(async ({ params }, response) => {
    const file = await getFile(params.id);

    return response
      .header('Content-Disposition', `attachment; filename="${file.name}"`)
      .header('X-File-Size', file.size.toString())
      .header('Cache-Control', 'private, max-age=3600')
      .send(file.data);
  });
```

#### Dynamic Status Codes

Override the default status code (200) or the status set in the builder:

```typescript
import { SuccessStatus } from '@geekmidas/api/server';

const createEndpoint = e
  .post('/users')
  .body(z.object({
    name: z.string(),
    email: z.string().email(),
  }))
  .output(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  }))
  .handle(async ({ body }, response) => {
    const user = await createUser(body);

    // Return 201 Created with Location header
    return response
      .status(SuccessStatus.Created)
      .header('Location', `/users/${user.id}`)
      .send(user);
  });
```

**Available Success Status Codes:**

- `SuccessStatus.OK` - 200
- `SuccessStatus.Created` - 201
- `SuccessStatus.Accepted` - 202
- `SuccessStatus.NoContent` - 204
- `SuccessStatus.ResetContent` - 205
- `SuccessStatus.PartialContent` - 206

#### Default Headers

Set headers that apply to all responses from an endpoint:

```typescript
const apiEndpoint = e
  .get('/api/data')
  .header('X-API-Version', '1.0')
  .headers({
    'Cache-Control': 'no-cache',
    'X-Custom-Header': 'value',
  })
  .output(dataSchema)
  .handle(async () => {
    return await getData();
  });
```

#### Simple Responses (No Modifications)

If you don't need to modify the response, simply return the data directly:

```typescript
const getEndpoint = e
  .get('/users/:id')
  .params(z.object({ id: z.string() }))
  .output(userSchema)
  .handle(async ({ params }) => {
    // No response parameter needed if not using it
    return await getUser(params.id);
  });
```

#### Complete Example

Combining multiple response features:

```typescript
const uploadEndpoint = e
  .post('/files/upload')
  .body(z.object({
    file: z.string(),
    name: z.string(),
  }))
  .output(z.object({
    id: z.string(),
    url: z.string(),
  }))
  .handle(async ({ body, logger }, response) => {
    const file = await uploadFile(body);

    logger.info({ fileId: file.id }, 'File uploaded successfully');

    return response
      .status(SuccessStatus.Created)
      .header('Location', `/files/${file.id}`)
      .header('X-File-Id', file.id)
      .cookie('last-upload', file.id, {
        maxAge: 60 * 60, // 1 hour
        httpOnly: true,
      })
      .send({
        id: file.id,
        url: file.url,
      });
  });
```