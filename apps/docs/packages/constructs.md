# @geekmidas/constructs

A comprehensive framework for building type-safe HTTP endpoints, cloud functions, scheduled tasks, and event subscribers with AWS Lambda and Hono support.

## Installation

```bash
pnpm add @geekmidas/constructs
```

## Features

- ✅ Declared infrastructure — a database, bucket, cache, or credential is one statement
- ✅ `.dependsOn()` — one edge derives the environment, the client, and the cloud access
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
- ✅ Event subscribers (topic fan-out) and queue workers (point-to-point)
- ✅ Testing utilities

## Package Exports

| Export | Description |
|--------|-------------|
| `/` | Core types and utilities |
| `/endpoints` | `EndpointFactory` (what `api.get()` and `api.database()` return) and types |
| `/worker` | `Worker` — the process with no port; builds crons, subscribers, queues and functions |
| `/topic` | `Topic` — a declared event contract; its publisher is its service |
| `/functions` | The `Function` construct (built with `worker.input(…)` / `worker.dependsOn(…)`) |
| `/crons` | The `Cron` construct (built with `worker.cron(…)`) and `AWSScheduledFunction` |
| `/subscribers` | The `Subscriber` construct (built with `worker.topic(…)`) — topic fan-out |
| `/queue` | The `Queue` construct (built with `worker.queue(…)`) — one queue, one consumer |
| `/types` | Type definitions |
| `/hono` | Hono framework adapter (`HonoEndpoint`) |
| `/aws` | AWS Lambda adaptors (API Gateway v1/v2, `AWSLambdaFunction`, `AWSLambdaSubscriber`, `AWSLambdaQueue`, `AWSScheduledFunction`) |
| `/testing` | Testing utilities (`TestEndpointAdaptor`, `TestFunctionAdaptor`, `TestSubscriberAdaptor`, `TestQueueAdaptor`) |
| `/construct` | The `Construct` interface, `Consumable`, and `Declaration` types |
| `/database/kysely` | `KyselyDatabase` — a declared Postgres database, typed by its schema |
| `/object-storage` | `ObjectStorage` — a declared bucket |
| `/file-server` | `FileServer` — a domain that serves a bucket's objects |
| `/cache` | `Cache` — a declared cache |
| `/credential` | `Credential` — a third-party credential with a shape |
| `/external-api` | `ExternalApi` — an HTTP API somebody else runs, faked in tests |
| `/email` | `Email` — declared outbound mail |
| `/rest-api` | `RestApi` — an API surface |
| `/site` | `StaticSite` — a declared static site |
| `/auth` | `BetterAuth` — a declared auth server |

> **Service integrations moved:** the tRPC and Middy middlewares now live in [`@geekmidas/services`](/packages/services) (`@geekmidas/services/trpc`, `@geekmidas/services/middy`) since they depend only on `@geekmidas/services`, not on the constructs.

## Constructs

A **construct** is one declaration that stands for a piece of infrastructure. It
is simultaneously an infrastructure *requirement* at build time, a runtime
*capability*, and something other code can *consume* — which is why the
interface has exactly three members:

```typescript
interface Construct<TName extends string = string, TClient = never> {
  readonly id: TName;
  declare(): Declaration[];
  readonly service: [TClient] extends [never] ? never : Service<TName, TClient>;
}
```

From that one declaration, three different owners derive three different things:

| Derived | By whom | When |
|---------|---------|------|
| The function's **environment** | the framework | `gkm build` |
| Its **runtime client** | the framework | first request |
| The **infrastructure** — a container locally, a cloud resource deployed | the target adapter | `gkm dev` / `gkm deploy` |

### The resource constructs

```typescript
import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';
import { ObjectStorage } from '@geekmidas/constructs/object-storage';
import { Cache } from '@geekmidas/constructs/cache';
import { Credential } from '@geekmidas/constructs/credential';

export const database = new KyselyDatabase<Database, 'Orders'>('Orders');
export const uploads = new ObjectStorage('Uploads', { versioned: true });
export const cache = new Cache('Sessions');
export const stripe = new Credential('Stripe', {
  schema: z.object({ secretKey: z.string(), webhookSecret: z.string() }),
});
```

Each canonicalises its id — `uploads` and `Uploads` are one construct, not two
that collide — and derives its env key from it: `UPLOADS_URL`, `SESSIONS_URL`,
`ORDERS_URL` (plus `ORDERS_OWNER_URL` for the DDL role). The key the target
publishes and the key the client reads come from the same field, so they cannot
drift.

| Construct | Import | The client it hands back |
|---|---|---|
| `KyselyDatabase` | `/database/kysely` | `Kysely<DB>`, typed by your schema |
| `ObjectStorage` | `/object-storage` | `StorageClient` — write, delete, presign |
| `FileServer` | `/file-server` | a `StorageClient` **superset** — plus `url()` and `signedUrl()` |
| `Cache` | `/cache` | `CacheClient` |
| `Credential` | `/credential` | the parsed, validated value — no `await` at the call site |
| `ExternalApi` | `/external-api` | whatever its `client` builds — the real API, or its fake in tests and `gkm dev --fake` |
| `Email` | `/email` | an `EmailClient` typed by your templates |
| `Topic` | `/topic` | an `EventPublisher` typed to its events |
| `Queue` | `worker.queue(…)` | an `EventPublisher` typed to its `message` |
| `RestApi` | `/rest-api` | — a surface; it owns a URL, not a client |
| `StaticSite` | `/site` | — a surface |
| `BetterAuth` | `/auth` | the auth server |

