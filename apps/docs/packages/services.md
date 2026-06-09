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
