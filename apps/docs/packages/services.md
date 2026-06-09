# @geekmidas/services

Service discovery and dependency injection system.

## Installation

```bash
pnpm add @geekmidas/services
```

## Features

- Singleton service registry with lazy initialization
- Type-safe service registration and retrieval
- Service caching and lifecycle management
- Integration with EnvironmentParser for configuration
- Access to request context for logging and tracing
- Support for async service initialization

## Basic Usage

### Define a Service

Services receive `ServiceRegisterOptions` with access to both `envParser` for configuration and `context` for logging:

```typescript
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';

const databaseService = {
  serviceName: 'database' as const,
  async register({ envParser, context }: ServiceRegisterOptions) {
    const logger = context.getLogger();
    logger.info('Connecting to database');

    const config = envParser.create((get) => ({
      url: get('DATABASE_URL').string(),
      poolSize: get('DATABASE_POOL_SIZE').string().transform(Number).default(10),
    })).parse();

    const db = await createConnection(config);
    logger.info('Database connection established');
    return db;
  }
} satisfies Service<'database', Database>;
```

### Service Discovery

```typescript
import { ServiceDiscovery } from '@geekmidas/services';
import { ConsoleLogger } from '@geekmidas/logger/console';
import { EnvironmentParser } from '@geekmidas/envkit';

const logger = new ConsoleLogger();
const envParser = new EnvironmentParser(process.env);

// Get singleton instance
const discovery = ServiceDiscovery.getInstance(logger, envParser);

// Register services
const services = await discovery.register([
  databaseService,
  cacheService,
  emailService,
]);

// Access registered services
const db = services.database;
const cache = services.cache;
```

### Multiple Services

```typescript
const cacheService = {
  serviceName: 'cache' as const,
  async register({ envParser, context }: ServiceRegisterOptions) {
    const logger = context.getLogger();
    logger.debug('Initializing cache');

    const config = envParser.create((get) => ({
      redisUrl: get('REDIS_URL').string(),
    })).parse();

    return new RedisCache(config.redisUrl);
  }
} satisfies Service<'cache', Cache>;

const emailService = {
  serviceName: 'email' as const,
  async register({ envParser }: ServiceRegisterOptions) {
    const config = envParser.create((get) => ({
      smtpHost: get('SMTP_HOST').string(),
      smtpPort: get('SMTP_PORT').string().transform(Number),
    })).parse();

    return new EmailClient(config);
  }
} satisfies Service<'email', EmailClient>;
```

## Usage with Endpoints

```typescript
import { e } from '@geekmidas/constructs/endpoints';

export const endpoint = e
  .get('/users/:id')
  .services([databaseService, cacheService])
  .handle(async ({ params, services }) => {
    // Type-safe access to services
    const cached = await services.cache.get(`user:${params.id}`);
    if (cached) return cached;

    const user = await services.database.users.findById(params.id);
    await services.cache.set(`user:${params.id}`, user);
    return user;
  });
```

## Package Exports

| Export | Description |
|--------|-------------|
| `/` | `Service` interface, `ServiceDiscovery`, `ServiceRegisterOptions` |
| `/context` | `serviceContext` singleton and `runWithRequestContext` for AsyncLocalStorage-based request context |
| `/trpc` | tRPC middleware factories (`createServicesMiddleware`, `createRequestContextMiddleware`) |
| `/middy` | Middy middlewares for standalone Lambda handlers (`requestContext`, `addServices`, `withServices`) |

## Request Context

The `/context` export provides AsyncLocalStorage-based request context that services can access to get the current request's logger and ID:

```typescript
import { serviceContext, runWithRequestContext } from '@geekmidas/services/context';

// Establish context for a request (done automatically by framework adapters)
await runWithRequestContext(
  { requestId: 'req-123', logger, startTime: Date.now() },
  async () => {
    // Inside this callback, any code can access the context:
    const logger = serviceContext.getLogger();
    const reqId = serviceContext.getRequestId();
    const hasCtx = serviceContext.hasContext();
  }
);
```

### Request-scoped logger in singleton services

Services are **singletons** — `register()` runs once and the instance is cached and
reused for every request. The per-request logger, however, changes on every request.

To make this safe, `serviceContext.getLogger()` returns a **request-scoped proxy**:
it re-resolves the current request's logger on every log call. This means a service
can capture the logger **once** during `register()` and still log against the correct
per-request logger:

```typescript
const databaseService = {
  serviceName: 'database' as const,
  register({ context }) {
    // ✅ Safe: getLogger() returns a live proxy, not a frozen logger.
    //    Each call routes to the CURRENT request's logger.
    const logger = context.getLogger().child({ svc: 'db' });

    return {
      async query(sql: string) {
        logger.debug({ sql }, 'Executing query');
      },
    };
  },
} satisfies Service<'database', Database>;
```

::: warning
Before this proxy existed, capturing `context.getLogger()` in `register()` froze the
**first** request's logger for the lifetime of the process, so later requests logged
with the first request's `requestId` and user bindings. The proxy fixes this; just
make sure you log **through** the value returned by `getLogger()` / `.child()` rather
than snapshotting a concrete logger elsewhere.
:::

Calling a log method (or `getLogger()` itself) outside any request context throws.
Guard detached/background work with `serviceContext.hasContext()`.