### `.dependsOn()` — the one primitive

Every builder takes it: endpoints, functions, crons, queue workers, and
subscribers.

```typescript
export const createAvatar = api
  .post('/avatars')
  .dependsOn([uploads, stripe])
  .handle(async ({ services }) => {
    // Both exist, and both type, because of the edge above.
    services.uploads.getUploadURL({ path, contentType, contentLength });
    services.stripe.secretKey;
  });
```

The edge records what a handler consumes. The framework derives its environment
and its runtime binding; the deploy target separately derives cloud access from
the same edge. **Permissions are not a framework concept and are not in the
manifest** — what an edge implies on a given cloud is the adapter's business.

`.dependsOn()` takes constructs only. A `Service` (`{ serviceName, register }`)
does not match the shape, which is what keeps environment sniffing confined to
`.services()`.

A construct that owns no client — a `Cron`, a `Subscriber` — types its
`service` as `never`, so depending on one is a compile error rather than a stub
that throws at runtime. You cannot call a queue worker; you send to its queue.

### An API somebody else runs

Polar, Stripe, a payment gateway: nothing to provision, but an address that
changes by stage and credentials the provider issued for each one.

```typescript
// constructs/polar.ts
import { ExternalApi } from '@geekmidas/constructs/external-api';

export const polar = new ExternalApi('Polar', {
  url: 'https://www.polaraccesslink.com',
  credentials: z.object({ clientId: z.string(), clientSecret: z.string() }),
  client: ({ url, credentials }) => new PolarClient(url, credentials),
});

.dependsOn([polar])
.handle(async ({ services }) => services.polar.exchangeCode(code))
```

It provides two keys, `POLAR_URL` and `POLAR_CREDENTIALS`:

| | Deployed, and `gkm dev` | `gkm dev --fake` and `gkm test` |
|---|---|---|
| `POLAR_URL` | `url`, for the stage | the fake |
| `POLAR_CREDENTIALS` | the stage's secret | the fake's `credentials` |

**Fakes are opt-in.** Plain `gkm dev` calls the real API — its sandbox, say —
at its `url` for the local stage, with the local stage's own credentials.
`gkm test` always uses the fakes, and `gkm dev --fake` uses them too. Nothing
that acts on a stage (`gkm setup`, `secrets:*`, `deploy`) reads one.

**`url` is one URL or one per stage.** A string answers every stage. A record
is keyed by stage name, with `default` for any stage not listed — for a
provider whose sandbox lives somewhere else:

```typescript
url: {
  prod: 'https://www.payfast.co.za',
  default: 'https://sandbox.payfast.co.za',
},
```

**Credentials are one JSON value per stage:**

```bash
gkm secrets:set POLAR_CREDENTIALS '{"clientId":"…","clientSecret":"…"}' --stage prod
```

Both are checked at deploy: a stage the `url` record does not name, with no
`default`, fails with `NoUrlForStage`, and a stage with no `POLAR_CREDENTIALS`
fails with `MissingSuppliedSecret`, naming the command above. The JSON itself
is validated against the schema when the process starts (`MalformedCredential`).

#### The fake

**The construct never names its fake** — so no bundler can carry a fake, or the
responses it answers from, into a deployed build. It lives at
`test/fakes/<id>.ts`, found by name the way `test/factories/<database>.ts` is,
and default-exports one of two things.

An app — a working implementation of the API, served by gkm in-process
through MSW in a feature test and on an allocated port by `gkm dev --fake`:

```typescript
// test/fakes/polar.ts
import { fake } from '@geekmidas/constructs/external-api';
import type { polar } from '../../constructs/polar';

export default fake.app<typeof polar>(
  new Hono().post('/v3/users', (c) => c.json({ 'polar-user-id': 1 })),
  { credentials: { clientId: 'fake', clientSecret: 'fake' } },
);
```

Or an image the provider publishes, run as a container. `port` is the one it
listens on inside; the host port is allocated like every other container's:

```typescript
// test/fakes/stripe.ts
export default fake.image<typeof stripe>('stripe/stripe-mock', {
  port: 12111,
  credentials: { secretKey: 'sk_test_fake', webhookSecret: 'whsec_fake' },
});
```

