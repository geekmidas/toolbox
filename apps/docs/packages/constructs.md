# @geekmidas/constructs

A comprehensive framework for building type-safe HTTP endpoints, cloud functions, scheduled tasks, and event subscribers with AWS Lambda and Hono support.

## Installation

```bash
pnpm add @geekmidas/constructs
```

## Features

- ✅ Fluent endpoint builder pattern
- ✅ Full TypeScript type inference
- ✅ StandardSchema validation (Zod, Valibot, etc.)
- ✅ AWS Lambda adapter support (API Gateway v1/v2)
- ✅ Hono framework adapter
- ✅ Service dependency injection
- ✅ Built-in error handling
- ✅ Session and authorization management
- ✅ Structured logging
- ✅ Rate limiting
- ✅ Row Level Security (RLS) with PostgreSQL
- ✅ Response handling (cookies, headers, status codes)
- ✅ Event publishing
- ✅ Testing utilities

## Package Exports

- `/endpoints` - HTTP endpoint builder and types
- `/functions` - Cloud function builder
- `/crons` - Scheduled task builder
- `/subscribers` - Event subscriber builder
- `/hono` - Hono framework adapter
- `/aws` - AWS Lambda adaptors (API Gateway v1/v2)
- `/testing` - Testing utilities

## Basic Usage

### Creating an Endpoint

```typescript
import { e } from '@geekmidas/constructs/endpoints';
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

### Input Validation

Endpoints support three types of input validation:

```typescript
const createUserEndpoint = e
  .post('/users')
  .body(z.object({
    name: z.string(),
    email: z.string().email(),
  }))
  .query(z.object({
    sendEmail: z.boolean().optional(),
  }))
  .handle(async ({ body, query }) => {
    const user = await createUser(body);

    if (query.sendEmail) {
      await sendWelcomeEmail(user.email);
    }

    return user;
  });
```

### Error Handling

```typescript
import { createError } from '@geekmidas/errors';

// Built-in HTTP errors
throw createError.badRequest('Invalid input');
throw createError.unauthorized('Not authenticated');
throw createError.forbidden('Not authorized');
throw createError.notFound('Resource not found');
throw createError.conflict('Resource already exists');
throw createError.internalServerError('Something went wrong');
```

### Service Pattern

Define services as object literals with dependency injection:

```typescript
import type { Service } from '@geekmidas/constructs';
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

### Request Context

The endpoint handler receives a context object that includes all request data, services, logger, headers, cookies, and session information.

#### Reading Cookies

Access incoming request cookies using the `cookie` function:

```typescript
const endpoint = e
  .get('/dashboard')
  .handle(async ({ cookie }) => {
    const sessionId = cookie('session');
    const theme = cookie('theme') || 'light';

    if (!sessionId) {
      throw createError.unauthorized('Session cookie missing');
    }

    return {
      sessionId,
      theme,
    };
  });
```

#### Using Cookies for Authentication

Combine cookie reading with session management:

```typescript
const protectedEndpoint = e
  .get('/profile')
  .getSession(async ({ cookie, services }) => {
    const sessionToken = cookie('session');
    if (!sessionToken) {
      return null;
    }

    return await services.auth.verifySession(sessionToken);
  })
  .authorize(({ session }) => {
    return session !== null;
  })
  .handle(async ({ session }) => {
    return {
      userId: session.userId,
      email: session.email,
    };
  });
```

### Response Handling

The endpoint handler receives two parameters: the context object and a response builder. The response builder allows you to set cookies, custom headers, and override status codes.

#### Setting Cookies

```typescript
import { e } from '@geekmidas/constructs/endpoints';
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
import { SuccessStatus } from '@geekmidas/constructs/endpoints';

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

Combining multiple request and response features:

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
  .handle(async ({ body, cookie, logger }, response) => {
    // Read existing preference cookie
    const preferredFormat = cookie('format') || 'standard';

    const file = await uploadFile(body, preferredFormat);

    logger.info({ fileId: file.id }, 'File uploaded successfully');

    // Set multiple cookies and headers in response
    return response
      .status(SuccessStatus.Created)
      .header('Location', `/files/${file.id}`)
      .header('X-File-Id', file.id)
      .cookie('last-upload', file.id, {
        maxAge: 60 * 60, // 1 hour
        httpOnly: true,
      })
      .cookie('upload-count', String(getUploadCount() + 1), {
        maxAge: 60 * 60 * 24 * 365, // 1 year
      })
      .send({
        id: file.id,
        url: file.url,
      });
  });
```

### Authorization and Sessions

```typescript
const protectedEndpoint = e
  .get('/protected')
  .getSession(async ({ header, services }) => {
    const token = header('authorization')?.replace('Bearer ', '');
    if (!token) return null;

    return await services.auth.verifyToken(token);
  })
  .authorize(({ session }) => {
    return session !== null;
  })
  .handle(async ({ session }) => {
    return { userId: session.id };
  });
```