See [Request-Scoped Logging in Singleton Services](https://github.com/geekmidas/toolbox/blob/main/packages/services/docs/request-scoped-logging.md)
for the full problem description and implementation details.

## tRPC Integration

The `/trpc` export provides two middleware factories for integrating services with [tRPC](https://trpc.io). You keep your own `initTRPC` setup and compose only the pieces you want.

| Helper | Purpose |
|--------|---------|
| `createServicesMiddleware(t.middleware, envParser?)` | Per-procedure middleware that resolves declared services via `ServiceDiscovery` and merges them onto `ctx`. Wraps the downstream call in `runWithRequestContext` so services can read `serviceContext.getLogger()`. |
| `createRequestContextMiddleware(t.middleware)` | Sets up the request context (logger / requestId / startTime) without resolving services. |

Initialize tRPC with a context that carries at minimum a `logger`. Optionally include `requestId`, `startTime`, and a `serviceDiscovery` instance to share across procedures.

```typescript
import { initTRPC } from '@trpc/server';
import type { Logger } from '@geekmidas/logger';
import type { ServiceDiscovery } from '@geekmidas/services';
import {
  createServicesMiddleware,
  createRequestContextMiddleware,
} from '@geekmidas/services/trpc';
import { envParser } from './env';

export interface Context {
  logger: Logger;
  session: { user: { id: string } } | null;
  serviceDiscovery?: ServiceDiscovery; // optional (overload 2)
  requestId?: string; // optional — auto-generated when missing
  startTime?: number;
}

const t = initTRPC.context<Context>().create();
export const router = t.router;
export const baseProcedure = t.procedure;

// Overload 1: pass an EnvironmentParser; services resolve via the singleton.
export const withServices = createServicesMiddleware(t.middleware, envParser);

// Overload 2: omit envParser; ctx.serviceDiscovery is read at request time.
// export const withServices = createServicesMiddleware<Context, object>(t.middleware);
```

Declare the services a procedure needs and they appear on `ctx` keyed by `serviceName`:

```typescript
export const usersRouter = router({
  list: baseProcedure
    .use(withServices([DatabaseService, CacheService]))
    .query(async ({ ctx }) => {
      const cached = await ctx.cache.get('users:list');
      if (cached) return cached;
      const users = await ctx.database.selectFrom('users').selectAll().execute();
      await ctx.cache.set('users:list', users, { ttl: 60 });
      return users;
    }),
});
```

For procedures that don't need services but still want `serviceContext`, use `createRequestContextMiddleware`. `requestId`/`startTime` come from `ctx` when present, otherwise generated (`node:crypto`'s `randomUUID()` and `Date.now()`).

`createServicesMiddleware` tags the inner middleware with the requested service tuple as `_services`, so route generators can introspect a procedure's dependencies by walking its `_middlewares` array.

## Middy Integration

The `/middy` export brings request context and service discovery to **standalone** [Middy](https://middy.js.org) Lambda handlers — functions not built with the `@geekmidas/constructs` Function/Cron constructs.

| Middleware | Purpose |
|------------|---------|
| `requestContext({ logger, ... })` | Establishes a request context so `serviceContext.getLogger()` / `getRequestId()` / `getRequestStartTime()` work in the handler and any service it calls. |
| `addServices([...], { envParser })` | Resolves services and attaches the typed record to `event.services` (matching the `Function`/`Cron` constructs). Pure resolver — pair with `requestContext` if your services read `serviceContext`. Chainable. |
| `withServices([...], { logger, envParser })` | Batteries-included: `requestContext` + `addServices` in a single `.use(...)`. |

```typescript
import middy from '@middy/core';
import { withServices, requestContext } from '@geekmidas/services/middy';
import { serviceContext } from '@geekmidas/services';
import { databaseService, cacheService } from './services';
import { envParser } from './env';
import { logger } from './logger';

// Services + request context. Resolved instances are typed on `event.services`.
export const handler = middy(async (event) => {
  const user = await event.services.database.users.findById(event.id);
  event.services.cache.set(`user:${event.id}`, user);
  return user;
}).use(withServices([databaseService, cacheService], { logger, envParser }));

// Just request context (logger / request id), no services:
export const ping = middy(async () => {
  serviceContext.getLogger().info('ping');
}).use(requestContext({ logger }));
```

**Options:**

- `logger` (**required** for `requestContext` / `withServices`) — the base logger to derive the per-request child from. The middlewares are generic over `TLogger extends Logger`, so a custom logger type is preserved. There is no implicit default — you decide which logger to use.
- `getRequestId(event, context)` — derive the request id (defaults to `context.awsRequestId`, always present in a Lambda invocation).
- `bindings(event, context)` — extra child-logger bindings.
- `envParser` (**required** for `addServices` / `withServices`) — used to build the `ServiceDiscovery`. `serviceDiscovery` may be passed to override it. There is no implicit `process.env` default.

Type the handler's event with the exported `EventServices<T>` helper when you need it explicitly, e.g. `(event: EventServices<[typeof dbService]> & APIGatewayProxyEvent)`.

::: tip
These middlewares establish the context with `AsyncLocalStorage.enterWith` (the only option in Middy's `before`/`after` model). `requestContext` always creates a **fresh** context per invocation, so on a warm Lambda one invocation never inherits a previous one's logger. See the [request-scoped logging notes](https://github.com/geekmidas/toolbox/blob/main/packages/services/docs/request-scoped-logging.md).
:::

## Service Interface

```typescript
interface ServiceRegisterOptions {
  /** Environment parser for configuration */
  envParser: EnvironmentParser<{}>;
  /** Request context for logging and tracing */
  context: ServiceContext;
}

interface Service<TName extends string, TInstance> {
  serviceName: TName;
  register(options: ServiceRegisterOptions): Promise<TInstance> | TInstance;
}

interface ServiceContext {
  /** Get a logger bound to the current request */
  getLogger(): Logger;
  /** Get the current request ID */
  getRequestId(): string | undefined;
}
```
