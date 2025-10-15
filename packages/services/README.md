# @geekmidas/services

Service discovery and dependency injection system for TypeScript applications with full type safety and automatic lifecycle management.

## Features

- **Type-Safe Services**: Full TypeScript support with generic type inference
- **Lazy Initialization**: Services are initialized only when needed
- **Singleton Pattern**: Services are cached and reused across requests
- **Dependency Injection**: Automatic service resolution and injection
- **Environment Integration**: Seamless integration with @geekmidas/envkit
- **Service Discovery**: Centralized service registry and discovery
- **Error Handling**: Graceful error handling during service initialization

## Installation

```bash
pnpm add @geekmidas/services
```

## Quick Start

### Define a Service

```typescript
import type { Service } from '@geekmidas/services';
import type { EnvironmentParser } from '@geekmidas/envkit';
import { Kysely } from 'kysely';

// Define your database service
const databaseService = {
  serviceName: 'database' as const,
  async register(envParser: EnvironmentParser<{}>) {
    const config = envParser.create((get) => ({
      url: get('DATABASE_URL').string(),
      ssl: get('DATABASE_SSL').string().transform(Boolean).default('false')
    })).parse();

    const db = new Kysely({ /* config */ });
    await db.connection().execute('SELECT 1'); // Health check

    return db;
  }
} satisfies Service<'database', Kysely<Database>>;

export { databaseService };
```

### Use Services in Constructs

```typescript
import { e } from '@geekmidas/constructs/endpoints';
import { databaseService } from './services/database';
import { z } from 'zod';

export const getUser = e
  .get('/users/:id')
  .params(z.object({ id: z.string() }))
  .services([databaseService])
  .handle(async ({ params, services }) => {
    // services.database is fully typed as Kysely<Database>
    const user = await services.database
      .selectFrom('users')
      .where('id', '=', params.id)
      .selectAll()
      .executeTakeFirstOrThrow();

    return user;
  });
```

## Service Discovery

The ServiceDiscovery class manages service lifecycle and dependency injection:

```typescript
import { ServiceDiscovery } from '@geekmidas/services';
import { ConsoleLogger } from '@geekmidas/logger/console';
import { EnvironmentParser } from '@geekmidas/envkit';

const logger = new ConsoleLogger();
const envParser = new EnvironmentParser(process.env).create(() => ({})).parse();

const serviceDiscovery = ServiceDiscovery.getInstance(logger, envParser);

// Services are lazily initialized
const database = await serviceDiscovery.discover(databaseService);
```

## Creating Services

### Database Service

```typescript
import type { Service } from '@geekmidas/services';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

const databaseService = {
  serviceName: 'database' as const,
  async register(envParser: EnvironmentParser<{}>) {
    const config = envParser.create((get) => ({
      host: get('DB_HOST').string(),
      port: get('DB_PORT').string().transform(Number).default('5432'),
      database: get('DB_NAME').string(),
      user: get('DB_USER').string(),
      password: get('DB_PASSWORD').string(),
      ssl: get('DB_SSL').string().transform(Boolean).default('false')
    })).parse();

    const db = new Kysely<Database>({
      dialect: new PostgresDialect({
        pool: new Pool({
          host: config.host,
          port: config.port,
          database: config.database,
          user: config.user,
          password: config.password,
          ssl: config.ssl
        })
      })
    });

    return db;
  }
} satisfies Service<'database', Kysely<Database>>;
```

### Redis/Cache Service

```typescript
import type { Service } from '@geekmidas/services';
import { UpstashCache } from '@geekmidas/cache/upstash';

const cacheService = {
  serviceName: 'cache' as const,
  async register(envParser: EnvironmentParser<{}>) {
    const config = envParser.create((get) => ({
      url: get('UPSTASH_REDIS_URL').string().url(),
      token: get('UPSTASH_REDIS_TOKEN').string()
    })).parse();

    return new UpstashCache({
      url: config.url,
      token: config.token
    });
  }
} satisfies Service<'cache', UpstashCache<any>>;
```

### Email Service