`<typeof polar>` checks the fake's credentials against the construct's schema.
An external API with no fake fails `gkm test` and `gkm dev --fake` with
`NoFake`, naming the file to create. Writing a fake, asserting on what it
received, and how long its state lives are in the
[testing guide](/guide/testing#fakes).

### The database, and what comes off it

```typescript
export const database = new KyselyDatabase<Database, 'Orders'>('Orders');

export const replica = database.reader();                    // OrdersReader
export const cache = database.cache();                       // cached *in* this database
export const acme = database.schema<TenantDB, 'Acme'>('Acme'); // its own role + URL
database.owner;                                              // the DDL role
```

#### `database.cache()`

A cache **backed by this database** — entries are rows in a table inside it,
created in this database's schema and reached by its role:

```typescript
database.cache();                          // OrdersCache, table `cache`
database.cache('Sessions');                // a different id
database.cache('Sessions', { table: 'kv' }); // a different table
```

It is the stronger of the two forms. `new Cache('Sessions')` says the app caches
and leaves *where* to the deployment; this says it caches **here**, which is a
fact about the application rather than about a stage — so the declaration wins
over the deploy target, and a target that puts caches in Upstash does not move
it.

What that buys beyond being explicit: the table's schema and the role that
reaches it come from this database rather than from a second convention, and the
backend never has to guess which database "the database" meant in an app that
declares two.

The client is still a `CacheClient` — a key/value store, not a query builder, so
this returns a `Cache` and not a `KyselyDatabase`. And the table is DDL, so
whatever applies DDL creates it: a handler's role may not create anything, which
is the same reason the Postgres driver does not create it lazily.

`.database(database)` on a factory puts the client in the handler context as
`db`, and the execution wrapper is what opens the transaction and applies the
RLS context:

```typescript
export const router = api.database(database);

export const listOrders = router
  .get('/orders')
  .handle(async ({ db }) => db.selectFrom('orders').selectAll().execute());
```

`.owner` is a `Service` rather than a construct, deliberately: `.dependsOn()`
takes constructs, so a handler cannot ask for DDL rights at all. A migrator asks
for it by name.

::: tip Discovery
Point `constructs: './src/constructs/**/*.ts'` at them in `gkm.config.ts`. One
glob, every kind — a declared `ObjectStorage` has no kind to be listed under, so
a glob per kind could never find it. Discovery inspects every export of every
matching module and asks one structural question: does it have an `id`, and can
it `declare()`?
:::

## Basic Usage

### Creating an Endpoint

```typescript
import { api } from '../constructs/api';
import { z } from 'zod';

export const getUserEndpoint = api
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
const createUserEndpoint = api
  .post('/users')
  .body(z.object({
    name: z.string(),
    email: z.email(),
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

### Services — the escape hatch

Reach for a construct first. A third-party API is an `ExternalApi`, a key
somebody issued you is a `Credential`, and a database is a `KyselyDatabase` —
each is one declaration, and each goes in `.dependsOn([...])`:

```typescript
export const database = new KyselyDatabase<Database, 'Orders'>('Orders');

const endpoint = api
  .get('/data')
  .dependsOn([database])
  .handle(async ({ services }) =>
    services.database.selectFrom('orders').selectAll().execute(),
  );
```

A hand-written `Service` (`{ serviceName, register }`) is what the build cannot
see into: it has to *run* the service against a sniffer to learn which env keys
it touches, and it records no edge, so a deploy target cannot grant it
anything. The builders still accept one through `.services()` for code that has
not moved yet; new code should not need it.

## Advanced Usage

### Request Context

The endpoint handler receives a context object that includes all request data, services, logger, headers, cookies, and session information.

#### Reading Cookies

Access incoming request cookies using the `cookie` function:

```typescript
const endpoint = api
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

Combine cookie reading with session management by calling `.session()` on a
branch — here the app's `router` (`api.database(database)`):

```typescript
// The surface was declared with `.auth(auth)`; `auth` here is that construct,
// verifying this request's headers — the session cookie included.
const sessionRouter = router.session(async ({ auth }) => {
  const session = await auth.getSession();
  if (!session) {
    throw new ForbiddenError('No active session');
  }

  return session;
});

// Endpoints created from sessionRouter automatically have session available
const profileEndpoint = sessionRouter
  .get('/profile')
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
import { api } from '../constructs/api';
import { z } from 'zod';

const loginEndpoint = api
  .post('/auth/login')
  .body(z.object({
    email: z.email(),
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
const logoutEndpoint = api
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
const downloadEndpoint = api
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

const createEndpoint = api
  .post('/users')
  .body(z.object({
    name: z.string(),
    email: z.email(),
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
const apiEndpoint = api
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
const getEndpoint = api
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
const uploadEndpoint = api
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

`.session()` is called on the **factory** to create a session-enabled router. The session callback receives `header`, `cookie`, `services`, `auth` (the construct the surface named with `.auth(…)`), and `db` (when a database is configured). Throw an error to reject unauthorized requests.

```typescript
import { api } from '../constructs/api';
import { ForbiddenError } from '@geekmidas/errors';

// Branch from the surface with the database, then add a session.
// `auth` is the construct the surface named with `.auth(auth)`.
const sessionRouter = api
  .database(database)
  .session(async ({ auth, db }) => {
    const session = await auth.getSession();
    if (!session) {
      throw new ForbiddenError('No active session');
    }

    return session;
  });

// Endpoints created from sessionRouter have session in their context
const protectedEndpoint = sessionRouter
  .get('/protected')
  .handle(async ({ session }) => {
    return { userId: session.id };
  });
```

#### Authorization

`.authorize()` adds an authorization check that runs **after** session extraction and input validation, but **before** the handler. It can be set on the factory (applies to all endpoints) or on individual endpoints. The callback returns a `boolean` or `Promise<boolean>` — returning `false` results in a `401 Unauthorized` response.

The authorize context includes `session`, `services`, `logger`, `header`, `cookie`, and validated request input (`body`, `query`, `params`) when schemas are defined:

```typescript
// Factory-level: applies to all endpoints created from this factory
const adminRouter = sessionRouter
  .authorize(({ session }) => session.role === 'admin');

const adminEndpoint = adminRouter
  .post('/admin/action')
  .handle(async ({ session }) => {
    return { status: 'ok' };
  });
```

```typescript
// Endpoint-level: authorize based on request input
const updateEndpoint = sessionRouter
  .post('/orgs/:orgId/members')
  .params(z.object({ orgId: z.string() }))
  .body(z.object({ userId: z.string(), role: z.string() }))
  .authorize(({ session, body, params }) => {
    // Check the user has permission for this org and role assignment
    return session.orgs.includes(params.orgId) && body.role !== 'owner';
  })
  .handle(async ({ body, params }) => {
    return { ok: true };
  });
```

```typescript
// Async authorization with service lookups
const resourceEndpoint = sessionRouter
  .get('/resources/:id')
  .params(z.object({ id: z.string() }))
  .authorize(async ({ session, params, services }) => {
    return await services.permissions.canAccess(session.userId, params.id);
  })
  .handle(async ({ params, services }) => {
    return await services.resources.getById(params.id);
  });
```

### Rate Limiting

```typescript
import { InMemoryCache } from '@geekmidas/cache/memory';

const rateLimitedEndpoint = api
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
import { api } from '../constructs/api';
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

const endpoint = api
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
const endpoint = api
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

const createUserEndpoint = api
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
const updateUserEndpoint = api
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
const transferEndpoint = api
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

Set `.auditor()` and `.actor()` on a branch of the surface's factory so every endpoint built from it inherits the configuration:

```typescript
import { api } from '../constructs/api';

const router = api
  .database(database)
  .session(extractSession)
  .authorizer('jwt')
  .auditor(auditStorageService)
  .actor(({ session }) => ({
    id: session.sub,
    type: 'user',
  }));

// All endpoints inherit auditor and actor
const createUser = router
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

const deleteUser = router
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
const router = api
  .database(database)
  .auditor(auditStorageService)
  .actor(({ session }) => ({ id: session.sub, type: 'user' }));

const endpoint = router
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
When `.database()` is configured and the audit storage's `databaseServiceName` matches the endpoint's database, the framework automatically wraps the handler and the audit flush in a single transaction. No extra configuration is needed.
:::

### Row Level Security (RLS)

Endpoints support PostgreSQL [Row Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) via the `.rls()` method. When configured, the handler receives a `db` parameter — a transaction with PostgreSQL session variables set — so RLS policies can filter rows automatically.

#### Setting Up RLS on the Factory

Configure RLS once on the factory so all endpoints inherit it:

```typescript
import { api } from '../constructs/api';

const router = api
  .database(database)
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
import { api } from '../constructs/api';

const endpoint = api
  .get('/orders')
  .database(database)
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

### Event Publishing

Events go to a **topic**, and a topic is a construct: it declares the event
contract, and its publisher is its `service`.

```typescript
// constructs/topics.ts
import { Topic } from '@geekmidas/constructs/topic';

export const orders = new Topic('Orders', {
  events: {
    'order.created': z.object({ orderId: z.string(), total: z.number() }),
    'order.cancelled': z.object({ orderId: z.string() }),
  },
});
```

An endpoint publishes with `.event(topic, …)`. The event is sent once the
handler has succeeded, with a payload built from what it returned:

```typescript
import { orders } from '../constructs/topics';
import { router } from './router';

export const createOrder = router
  .post('/orders')
  .body(orderSchema)
  .output(orderResponseSchema)
  .event(orders, {
    type: 'order.created',
    payload: (order) => ({ orderId: order.id, total: order.total }),
  })
  .handle(async ({ body, db }) =>
    db.insertInto('orders').values(body).returningAll().executeTakeFirstOrThrow(),
  );
```

`type` is checked against the topic's events and `payload` against that event's
schema, so an event cannot be published in one shape and read in another. Pass
`when: (output) => boolean` to publish only for some outputs. A failed publish
is logged, never thrown: the handler has already succeeded, and an event that
could not be delivered does not turn its response into an error.

**Several topics.** `.event()` is repeatable, and each call names its own
topic. Two calls to two topics publish to each, through each topic's own
publisher — there is no single shared one to configure:

```typescript
export const cancelOrder = router
  .post('/orders/:id/cancel')
  .output(orderResponseSchema)
  .event(orders, {
    type: 'order.cancelled',
    payload: (order) => ({ orderId: order.id }),
  })
  .event(audit, {
    type: 'audit.recorded',
    payload: (order) => ({ subject: `order:${order.id}` }),
  })
  .handle(async ({ params, db }) => { /* … */ });
```

**Publishing from the handler.** `.event(orders, …)` also puts the topic's
publisher in the handler as `services.orders` — exactly what
`.dependsOn([orders])` does — for an event the handler decides on itself:

```typescript
export const createTransfer = router
  .post('/transfers')
  .dependsOn([transfers])
  .handle(async ({ body, services }) => {
    const result = await processTransfer(body);

    if (result.flagged) {
      await services.transfers.publish([
        { type: 'transfer.flagged', payload: { transferId: result.id } },
      ]);
    }

    return result;
  });
```

The service key is the topic's id, uncapitalised: `Orders` is `services.orders`.
Depending on a topic is what gives a handler `ORDERS_PUBLISHER_CONNECTION_STRING`;
the publisher reads it and picks its transport from the protocol — `pgboss://`
on a server target, `sns://` on AWS (locally, against the AWS emulator).

Functions and crons take `.event(topic, …)` the same way. Publishing is never
granted to a branch or a surface: only the routes that name the topic can
publish to it.

## Event Subscribers

A subscriber is built from the `Worker` that runs it, and **binds** to a topic
rather than depending on it. Its handler is handed the topic's event types and
no publisher; the runtime that feeds it reaches the topic through the topic's
own connection string.

```typescript
// constructs/worker.ts
import { Worker } from '@geekmidas/constructs/worker';

export const worker = new Worker('Jobs', { logger }).database(database);
```

The worker's `.database(database)` is the default database for everything built
from it — subscribers, queues, crons and functions all receive it as `db`,
typed from the construct. One that works against another database names its own
with `.database(other)`, which replaces the worker's for that runnable alone:
its `db`, and the manifest edge a deploy grants it from.

### Basic Subscriber

```typescript
import { users } from '../constructs/topics';
import { worker } from '../constructs/worker';

export const onUserCreated = worker
  .topic(users)
  .subscribe(['user.created'])
  .handle(async ({ events, logger }) => {
    for (const event of events) {
      logger.info({ userId: event.payload.userId }, 'Processing new user');
    }
  });
```

`.topic()` comes first because what comes first decides what is built: a topic
makes a subscriber, where `.dependsOn()` first would make a plain function.

### With Database Access

The worker's database is already there as `db`:

```typescript
export const onUserCreated = worker
  .topic(users)
  .subscribe(['user.created'])
  .handle(async ({ events, db }) => {
    await db
      .insertInto('profiles')
      .values(events.map((event) => ({ userId: event.payload.userId })))
      .execute();
  });
```

`.database(other)` gives one subscriber a different one, and retypes `db`:

```typescript
export const trackSignup = worker
  .topic(users)
  .database(analytics)
  .subscribe(['user.created'])
  .handle(async ({ events, db }) => {
    // db is analytics' client, not the worker's
  });
```

### With Dependencies

```typescript
export const onOrderCreated = worker
  .topic(orders)
  .dependsOn([database, email])
  .subscribe(['order.created'])
  .handle(async ({ events, services, logger }) => {
    for (const event of events) {
      const order = await services.database
        .selectFrom('orders')
        .where('id', '=', event.payload.orderId)
        .selectAll()
        .executeTakeFirstOrThrow();

      await services.email.sendTemplate('orderConfirmation', {
        to: order.customerEmail,
        subject: 'Your order',
        props: { orderId: order.id, total: order.total },
      });

      logger.info({ orderId: order.id }, 'Order confirmation sent');
    }
  });
```

### Subscribing to Multiple Events

```typescript
export const onUserEvents = worker
  .topic(users)
  .subscribe(['user.created', 'user.updated'])
  .handle(async ({ events }) => {
    for (const event of events) {
      if (event.type === 'user.created') {
        // TypeScript narrows payload to the topic's 'user.created' schema
        await indexNewUser(event.payload.userId);
      } else {
        await reindexUser(event.payload.userId);
      }
    }
  });
```

### Publishing Follow-up Events

A subscriber that emits follow-ups depends on the topic it emits to — the only
reason it would need a publisher at all:

```typescript
export const onUserCreated = worker
  .topic(users)
  .dependsOn([notifications])
  .subscribe(['user.created'])
  .handle(async ({ events, services }) => {
    await services.notifications.publish(
      events.map((event) => ({
        type: 'notification.sent',
        payload: { userId: event.payload.userId, kind: 'welcome' },
      })),
    );
  });
```

### Configuration Options

| Method | Description |
|--------|-------------|
| `worker.topic(topic)` | The topic to bind to — types the events and records the binding |
| `.subscribe(events)` | Event type(s) to listen for (string or array) |
| `.dependsOn([...])` | Constructs whose clients the handler gets in `services` |
| `.output(schema)` | Validate the return value with a StandardSchema |
| `.timeout(ms)` | Set execution timeout in milliseconds |
| `.handle(fn)` | Define the handler and build the `Subscriber` |

The logger comes from the worker.

### Handler Context

```typescript
{
  events: Array<{ type; payload }>;  // A batch, typed by the topic's contract
  services: ServiceRecord;           // From .dependsOn([...])
  logger: Logger;                    // The worker's
}
```

### How Subscribers Run

**Development (`gkm dev`) and server builds:**
Subscribers run in-process beside the server, each through the
`<ID>_PUBLISHER_CONNECTION_STRING` of the topic it is bound to — there is no
shared subscriber string. How a subscriber is fed follows that string:

- **`sns://` — pushed.** The server mounts
  `POST /__gkm/subscribers/<exportName>` and, once listening, subscribes it to
  the topic with a filter policy on the `type` attribute listing the events
  from `.subscribe([...])`. SNS fans out, one subscription per subscriber. The
  route is `SnsPushSubscriberAdaptor` (from `@geekmidas/constructs/aws`), which
  hands each notification to `AWSLambdaSubscriber` as an SNS Lambda event — the
  same parsing, services and error handling as deployed. Confirmations are
  confirmed automatically; signatures are verified except against an emulator.
  `GKM_SUBSCRIBER_PUSH_URL` is the public base SNS pushes to (locally it
  defaults to `http://host.docker.internal:<port>`).
- **`pgboss://`, `rabbitmq://` — polled.** On pg-boss each subscriber drains a
  queue of its own, `<topic>/<exportName>`, so every subscriber sees every
  event and replicas of one subscriber share it.

`gkm dev --no-subscribers` runs none of them. See
[Events: Dev Server](/packages/events#dev-server).

**Production (AWS Lambda):**
Each subscriber is compiled into a Lambda handler via `AWSLambdaSubscriber`,
which parses SQS/SNS records, filters to the subscribed types, and invokes the
handler. The build records the binding on the topic's manifest entry.

```typescript
import { AWSLambdaSubscriber } from '@geekmidas/constructs/aws';
import { EnvironmentParser } from '@geekmidas/envkit';
import { onUserCreated } from './subscribers/userEvents';

const envParser = new EnvironmentParser(process.env);
const adaptor = new AWSLambdaSubscriber(envParser, onUserCreated);

export const handler = adaptor.handler;
```

### Testing Subscribers

A subscriber is tested by handing it events — delivery is the broker's job.
In a `featureTest`, `subscriber()` runs it with the test's services:

```typescript
import { it } from '#test';

it('writes each user a notification', async ({ subscriber, db }) => {
  await subscriber(onUserCreated).invoke({
    events: [
      {
        type: 'user.created',
        payload: { userId: '123', email: 'ada@example.com', name: 'Ada' },
      },
    ],
  });

  // Assert on what the handler did — a row, a mail in the mailbox, …
});
```

`TestSubscriberAdaptor` from `@geekmidas/constructs/testing` does the same
outside a feature test: `new TestSubscriberAdaptor(onUserCreated).invoke({ events })`.

### Project Configuration

Subscribers are discovered by the one `constructs` glob in `gkm.config.ts`,
like every other construct:

```typescript
constructs: [
  './constructs/**/*.ts',
  './apps/*/{endpoints,queues,subscribers,crons,functions}/**/*.ts',
],
```

## Queues

A **queue** is point-to-point work: a queue and its *single* consumer, declared
as one construct. Where a subscriber is topic fan-out — any number of them, each
filtering a stream by event type — a queue drains *every* message of its one
typed `message` and hands it to exactly one handler. Reach for a queue for jobs
(send an order to be fulfilled), and a topic for domain events (tell everyone a
user was created).

### Basic Queue

```typescript
import { worker } from '../constructs/worker';
import { z } from 'zod';

export const orderJobs = worker
  .queue('OrderJobs')
  .message(z.object({ orderId: z.string() }))
  .handle(async ({ messages, logger }) => {
    for (const { orderId } of messages) {
      logger.info({ orderId }, 'Fulfilling order');
    }
  });
```

One construct because a queue has exactly one consumer: nothing can attach a
second, or forget to attach the first.

### With Database Access

A queue built from a worker with `.database(database)` gets that database as
`db`; `.database(other)` replaces it for this queue:

```typescript
export const orderJobs = worker
  .queue('OrderJobs')
  .message(z.object({ orderId: z.string() }))
  .handle(async ({ messages, db }) => {
    for (const { orderId } of messages) {
      await db
        .updateTable('orders')
        .set({ status: 'fulfilled' })
        .where('id', '=', orderId)
        .execute();
    }
  });

export const reportJobs = worker
  .queue('ReportJobs')
  .database(analytics)
  .message(z.object({ reportId: z.string() }))
  .handle(async ({ messages, db }) => { /* db is analytics' client */ });
```

Every runtime hands it over the same way — the server's poller, the Lambda
adaptor, and `TestQueueAdaptor`, which also takes a `db` in the request to stand
in for it (a transaction, say).

### With Dependencies

`.dependsOn()` names constructs. The edge is what the manifest records, and what
a deploy target reads to grant this consumer exactly what it named:

```typescript
export const orderJobs = worker
  .queue('OrderJobs')
  .dependsOn([database])
  .message(z.object({ orderId: z.string() }))
  .handle(async ({ messages, services }) => {
    for (const { orderId } of messages) {
      await fulfil(services.database, orderId);
    }
  });
```

### Sending to a Queue

A producer sends to a queue by depending on it. The queue's `service` is its
publisher, typed to its `message`:

```typescript
import { orderJobs } from '../queues/orderJobs';

export const createOrder = router
  .post('/orders')
  .body(z.object({ sku: z.string() }))
  .dependsOn([orderJobs])
  .handle(async ({ body, services }) => {
    const orderId = crypto.randomUUID();
    await services.orderJobs.publish([
      { type: 'OrderJobs', payload: { orderId } },
    ]);
    return { orderId };
  });
```

`type` is the queue's name exactly as written — it is the wire type the
consumer subscribes to, so it is never rewritten. The service key is the
canonical id, uncapitalised (`services.orderJobs`).

The publisher reads `ORDER_JOBS_PUBLISHER_CONNECTION_STRING` and selects its
transport from the protocol — `pgboss://` locally, `sqs://` deployed — so the
same code publishes to Postgres in dev and SQS in prod. Each queue gets its own
key, given to the constructs that depend on it and to the server that runs its
consumer.

### Configuration Options

| Method | Description |
|--------|-------------|
| `worker.queue(name)` | Queue name — the wire `type`, and the source of its id and env keys |
| `.message(schema)` | The typed message payload |
| `.dependsOn([...])` | Constructs whose clients the handler gets in `services` |
| `.timeout(ms)` | Handler timeout (default `30000`) |
| `.batchSize(n)` | SQS event-source batch size (deployed) |
| `.fifo()` | Mark the queue as FIFO (deployed) |

### How Queues Run

A queue is **not** an HTTP route — it's background work, and it runs in three modes:

**Development (`gkm dev`):**
The CLI generates a poller that runs **in-process alongside** the Hono server.
Each queue's consumer polls its own queue through the queue's own
`ORDER_JOBS_PUBLISHER_CONNECTION_STRING` — the string its producers publish on
— so it is always the queue they reach: pg-boss by default, or the SQS queue on
the local AWS emulator for an AWS target. Queues are polled on every transport
(SQS cannot push), and `--no-subscribers` leaves them running. No Lambda
required locally.

**Production (AWS Lambda):**
Each queue's consumer is compiled into a Lambda handler via `AWSLambdaQueue`,
subscribed to its SQS queue. The handler unwraps each record's `payload`,
validates it against `message`, and hands the batch to the handler. It uses SQS
partial-batch responses, so a record that fails validation (or a handler error)
is retried without re-processing the rest.

```typescript
import { AWSLambdaQueue } from '@geekmidas/constructs/aws';
import { EnvironmentParser } from '@geekmidas/envkit';
import { orderJobs } from './queues/orderJobs';

const envParser = new EnvironmentParser(process.env);
const adaptor = new AWSLambdaQueue(envParser, orderJobs);

export const handler = adaptor.handler;
```

**Production (Server):**
With `gkm build --provider server`, queues are included in the generated server
and poll using the configured connection string (same as dev).

### Testing Queues

In a `featureTest`, what a request enqueued is in `published(queue)`, and the
consumer is run on its own with `queue(queue).invoke(...)`:

```typescript
import { it } from '#test';

it('enqueues the order and fulfils it', async ({ browser, published, queue }) => {
  const { orderId } = await browser.api.post('/orders', { body: { sku: 'A1' } });
  expect(published(orderJobs)).toEqual([
    { type: 'OrderJobs', payload: { orderId } },
  ]);

  await queue(orderJobs).invoke({ messages: [{ orderId }] });

  // Assert side effects (orders fulfilled, etc.)
});
```

`TestQueueAdaptor` from `@geekmidas/constructs/testing` runs a consumer outside
a feature test: `new TestQueueAdaptor(orderJobs).invoke({ messages })`.

## Cron Jobs

A cron is a scheduled function, built from the worker that runs it:
`worker.cron(schedule)`. It supports dependencies, input/output schemas,
logging, event publishing, and database access. On AWS it is an EventBridge
rule; on a server the worker schedules it in Postgres, which is why the worker
takes `.database(database)` — and that database is every cron's `db` unless
the cron names its own.

### Basic Cron

```typescript
import { worker } from '../constructs/worker';

export const dailyCleanup = worker
  .cron('rate(1 day)')
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
worker.cron('rate(5 minutes)')
worker.cron('rate(1 hour)')
worker.cron('rate(7 days)')
```

**Cron expressions** — run on a specific schedule (minute, hour, day, month, weekday):

```typescript
// Every day at midnight
worker.cron('cron(0 0 * * *)')

// Every Monday at 9am
worker.cron('cron(0 9 * * MON)')

// Every 15 minutes during business hours on weekdays
worker.cron('cron(*/15 9-17 * * MON-FRI)')

// First day of every month at noon
worker.cron('cron(0 12 1 * *)')
```

### With Dependencies

```typescript
export const syncCron = worker
  .cron('rate(30 minutes)')
  .dependsOn([database, cache])
  .handle(async ({ services, logger }) => {
    const staleRecords = await services.database
      .selectFrom('records')
      .where('updated_at', '<', new Date(Date.now() - 3600000))
      .selectAll()
      .execute();

    for (const record of staleRecords) {
      await services.sessions.delete(`record:${record.id}`);
    }

    logger.info({ count: staleRecords.length }, 'Cache invalidated');
    return { invalidated: staleRecords.length };
  });
```

### With Input and Output Schemas

```typescript
import { z } from 'zod';

export const reportCron = worker
  .cron('cron(0 6 * * MON)')
  .input(z.object({
    reportType: z.enum(['daily', 'weekly', 'monthly']),
  }))
  .output(z.object({
    generatedAt: z.string(),
    rowCount: z.number(),
  }))
  .handle(async ({ input }) => {
    const report = await generateReport(input.reportType);
    return {
      generatedAt: new Date().toISOString(),
      rowCount: report.rows.length,
    };
  });
```

### With Database Access

The worker's database is the cron's `db` without naming it again;
`.database(other)` overrides it for one cron, and the schedule stays in the
worker's:

```typescript
export const archiveCron = worker
  .cron('cron(0 2 * * *)')
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

`.event(topic, …)` publishes after each successful run. For one event per row,
publish through the topic's service, which `.event()` or `.dependsOn([topic])`
puts in the handler:

```typescript
export const reminderCron = worker
  .cron('rate(1 hour)')
  .dependsOn([database, reminders])
  .output(z.object({ notified: z.number() }))
  .event(reminders, {
    type: 'reminders.swept',
    payload: (result) => ({ count: result.notified }),
  })
  .handle(async ({ services }) => {
    const users = await services.database
      .selectFrom('users')
      .where('reminder_due', '<', new Date())
      .selectAll()
      .execute();

    await services.reminders.publish(
      users.map((user) => ({ type: 'reminder.due', payload: { userId: user.id } })),
    );

    return { notified: users.length };
  });
```

### Configuration Options

| Method | Description |
|--------|-------------|
| `worker.cron(expression)` | The cron or rate schedule expression |
| `.input(schema)` | Validate the input payload with a StandardSchema |
| `.output(schema)` | Validate the return value with a StandardSchema |
| `.dependsOn([...])` | Constructs whose clients the handler gets in `services` |
| `.database(database)` | The database `db` is, in place of the worker's |
| `.event(topic, { type, payload, when? })` | Publish to a topic after each successful run |
| `.timeout(ms)` | Set the execution timeout in milliseconds (default: 30000) |
| `.memorySize(mb)` | Set the memory allocation in MB (AWS Lambda) |
| `.handle(fn)` | Define the handler and build the `Cron` |

### Project Configuration

Crons are found by the same `constructs` glob as everything else in
`gkm.config.ts` — there is no per-kind glob.

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

### tRPC Integration

The tRPC middlewares now live in `@geekmidas/services/trpc`. See the [services package docs](/packages/services#trpc-integration).

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

#### Capturing Published Events

A topic is a service under its own id, so a recorder passed in `services`
stands in for its publisher and captures what `.event(users, …)` sent:

```typescript
const published: { type: string; payload: unknown }[] = [];
const users = {
  async publish(messages: { type: string; payload: unknown }[]) {
    published.push(...messages);
  },
};

await new TestEndpointAdaptor(createUser).request({
  body: { name: 'Ada', email: 'ada@example.com' },
  services: { users },
  headers: { host: 'example.com' },
});

expect(published).toEqual([
  { type: 'user.created', payload: expect.objectContaining({ name: 'Ada' }) },
]);
```

In a `featureTest`, `published(users)` does this for you.

## Frontend Integration Testing with MSW

Use `createMswHandlers` to test frontend code against real backend endpoints — with full validation, authorization, and session handling — without running an HTTP server.

### How It Works

1. The API app exports its endpoint constructs via `@myapp/api/endpoints`
2. The web app creates MSW handlers from those endpoints
3. Each test registers an isolated context (services, database transaction, etc.)
4. MSW intercepts fetch requests and routes them through Hono's `app.request()`

### Setup

**API app** — export endpoints from `package.json`:

```json
{
  "exports": {
    "./client": "./.gkm/openapi.ts",
    "./endpoints": "./.gkm/server/endpoints.ts"
  }
}
```

The `endpoints` array is auto-generated by the CLI when running `gkm dev` or `gkm build`.

**Web app** — create the MSW server:

```typescript
// apps/web/src/test/msw-server.ts
import { createMswHandlers, TEST_CONTEXT_HEADER } from '@geekmidas/constructs/testing';
import { endpoints } from '@myapp/api/endpoints';
import { setupServer } from 'msw/node';

const { handlers, registerContext } = createMswHandlers(endpoints, {
  baseURL: 'http://localhost:3000',
});

export const mswServer = setupServer(...handlers);
export { registerContext, TEST_CONTEXT_HEADER };
```

### Writing Tests

Each test registers its own context with `registerContext()`. The context ID is sent via the `x-test-context-id` header so concurrent tests are isolated.

```typescript
// apps/web/src/__tests__/users.spec.tsx
import { createApi } from '@myapp/api/client';
import { render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { mswServer, registerContext, TEST_CONTEXT_HEADER } from '../test/msw-server';

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

it('should render users list', async ({ db }) => {
  const contextId = crypto.randomUUID();

  registerContext(contextId, {
    database: db,  // transaction-wrapped db for test isolation
    services: {
      auth: mockAuth,
      storage: mockStorage,
    },
  });

  const api = createApi({
    baseURL: 'http://localhost:3000',
    headers: { [TEST_CONTEXT_HEADER]: contextId },
  });

  const users = await api('GET /users');
  expect(users).toBeDefined();
});
```

### Context Isolation

Each call to `registerContext()` creates an isolated `ServiceDiscovery` instance. This means:

- **Database transactions** — pass a transaction-wrapped `db` so test data rolls back automatically
- **Service overrides** — each test can provide different mock services
- **Concurrent safety** — tests running in parallel each get their own context via the header

```typescript
registerContext(contextId, {
  // Services keyed by serviceName
  services: {
    auth: mockAuthService,
    storage: mockStorageService,
    notification: mockNotificationService,
    // A topic is a service under its own name, so a recorder here
    // captures what endpoints publish to it with .event(users, …)
    users: usersRecorder,
  },
  // Database instance (from .database() on the factory)
  database: transactionDb,
  // Audit storage instance (from .auditor() on the factory)
  auditorStorage: mockAuditStorage,
});
```

### API

| Export | Description |
|--------|-------------|
| `createMswHandlers(endpoints, options)` | Creates MSW handlers from endpoint constructs. Returns `{ handlers, registerContext }` |
| `TEST_CONTEXT_HEADER` | The header name (`x-test-context-id`) used to identify test contexts |

**`CreateMswHandlersOptions`:**

| Property | Type | Description |
|----------|------|-------------|
| `baseURL` | `string` | Base URL the client fetches from (e.g., `'http://localhost:3000'`) |

**`RegisterContextOptions`:**

| Property | Type | Description |
|----------|------|-------------|
| `services` | `Record<string, unknown>` | Service instances keyed by `serviceName` |
| `database` | `unknown` | Database instance (required when endpoints use `.database()`) |
| `auditorStorage` | `unknown` | Audit storage instance (required when endpoints use `.auditor()`) |

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
