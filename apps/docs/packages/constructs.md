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
- ✅ Audit logging
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

### Audit Logging

Endpoints support declarative and manual audit logging via integration with [`@geekmidas/audit`](/packages/audit). Audits can be recorded automatically after a handler completes or manually inside the handler, and they are flushed atomically within the same database transaction when possible.

#### Setting Up Audit Storage

Define an audit storage service and attach it to an endpoint with `.auditor()`:

```typescript
import { e } from '@geekmidas/constructs/endpoints';
import { KyselyAuditStorage } from '@geekmidas/audit/kysely';
import type { Service } from '@geekmidas/services';
import type { AuditableAction } from '@geekmidas/audit';

// Define type-safe audit actions
type AppAuditAction =
  | AuditableAction<'user.created', { userId: string; email: string }>
  | AuditableAction<'user.updated', { userId: string; changes: string[] }>
  | AuditableAction<'user.deleted', { userId: string }>;

// Create audit storage service
const auditStorageService = {
  serviceName: 'auditStorage' as const,
  async register(envParser) {
    return new KyselyAuditStorage<Database>({
      db: kyselyDb,
      tableName: 'audit_logs',
    });
  },
} satisfies Service<'auditStorage', KyselyAuditStorage<Database>>;

const endpoint = e
  .post('/users')
  .auditor(auditStorageService)
  .handle(async ({ auditor }) => {
    // auditor is now available in the handler context
    return { id: '123' };
  });
```

#### Actor Extraction

Use `.actor()` to identify who performed the action. The extractor receives the request context and returns an `AuditActor`:

```typescript
const endpoint = e
  .post('/users')
  .auditor(auditStorageService)
  .actor(({ session }) => ({
    id: session.sub,
    type: 'user',
    data: { email: session.email },
  }))
  .handle(async ({ auditor }) => {
    // auditor.actor is { id: session.sub, type: 'user', ... }
    return { id: '123' };
  });
```

The actor extractor can also be async and has access to `services`, `session`, `header`, `cookie`, and `logger`.

#### Declarative Audits

Use `.audit()` to define audits that fire automatically after the handler returns successfully. Each audit receives the handler's response to extract the payload:

```typescript
import { z } from 'zod';

const createUserEndpoint = e
  .post('/users')
  .auditor(auditStorageService)
  .actor(({ session }) => ({ id: session.sub, type: 'user' }))
  .body(z.object({ name: z.string(), email: z.string() }))
  .output(z.object({ id: z.string(), email: z.string() }))
  .audit([
    {
      type: 'user.created',
      payload: (response) => ({
        userId: response.id,
        email: response.email,
      }),
      entityId: (response) => response.id,
      table: 'users',
    },
  ])
  .handle(async ({ body }) => {
    const user = await createUser(body);
    return user;
  });
```

**Audit definition fields:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | `string` | The audit action type (must match a defined `AuditableAction`) |
| `payload` | `(response) => object` | Extracts the payload from the handler response |
| `when` | `(response) => boolean` | Optional condition — skips the audit if it returns `false` |
| `entityId` | `(response) => string` | Optional entity identifier for querying |
| `table` | `string` | Optional table name for querying |

#### Conditional Audits

Use the `when` clause to only record audits under certain conditions:

```typescript
const updateUserEndpoint = e
  .patch('/users/:id')
  .auditor(auditStorageService)
  .actor(({ session }) => ({ id: session.sub, type: 'user' }))
  .output(userResponseSchema)
  .audit([
    {
      type: 'user.updated',
      payload: (response) => ({
        userId: response.id,
        changes: response.changedFields,
      }),
      when: (response) => response.changedFields.length > 0,
    },
  ])
  .handle(async ({ body, params }) => {
    return await updateUser(params.id, body);
  });
```

#### Manual Audits in Handlers

When you need more control, call `ctx.auditor` directly inside the handler. This is useful for auditing intermediate steps or conditional logic:

```typescript
const transferEndpoint = e
  .post('/transfers')
  .auditor(auditStorageService)
  .actor(({ session }) => ({ id: session.sub, type: 'user' }))
  .handle(async ({ body, auditor }) => {
    const result = await processTransfer(body);

    auditor.audit('transfer.completed', {
      transferId: result.id,
      amount: result.amount,
    });

    if (result.flagged) {
      auditor.audit('transfer.flagged', {
        transferId: result.id,
        reason: result.flagReason,
      });
    }

    return result;
  });
```

Manual audits are buffered in memory and flushed together with any declarative audits when the handler completes.

#### Factory-Level Defaults

Set `.auditor()` and `.actor()` on an `EndpointFactory` so all endpoints inherit the configuration:

```typescript
import { EndpointFactory } from '@geekmidas/constructs/endpoints';

const api = new EndpointFactory()
  .services([databaseService, auditStorageService])
  .session(extractSession)
  .authorizer('jwt')
  .auditor(auditStorageService)
  .actor(({ session }) => ({
    id: session.sub,
    type: 'user',
  }));

// All endpoints inherit auditor and actor
const createUser = api
  .post('/users')
  .audit([{
    type: 'user.created',
    payload: (response) => ({
      userId: response.id,
      email: response.email,
    }),
  }])
  .handle(async ({ body }) => {
    return await createUser(body);
  });

const deleteUser = api
  .delete('/users/:id')
  .handle(async ({ params, auditor }) => {
    await removeUser(params.id);
    auditor.audit('user.deleted', { userId: params.id });
    return { success: true };
  });
```

#### Transaction Coordination

When the audit storage uses the same database as the endpoint (e.g., both use the same Kysely instance), audits are flushed inside the same database transaction. This guarantees atomicity — if the handler fails, both the data changes and the audit records are rolled back.