```typescript
import type { Service } from '@geekmidas/services';
import { createEmailClient } from '@geekmidas/emailkit';
import * as templates from './email-templates';

const emailService = {
  serviceName: 'email' as const,
  async register(envParser: EnvironmentParser<{}>) {
    const config = envParser.create((get) => ({
      host: get('SMTP_HOST').string(),
      port: get('SMTP_PORT').string().transform(Number),
      user: get('SMTP_USER').string(),
      pass: get('SMTP_PASS').string(),
      from: get('EMAIL_FROM').string().email()
    })).parse();

    return createEmailClient({
      smtp: {
        host: config.host,
        port: config.port,
        auth: {
          user: config.user,
          pass: config.pass
        }
      },
      templates,
      defaults: { from: config.from }
    });
  }
} satisfies Service<'email', ReturnType<typeof createEmailClient>>;
```

### Event Publisher Service

```typescript
import type { Service } from '@geekmidas/services';
import type { EventPublisher, PublishableMessage } from '@geekmidas/events';

type UserEvents =
  | PublishableMessage<'user.created', { userId: string }>
  | PublishableMessage<'user.updated', { userId: string }>;

const userEventPublisher = {
  serviceName: 'userEventPublisher' as const,
  async register(envParser: EnvironmentParser<{}>) {
    const config = envParser.create((get) => ({
      publisherUrl: get('EVENT_PUBLISHER_URL').string()
    })).parse();

    const { Publisher } = await import('@geekmidas/events');
    return Publisher.fromConnectionString<UserEvents>(config.publisherUrl);
  }
} satisfies Service<'userEventPublisher', EventPublisher<UserEvents>>;
```

## Multiple Services

Inject multiple services into a construct:

```typescript
import { e } from '@geekmidas/constructs/endpoints';
import { databaseService } from './services/database';
import { cacheService } from './services/cache';
import { emailService } from './services/email';
import { z } from 'zod';

export const createUser = e
  .post('/users')
  .body(z.object({
    name: z.string(),
    email: z.string().email()
  }))
  .services([databaseService, cacheService, emailService])
  .handle(async ({ body, services }) => {
    // Check cache first
    const cached = await services.cache.get(`user:${body.email}`);
    if (cached) {
      return cached;
    }

    // Create user in database
    const user = await services.database
      .insertInto('users')
      .values(body)
      .returningAll()
      .executeTakeFirstOrThrow();

    // Send welcome email
    await services.email.sendTemplate('welcome', {
      to: user.email,
      props: { name: user.name }
    });

    // Cache result
    await services.cache.set(`user:${user.email}`, user, 3600);

    return user;
  });
```

## Service Lifecycle

### Lazy Initialization

Services are only initialized when first requested:

```typescript
const serviceDiscovery = ServiceDiscovery.getInstance(logger, envParser);

// Not initialized yet
const service1 = databaseService;

// Initialized here
const db = await serviceDiscovery.discover(databaseService);

// Reuses same instance (singleton)
const db2 = await serviceDiscovery.discover(databaseService);
assert(db === db2); // true
```

### Singleton Pattern

ServiceDiscovery ensures each service is a singleton:

```typescript
// First call initializes the service
const db1 = await serviceDiscovery.discover(databaseService);

// Subsequent calls return cached instance
const db2 = await serviceDiscovery.discover(databaseService);
const db3 = await serviceDiscovery.discover(databaseService);

// All references point to same instance
console.log(db1 === db2 && db2 === db3); // true
```

## Error Handling

Handle service initialization errors gracefully:

```typescript
const databaseService = {
  serviceName: 'database' as const,
  async register(envParser: EnvironmentParser<{}>) {
    try {
      const config = envParser.create((get) => ({
        url: get('DATABASE_URL').string()
      })).parse();

      const db = new Kysely({ /* config */ });

      // Test connection
      await db.connection().execute('SELECT 1');

      return db;
    } catch (error) {
      throw new Error(`Failed to initialize database: ${error.message}`);
    }
  }
} satisfies Service<'database', Kysely<Database>>;
```

## Testing

Mock services in tests:

```typescript
import { ServiceDiscovery } from '@geekmidas/services';
import { vi } from 'vitest';

// Create mock database
const mockDb = {
  selectFrom: vi.fn(() => ({
    where: vi.fn(() => ({
      selectAll: vi.fn(() => ({
        executeTakeFirstOrThrow: vi.fn().mockResolvedValue({
          id: '1',
          name: 'Test User'
        })
      }))
    }))
  }))
};

// Create mock service
const mockDatabaseService = {
  serviceName: 'database' as const,
  async register() {
    return mockDb;
  }
} satisfies Service<'database', typeof mockDb>;

// Use in tests
const serviceDiscovery = ServiceDiscovery.getInstance(logger, envParser);
const db = await serviceDiscovery.discover(mockDatabaseService);

// Test your code
```

## Service Patterns

### Repository Pattern

```typescript
import type { Service } from '@geekmidas/services';

class UserRepository {
  constructor(private db: Kysely<Database>) {}

  async findById(id: string) {
    return this.db
      .selectFrom('users')
      .where('id', '=', id)
      .selectAll()
      .executeTakeFirst();
  }

  async create(data: NewUser) {
    return this.db
      .insertInto('users')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}

const userRepositoryService = {
  serviceName: 'userRepository' as const,
  async register(envParser: EnvironmentParser<{}>) {
    const db = await databaseService.register(envParser);
    return new UserRepository(db);
  }
} satisfies Service<'userRepository', UserRepository>;
```

### Service Composition

```typescript
import type { Service } from '@geekmidas/services';

class UserService {
  constructor(
    private repository: UserRepository,
    private email: EmailClient,
    private cache: Cache
  ) {}

  async createUser(data: NewUser) {
    const user = await this.repository.create(data);
    await this.email.sendTemplate('welcome', {
      to: user.email,
      props: { name: user.name }
    });
    await this.cache.set(`user:${user.id}`, user, 3600);
    return user;
  }
}

const userServiceService = {
  serviceName: 'userService' as const,
  async register(envParser: EnvironmentParser<{}>) {
    const repository = await userRepositoryService.register(envParser);
    const email = await emailService.register(envParser);
    const cache = await cacheService.register(envParser);

    return new UserService(repository, email, cache);
  }
} satisfies Service<'userService', UserService>;
```

## TypeScript Types

```typescript
import type { Service } from '@geekmidas/services';

// Service interface
interface Service<TName extends string = string, TInstance = unknown> {
  serviceName: TName;
  register(envParser: EnvironmentParser<{}>): Promise<TInstance> | TInstance;
}

// Infer service name
type ServiceName<T> = T extends Service<infer N, any> ? N : never;

// Infer service instance type
type ServiceInstance<T> = T extends Service<any, infer I> ? I : never;
```

## Best Practices

### 1. Use `satisfies` for Type Safety

```typescript
// ✅ Use satisfies to ensure correct implementation
const service = {
  serviceName: 'myService' as const,
  async register(envParser) {
    return new MyService();
  }
} satisfies Service<'myService', MyService>;

// ❌ Don't use type annotation (loses type inference)
const service: Service = {
  serviceName: 'myService',
  async register(envParser) {
    return new MyService();
  }
};
```

### 2. Use `as const` for Service Names

```typescript
// ✅ Literal type for better type inference
serviceName: 'database' as const

// ❌ String type loses specificity
serviceName: 'database'
```

### 3. Validate Configuration

```typescript
async register(envParser: EnvironmentParser<{}>) {
  const config = envParser.create((get) => ({
    url: get('DATABASE_URL').string().url(), // Validates URL format
    port: get('PORT').string().transform(Number).default('5432'),
    ssl: get('SSL').string().transform(Boolean).default('false')
  })).parse();

  return new Database(config);
}
```

### 4. Test Connections

```typescript
async register(envParser: EnvironmentParser<{}>) {
  const db = new Database(config);

  // Test connection during initialization
  await db.connection().execute('SELECT 1');

  return db;
}
```

## Related Packages

- [@geekmidas/constructs](../constructs) - Uses services for dependency injection
- [@geekmidas/envkit](../envkit) - Environment configuration for services
- [@geekmidas/logger](../logger) - Logging within services
- [@geekmidas/cache](../cache) - Cache services
- [@geekmidas/events](../events) - Event publisher services

## License

MIT