### Rate Limiting

```typescript
import { InMemoryCache } from '@geekmidas/cache/memory';

const rateLimitedEndpoint = e
  .post('/api/messages')
  .rateLimit({
    limit: 10,
    windowMs: 60000, // 1 minute
    cache: new InMemoryCache(),
  })
  .body(messageSchema)
  .handle(async ({ body }) => {
    return await sendMessage(body);
  });
```

### Row Level Security (RLS)

Endpoints support PostgreSQL [Row Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) via the `.rls()` method. When configured, the handler receives a `db` parameter — a transaction with PostgreSQL session variables set — so RLS policies can filter rows automatically.

#### Setting Up RLS on the Factory

Configure RLS once on the factory so all endpoints inherit it:

```typescript
import { EndpointFactory } from '@geekmidas/constructs/endpoints';

const api = new EndpointFactory()
  .services([databaseService])
  .database(databaseService)
  .session(extractSession)
  .authorizer('jwt')
  .rls({
    extractor: ({ session }) => ({
      user_id: session.sub,
      tenant_id: session.tenantId,
    }),
    prefix: 'app', // optional, default: 'app'
  });
```

The `.database()` call tells the factory which service provides the database connection. The `.rls()` extractor receives the request context (session, services, headers, cookies, logger) and returns key-value pairs that become PostgreSQL session variables (e.g. `app.user_id`).

#### Using `db` in Handlers

When RLS is configured, handlers receive a `db` parameter — a transaction with the RLS context applied:

```typescript
const listOrders = api
  .get('/orders')
  .handle(async ({ db }) => {
    // db is a transaction with app.user_id and app.tenant_id set
    // PostgreSQL policies using current_setting('app.user_id') filter rows automatically
    return db
      .selectFrom('orders')
      .selectAll()
      .execute();
  });
```

::: warning Important
Always use `db` from the handler context when RLS is configured. Using `services.database` directly bypasses the RLS transaction and PostgreSQL session variables won't be set.

```typescript
// Wrong - bypasses RLS
.handle(async ({ services }) => {
  return services.database.selectFrom('orders').execute();
});

// Correct - uses RLS transaction
.handle(async ({ db }) => {
  return db.selectFrom('orders').execute();
});
```
:::

#### Bypassing RLS for Specific Endpoints

For admin endpoints that need unrestricted access, bypass the factory-level RLS:

```typescript
// Using .rls(false)
const adminOrders = api
  .get('/admin/orders')
  .rls(false)
  .handle(async ({ services }) => {
    return services.database
      .selectFrom('orders')
      .selectAll()
      .execute();
  });

// Or using .rlsBypass()
const adminUsers = api
  .get('/admin/users')
  .rlsBypass()
  .handle(async ({ services }) => {
    return services.database
      .selectFrom('users')
      .selectAll()
      .execute();
  });
```

#### Per-Endpoint RLS

You can also configure RLS on individual endpoints instead of (or in addition to) the factory:

```typescript
import { e } from '@geekmidas/constructs/endpoints';

const endpoint = e
  .get('/orders')
  .services([databaseService])
  .database(databaseService)
  .rls({
    extractor: ({ session, header }) => ({
      user_id: session.userId,
      ip_address: header('x-forwarded-for'),
    }),
  })
  .handle(async ({ db }) => {
    return db
      .selectFrom('orders')
      .selectAll()
      .execute();
  });
```

#### PostgreSQL Policy Example

The session variables set by the RLS extractor are consumed by PostgreSQL policies:

```sql
-- Enable RLS on the table
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Create policies using session variables
CREATE POLICY tenant_isolation ON orders
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY user_access ON orders
  USING (user_id = current_setting('app.user_id', true));
```

#### Combining RLS with Other Handler Context

The `db` parameter coexists with services, logger, session, and other context:

```typescript
const endpoint = api
  .get('/orders')
  .handle(async ({ db, services, logger, session }) => {
    const orders = await db
      .selectFrom('orders')
      .selectAll()
      .execute();

    logger.info({ count: orders.length }, 'Fetched orders');

    return orders;
  });
```

## Deployment

### Hono Integration

```typescript
import { HonoEndpoint } from '@geekmidas/constructs/hono';
import { Hono } from 'hono';
import { EnvironmentParser } from '@geekmidas/envkit';
import { ConsoleLogger } from '@geekmidas/logger/console';

const app = new Hono();
const logger = new ConsoleLogger();
const envParser = new EnvironmentParser(process.env);

await HonoEndpoint.fromRoutes(
  ['./src/endpoints/**/*.ts'],
  envParser,
  app,
  logger,
  process.cwd(),
  {
    docsPath: '/__docs',
    openApiOptions: {
      title: 'My API',
      version: '1.0.0',
    },
  }
);

export default app;
```