```typescript
const api = new EndpointFactory()
  .services([databaseService, auditStorageService])
  .database(databaseService)
  .auditor(auditStorageService)
  .actor(({ session }) => ({ id: session.sub, type: 'user' }));

const endpoint = api
  .post('/users')
  .output(userSchema)
  .audit([{
    type: 'user.created',
    payload: (response) => ({
      userId: response.id,
      email: response.email,
    }),
  }])
  .handle(async ({ body, db }) => {
    // db is a transaction — both the insert and audit write
    // happen atomically in the same transaction
    const user = await db
      .insertInto('users')
      .values(body)
      .returningAll()
      .executeTakeFirstOrThrow();

    return user;
  });
```

::: tip
When `.database()` is configured and the audit storage's `databaseServiceName` matches the endpoint's database service, the framework automatically wraps the handler and audit flush in a single transaction. No extra configuration is needed.
:::

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

## Cron Jobs

The `c` builder creates scheduled tasks that run on a cron or rate schedule. Cron jobs extend the same function builder as cloud functions, so they support services, input/output schemas, logging, event publishing, and database access.

### Basic Cron

```typescript
import { c } from '@geekmidas/constructs/crons';

export const dailyCleanup = c
  .schedule('rate(1 day)')
  .handle(async ({ logger }) => {
    logger.info('Running daily cleanup');
    await cleanupExpiredSessions();
    return { cleaned: true };
  });
```

### Schedule Expressions

Crons accept two schedule formats:

**Rate expressions** — run at a fixed interval:

```typescript
c.schedule('rate(5 minutes)')
c.schedule('rate(1 hour)')
c.schedule('rate(7 days)')
```

**Cron expressions** — run on a specific schedule (minute, hour, day, month, weekday):

```typescript
// Every day at midnight
c.schedule('cron(0 0 * * *)')

// Every Monday at 9am
c.schedule('cron(0 9 * * MON)')

// Every 15 minutes during business hours on weekdays
c.schedule('cron(*/15 9-17 * * MON-FRI)')

// First day of every month at noon
c.schedule('cron(0 12 1 * *)')
```

### With Services

```typescript
import { c } from '@geekmidas/constructs/crons';

export const syncCron = c
  .services([databaseService, cacheService])
  .schedule('rate(30 minutes)')
  .handle(async ({ services, logger }) => {
    const db = services.database;
    const cache = services.cache;

    const staleRecords = await db
      .selectFrom('records')
      .where('updated_at', '<', new Date(Date.now() - 3600000))
      .selectAll()
      .execute();

    for (const record of staleRecords) {
      await cache.delete(`record:${record.id}`);
    }

    logger.info({ count: staleRecords.length }, 'Cache invalidated');
    return { invalidated: staleRecords.length };
  });
```

### With Input and Output Schemas

```typescript
import { c } from '@geekmidas/constructs/crons';
import { z } from 'zod';

export const reportCron = c
  .input(z.object({
    reportType: z.enum(['daily', 'weekly', 'monthly']),
  }))
  .output(z.object({
    generatedAt: z.string(),
    rowCount: z.number(),
  }))
  .schedule('cron(0 6 * * MON)')
  .handle(async ({ input }) => {
    const report = await generateReport(input.reportType);
    return {
      generatedAt: new Date().toISOString(),
      rowCount: report.rows.length,
    };
  });
```

### With Database Access

```typescript
import { c } from '@geekmidas/constructs/crons';

export const archiveCron = c
  .services([databaseService])
  .database(databaseService)
  .schedule('cron(0 2 * * *)')
  .handle(async ({ db, logger }) => {
    const cutoff = new Date(Date.now() - 90 * 24 * 3600000); // 90 days

    const result = await db
      .deleteFrom('logs')
      .where('created_at', '<', cutoff)
      .executeTakeFirst();

    logger.info({ deleted: result.numDeletedRows }, 'Archived old logs');
    return { deleted: Number(result.numDeletedRows) };
  });
```

### With Event Publishing

```typescript
import { c } from '@geekmidas/constructs/crons';

export const reminderCron = c
  .services([databaseService])
  .publisher(eventPublisherService)
  .schedule('rate(1 hour)')
  .handle(async ({ services, publish }) => {
    const users = await services.database
      .selectFrom('users')
      .where('reminder_due', '<', new Date())
      .selectAll()
      .execute();

    for (const user of users) {
      await publish('reminder.due', { userId: user.id });
    }

    return { notified: users.length };
  });
```

### Configuration Options

| Method | Description |
|--------|-------------|
| `.schedule(expression)` | Set the cron or rate schedule expression |
| `.input(schema)` | Validate the input payload with a StandardSchema |
| `.output(schema)` | Validate the return value with a StandardSchema |
| `.services(services)` | Inject services into the handler context |
| `.database(service)` | Set the database service (provides `db` in context) |
| `.publisher(service)` | Set the event publisher service (provides `publish` in context) |
| `.logger(logger)` | Set a custom logger instance |
| `.timeout(ms)` | Set the execution timeout in milliseconds (default: 30000) |
| `.memorySize(mb)` | Set the memory allocation in MB (AWS Lambda) |
| `.handle(fn)` | Define the handler function and build the `Cron` instance |

### Project Configuration

Register your cron files in `gkm.config.ts` so the CLI can discover and build them:

```typescript
import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  routes: './src/endpoints/**/*.ts',
  crons: './src/crons/**/*.ts',    // glob pattern for cron files
  envParser: './src/config/env',
  logger: './src/logger',
});
```

### AWS Lambda Deployment

When building with `gkm build --provider aws-lambda`, each cron is compiled into a separate Lambda handler with its schedule expression included in the build manifest. Use the manifest to configure EventBridge rules in your IaC tool (SST, CDK, Terraform, etc.).

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
