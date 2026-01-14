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