### AWS Lambda (API Gateway v2)

```typescript
import { AmazonApiGatewayV2Endpoint } from '@geekmidas/constructs/aws';
import { EnvironmentParser } from '@geekmidas/envkit';
import { getUserEndpoint } from './endpoints/users';

const envParser = new EnvironmentParser(process.env);
const adaptor = new AmazonApiGatewayV2Endpoint(envParser, getUserEndpoint);

export const handler = adaptor.handler;
```

### AWS Lambda (API Gateway v1)

```typescript
import { AmazonApiGatewayV1Endpoint } from '@geekmidas/constructs/aws';
import { EnvironmentParser } from '@geekmidas/envkit';
import { getUserEndpoint } from './endpoints/users';

const envParser = new EnvironmentParser(process.env);
const adaptor = new AmazonApiGatewayV1Endpoint(envParser, getUserEndpoint);

export const handler = adaptor.handler;
```

## Testing

### Testing Endpoints

```typescript
import { TestEndpointAdaptor } from '@geekmidas/constructs/testing';
import { describe, it, expect } from 'vitest';

describe('Login Endpoint', () => {
  it('should set session cookie on successful login', async () => {
    const adaptor = new TestEndpointAdaptor(loginEndpoint);

    const result = await adaptor.request({
      body: {
        email: 'user@example.com',
        password: 'password123',
      },
      headers: {
        'content-type': 'application/json',
      },
      services: {},
    });

    // Check response data
    expect(result.data).toMatchObject({
      id: expect.any(String),
      email: 'user@example.com',
    });

    // Check response metadata
    expect(result.metadata.cookies?.has('session')).toBe(true);
    const sessionCookie = result.metadata.cookies?.get('session');
    expect(sessionCookie?.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    });
  });

  it('should read and use request cookies', async () => {
    const adaptor = new TestEndpointAdaptor(profileEndpoint);

    const result = await adaptor.request({
      headers: {
        cookie: 'session=abc123; theme=dark',
      },
      services: {},
    });

    expect(result.data).toMatchObject({
      userId: expect.any(String),
      preferences: {
        theme: 'dark',
      },
    });
  });

  it('should delete session cookie on logout', async () => {
    const adaptor = new TestEndpointAdaptor(logoutEndpoint);

    const result = await adaptor.request({
      headers: {},
      services: {},
    });

    expect(result.data.success).toBe(true);

    const sessionCookie = result.metadata.cookies?.get('session');
    expect(sessionCookie?.value).toBe('');
    expect(sessionCookie?.options?.maxAge).toBe(0);
  });

  it('should return 201 status code for resource creation', async () => {
    const adaptor = new TestEndpointAdaptor(createUserEndpoint);

    const result = await adaptor.request({
      body: {
        name: 'John Doe',
        email: 'john@example.com',
      },
      headers: {},
      services: {},
    });

    expect(result.metadata.status).toBe(201);
    expect(result.metadata.headers?.['Location']).toBe(`/users/${result.data.id}`);
  });

  it('should set custom headers', async () => {
    const adaptor = new TestEndpointAdaptor(downloadEndpoint);

    const result = await adaptor.request({
      params: { id: 'file-123' },
      headers: {},
      services: {},
    });

    expect(result.metadata.headers).toMatchObject({
      'Content-Disposition': expect.stringContaining('attachment'),
      'Cache-Control': 'private, max-age=3600',
    });
  });
});
```

**Test Result Structure:**

When using `response.send()`, the test adaptor returns:

```typescript
{
  data: T,              // The actual response data
  metadata: {
    headers?: Record<string, string>,
    cookies?: Map<string, { value: string, options?: CookieOptions }>,
    status?: SuccessStatus,
  }
}
```

**Testing Simple Responses (without metadata):**

For endpoints that don't use the response builder, the test adaptor returns just the data:

```typescript
describe('Simple Endpoint', () => {
  it('should return user data', async () => {
    const adaptor = new TestEndpointAdaptor(getUserEndpoint);

    const result = await adaptor.request({
      params: { id: 'user-123' },
      headers: {},
      services: {},
    });

    // Direct data access (no metadata wrapper)
    expect(result).toMatchObject({
      id: 'user-123',
      name: expect.any(String),
    });
  });
});
```

## OpenAPI Documentation

Endpoints automatically generate OpenAPI 3.1 documentation:

```typescript
import { Endpoint } from '@geekmidas/constructs/endpoints';

const schema = await Endpoint.buildOpenApiSchema(
  [getUserEndpoint, createUserEndpoint],
  {
    title: 'User API',
    version: '1.0.0',
    description: 'API for managing users',
  }
);
```

The Hono adapter automatically serves OpenAPI docs at `/docs` (configurable).
