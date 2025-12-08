# @geekmidas/constructs

A comprehensive framework for building type-safe HTTP endpoints, cloud functions, scheduled tasks, and event subscribers with full TypeScript support and AWS Lambda deployment capabilities.

## Features

- **Type-Safe Endpoints**: Build HTTP endpoints with full type inference
- **Cloud Functions**: Create serverless functions with schema validation
- **Scheduled Tasks**: Define cron jobs with type-safe handlers
- **Event Subscribers**: Handle events with structured message processing
- **Service Discovery**: Built-in dependency injection system
- **Multiple Adapters**: AWS Lambda, API Gateway (v1/v2), and Hono support
- **StandardSchema Validation**: Works with Zod, Valibot, and other validation libraries
- **Event Publishing**: Integrated event publishing from any construct
- **Audit Logging**: Transaction-aware audit system with automatic rollback support
- **Rate Limiting**: Built-in rate limiting with configurable storage
- **OpenAPI Integration**: Generate OpenAPI specifications from endpoints

## Installation

```bash
pnpm add @geekmidas/constructs
```

## Package Exports

```typescript
// Endpoints
import { e, EndpointBuilder } from '@geekmidas/constructs/endpoints';

// Functions
import { f, FunctionBuilder } from '@geekmidas/constructs/functions';

// Crons
import { cron, CronBuilder } from '@geekmidas/constructs/crons';

// Subscribers
import { SubscriberBuilder } from '@geekmidas/constructs/subscribers';
```

## Quick Start

### HTTP Endpoints

Create type-safe HTTP endpoints with the fluent builder pattern:

```typescript
import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod';

// Simple GET endpoint
export const getUsers = e
  .get('/users')
  .output(z.array(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email()
  })))
  .handle(async () => {
    return [
      { id: '1', name: 'John Doe', email: 'john@example.com' }
    ];
  });

// POST endpoint with body validation
export const createUser = e
  .post('/users')
  .body(z.object({
    name: z.string().min(1),
    email: z.string().email()
  }))
  .output(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string()
  }))
  .handle(async ({ body }) => {
    // body is fully typed as { name: string; email: string }
    return {
      id: crypto.randomUUID(),
      name: body.name,
      email: body.email
    };
  });

// Endpoint with query parameters
export const searchUsers = e
  .get('/users/search')
  .query(z.object({
    q: z.string(),
    limit: z.coerce.number().default(10)
  }))
  .output(z.array(z.object({
    id: z.string(),
    name: z.string()
  })))
  .handle(async ({ query }) => {
    // query is typed as { q: string; limit: number }
    return [];
  });
```

### Cloud Functions

Create serverless functions with input/output validation:

```typescript
import { f } from '@geekmidas/constructs/functions';
import { z } from 'zod';

export const processOrder = f
  .input(z.object({
    orderId: z.string(),
    items: z.array(z.object({
      id: z.string(),
      quantity: z.number().int().positive()
    }))
  }))
  .output(z.object({
    orderId: z.string(),
    status: z.enum(['processing', 'completed', 'failed']),
    processedAt: z.string().datetime()
  }))
  .timeout(300000) // 5 minutes
  .handle(async ({ input, logger }) => {
    logger.info(`Processing order ${input.orderId}`);

    // Process order logic
    for (const item of input.items) {
      logger.info(`Processing item ${item.id}, quantity: ${item.quantity}`);
    }

    return {
      orderId: input.orderId,
      status: 'completed',
      processedAt: new Date().toISOString()
    };
  });
```

### Scheduled Tasks (Crons)

Define cron jobs with schedules:

```typescript
import { cron } from '@geekmidas/constructs/crons';

// Daily report at 9 AM UTC
export const dailyReport = cron
  .schedule('cron(0 9 * * ? *)')
  .timeout(600000) // 10 minutes
  .handle(async ({ logger }) => {
    logger.info('Generating daily report');

    const reportDate = new Date().toISOString().split('T')[0];
    const reportData = {
      date: reportDate,
      totalOrders: 150,
      totalRevenue: 12500.00
    };

    logger.info('Daily report generated', reportData);
    return reportData;
  });

// Hourly cleanup
export const hourlyCleanup = cron
  .schedule('rate(1 hour)')
  .timeout(300000) // 5 minutes
  .handle(async ({ logger }) => {
    logger.info('Running hourly cleanup');

    const itemsCleaned = 42;
    logger.info(`Cleaned ${itemsCleaned} items`);

    return { itemsCleaned };
  });
```

### Event Subscribers

Handle events with type-safe message processing:

```typescript
import { SubscriberBuilder } from '@geekmidas/constructs/subscribers';
import { z } from 'zod';

export const userEventsSubscriber = new SubscriberBuilder()
  .subscribe(['user.created', 'user.updated', 'user.deleted'])
  .timeout(30000)
  .output(z.object({
    processed: z.number(),
    success: z.boolean()
  }))
  .handle(async ({ events, logger }) => {
    logger.info(
      { eventCount: events.length },
      'Processing user events'
    );

    for (const event of events) {
      try {
        switch (event.type) {
          case 'user.created':
            logger.info({ userId: event.data.userId }, 'User created');
            break;
          case 'user.updated':
            logger.info({ userId: event.data.userId }, 'User updated');
            break;
          case 'user.deleted':
            logger.info({ userId: event.data.userId }, 'User deleted');
            break;
        }
      } catch (error) {
        logger.error({ error, event }, 'Failed to process event');
        throw error;
      }
    }

    return {
      processed: events.length,
      success: true
    };
  });
```

## Advanced Features

### Service Discovery

Inject services into your constructs:

```typescript
import { e } from '@geekmidas/constructs/endpoints';
import type { Service } from '@geekmidas/services';
import type { EnvironmentParser } from '@geekmidas/envkit';
import { Kysely } from 'kysely';
import { z } from 'zod';

// Define a database service
const databaseService = {
  serviceName: 'database' as const,
  async register(envParser: EnvironmentParser<{}>) {
    const config = envParser.create((get) => ({
      url: get('DATABASE_URL').string()
    })).parse();

    const db = new Kysely({ /* config */ });
    return db;
  }
} satisfies Service<'database', Kysely<Database>>;

// Use service in endpoint
export const getUserFromDb = e
  .get('/users/:id')
  .params(z.object({ id: z.string() }))
  .services([databaseService])
  .handle(async ({ params, services }) => {
    // services.database is fully typed
    const user = await services.database
      .selectFrom('users')
      .where('id', '=', params.id)
      .selectAll()
      .executeTakeFirst();

    return user;
  });
```

### Event Publishing

Publish events from any construct:

```typescript
import { e } from '@geekmidas/constructs/endpoints';
import type { Service } from '@geekmidas/services';
import type { EventPublisher, PublishableMessage } from '@geekmidas/events';
import { z } from 'zod';

// Define event types
type UserEvents =
  | PublishableMessage<'user.created', { userId: string; email: string }>
  | PublishableMessage<'user.updated', { userId: string }>;

// Create event publisher service
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

// Use in endpoint with event publishing
export const createUser = e
  .post('/users')
  .body(z.object({
    name: z.string(),
    email: z.string().email()
  }))
  .publisher(userEventPublisher)
  .event('user.created', (body, result) => ({
    userId: result.id,
    email: body.email
  }))
  .handle(async ({ body, publish }) => {
    const user = {
      id: crypto.randomUUID(),
      name: body.name,
      email: body.email
    };

    // Events are automatically published after successful execution
    return user;
  });
```

### Database Context

Inject a database instance directly into the handler context using `.database()`:

```typescript
import { e } from '@geekmidas/constructs/endpoints';
import type { Service } from '@geekmidas/services';
import type { EnvironmentParser } from '@geekmidas/envkit';
import { Kysely, PostgresDialect } from 'kysely';
import { z } from 'zod';

// Define a database service
const databaseService = {
  serviceName: 'database' as const,
  async register(envParser: EnvironmentParser<{}>) {
    const config = envParser.create((get) => ({
      url: get('DATABASE_URL').string()
    })).parse();

    return new Kysely<Database>({
      dialect: new PostgresDialect({
        connectionString: config.url
      })
    });
  }
} satisfies Service<'database', Kysely<Database>>;

// Use .database() to inject db into context
export const getUsers = e
  .get('/users')
  .output(z.array(userSchema))
  .database(databaseService)
  .handle(async ({ db }) => {
    // db is always defined when .database() is called (not optional)
    const users = await db
      .selectFrom('users')
      .selectAll()
      .execute();

    return users;
  });
```

**Key features:**

- **Type-safe**: `db` is only available in the context when `.database()` is called
- **Non-optional**: Unlike `services.database`, `db` is always defined (not `undefined`)
- **Automatic transaction**: When combined with `.auditor()` using `KyselyAuditStorage`, `db` is automatically the transaction

#### Database with Audit Transactions

When using both `.database()` and `.auditor()` with the same database, `db` is automatically the transaction - ensuring ACID compliance without any extra code:

```typescript
export const createUser = e
  .post('/users')
  .body(z.object({ name: z.string(), email: z.string().email() }))
  .output(userSchema)
  .database(databaseService)
  .auditor(auditStorageService)
  .handle(async ({ body, db }) => {
    // db is automatically the transaction when auditor uses KyselyAuditStorage
    // Both the user insert and audit records commit/rollback together
    const user = await db
      .insertInto('users')
      .values({ id: crypto.randomUUID(), ...body })
      .returningAll()
      .executeTakeFirstOrThrow();

    return user;
  });
```

**How it works:**
- Without `.auditor()`: `db` is the raw database connection
- With `.auditor()` using `KyselyAuditStorage` **with matching `databaseServiceName`**: `db` is automatically the transaction
- With `.auditor()` using a different storage or different database: `db` remains the raw database

For automatic transaction sharing, the audit storage must declare the same database service name:

```typescript
const auditStorageService = {
  serviceName: 'auditStorage' as const,
  async register(envParser: EnvironmentParser<{}>) {
    const db = await databaseService.register(envParser);
    return new KyselyAuditStorage({
      db,
      tableName: 'audit_logs',
      databaseServiceName: 'database', // Must match databaseService.serviceName
    });
  }
};
```

### Audit Logging

Add transaction-aware audit logging to track data changes. Audits run **inside** the same database transaction as your mutations, ensuring they're atomically committed or rolled back together.

#### Setting Up Audit Storage

First, create an audit storage service using `@geekmidas/audit`:

```typescript
import { KyselyAuditStorage } from '@geekmidas/audit/kysely';
import type { Service } from '@geekmidas/services';
import type { EnvironmentParser } from '@geekmidas/envkit';

const auditStorageService = {
  serviceName: 'auditStorage' as const,
  async register(envParser: EnvironmentParser<{}>) {
    const db = await databaseService.register(envParser);
    return new KyselyAuditStorage({
      db,
      tableName: 'audit_logs',
      // Set this to enable automatic transaction sharing with .database()
      databaseServiceName: databaseService.serviceName,
    });
  }
} satisfies Service<'auditStorage', KyselyAuditStorage<Database>>;
```

#### Defining Audit Action Types

Define type-safe audit actions for your application:

```typescript
import type { AuditableAction } from '@geekmidas/audit';

type AppAuditAction =
  | AuditableAction<'user.created', { userId: string; email: string }>
  | AuditableAction<'user.updated', { userId: string; changes: string[] }>
  | AuditableAction<'user.deleted', { userId: string; reason?: string }>
  | AuditableAction<'order.placed', { orderId: string; total: number }>;
```

#### Declarative Audits

Define audits declaratively on the endpoint - they're automatically recorded after successful handler execution:

```typescript
import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod';

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email()
});

export const createUser = e
  .post('/users')
  .body(z.object({ name: z.string(), email: z.string().email() }))
  .output(userSchema)
  .database(databaseService)
  .auditor(auditStorageService)
  // Optional: extract actor from request context
  .actor(({ session, header }) => ({
    id: session?.userId ?? 'anonymous',
    type: session ? 'user' : 'anonymous',
    ip: header('x-forwarded-for'),
  }))
  // Declarative audits - type-safe with AppAuditAction
  .audit<AppAuditAction>([
    {
      type: 'user.created',
      payload: (response) => ({
        userId: response.id,
        email: response.email,
      }),
      // Optional: only audit when condition is true
      when: (response) => response.email !== 'system@example.com',
      // Optional: link audit to entity for querying
      entityId: (response) => response.id,
      table: 'users',
    },
  ])
  .handle(async ({ body, db }) => {
    // db is automatically the transaction when auditor uses KyselyAuditStorage
    const user = await db
      .insertInto('users')
      .values({ id: crypto.randomUUID(), ...body })
      .returningAll()
      .executeTakeFirstOrThrow();

    return user;
  });
```

**Important**: When using `KyselyAuditStorage`, the adaptor wraps handler execution in a database transaction. The `db` in the context is automatically the transaction, so you can use it directly for ACID-compliant mutations.

#### Manual Audits in Handlers

For complex scenarios, use `ctx.auditor` to record audits manually within your handler:

```typescript
export const processOrder = e
  .post('/orders')
  .database(databaseService)
  .services([paymentService])
  .auditor(auditStorageService)
  .actor(({ session }) => ({ id: session.userId, type: 'user' }))
  .handle(async ({ body, db, services, auditor }) => {
    // db is automatically the transaction when auditor uses KyselyAuditStorage
    const order = await db
      .insertInto('orders')
      .values(body)
      .returningAll()
      .executeTakeFirstOrThrow();

    // Manual audit for payment (external service call)
    const payment = await services.payment.charge(order.total);
    auditor.audit('payment.processed', {
      orderId: order.id,
      amount: order.total,
      transactionId: payment.transactionId,
    });

    // Conditional audit for high-value orders
    if (order.total > 10000) {
      auditor.audit('order.high_value', {
        orderId: order.id,
        total: order.total,
        requiresReview: true,
      });
    }

    return order;
  });
```

#### Combined Declarative and Manual Audits

You can use both approaches together:

```typescript
export const updateUser = e
  .put('/users/:id')
  .params(z.object({ id: z.string() }))
  .body(z.object({ name: z.string().optional(), email: z.string().email().optional() }))
  .output(userSchema)
  .database(databaseService)
  .auditor(auditStorageService)
  .actor(({ session }) => ({ id: session.userId, type: 'user' }))
  // Declarative audit - always runs on success
  .audit<AppAuditAction>([
    {
      type: 'user.updated',
      payload: (response) => ({
        userId: response.id,
        changes: ['profile'],
      }),
    },
  ])
  .handle(async ({ params, body, db, auditor }) => {
    // db is automatically the transaction when auditor uses KyselyAuditStorage

    // Fetch old values for comparison
    const oldUser = await db
      .selectFrom('users')
      .where('id', '=', params.id)
      .selectAll()
      .executeTakeFirstOrThrow();

    // Update user
    const user = await db
      .updateTable('users')
      .set(body)
      .where('id', '=', params.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    // Manual audit with old/new values for detailed change tracking
    if (oldUser.email !== user.email) {
      auditor.audit('user.email_changed', {
        userId: user.id,
        oldEmail: oldUser.email,
        newEmail: user.email,
      });
    }

    return user;
  });
```

#### How Transaction Support Works

When using `KyselyAuditStorage`, the adaptor automatically:

1. **Creates an audit context** before handler execution
2. **Wraps execution in a transaction** using `withAuditableTransaction`
3. **Passes the auditor** to your handler via `ctx.auditor`
4. **Processes declarative audits** after the handler succeeds
5. **Flushes all audits** to storage inside the transaction
6. **Commits or rolls back** - if the handler throws, both data and audits are rolled back

```
┌─────────────────────────────────────────────────────────────┐
│                    Request Flow                              │
├─────────────────────────────────────────────────────────────┤
│  1. Create audit context (auditor + storage)                │
│  2. BEGIN TRANSACTION                                        │
│     ├── Execute handler (with ctx.auditor)                  │
│     ├── Handler calls auditor.audit() for manual audits     │
│     ├── Process declarative .audit() definitions            │
│     ├── Flush all audit records to storage                  │
│  3. COMMIT (or ROLLBACK if handler throws)                  │
└─────────────────────────────────────────────────────────────┘
```

This ensures:
- **Atomicity**: Audits are never written if the mutation fails
- **Consistency**: No orphaned audit records for failed operations
- **Rollback safety**: Manual audits recorded before a later error are also rolled back

#### Audit Table Migration

Create a Kysely migration for the audit table:

```typescript
// migrations/YYYYMMDDHHMMSS_create_audit_logs.ts
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('audit_logs')
    .addColumn('id', 'varchar(32)', (col) => col.primaryKey())
    .addColumn('type', 'varchar', (col) => col.notNull())
    .addColumn('operation', 'varchar', (col) => col.notNull())
    .addColumn('table', 'varchar')
    .addColumn('entity_id', 'varchar')
    .addColumn('old_values', 'jsonb')
    .addColumn('new_values', 'jsonb')
    .addColumn('payload', 'jsonb')
    .addColumn('timestamp', 'timestamp', (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addColumn('actor_id', 'varchar')
    .addColumn('actor_type', 'varchar')
    .addColumn('actor_data', 'jsonb')
    .addColumn('metadata', 'jsonb')
    .execute();

  // Create indexes for common queries
  await db.schema
    .createIndex('idx_audit_logs_type')
    .on('audit_logs')
    .column('type')
    .execute();

  await db.schema
    .createIndex('idx_audit_logs_entity')
    .on('audit_logs')
    .column('entity_id')
    .execute();

  await db.schema
    .createIndex('idx_audit_logs_actor')
    .on('audit_logs')
    .column('actor_id')
    .execute();

  await db.schema
    .createIndex('idx_audit_logs_timestamp')
    .on('audit_logs')
    .column('timestamp')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('audit_logs').execute();
}
```

If using camelCase column names with Kysely's `CamelCasePlugin`:

```typescript
// migrations/YYYYMMDDHHMMSS_create_audit_logs.ts
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('auditLogs')
    .addColumn('id', 'varchar(32)', (col) => col.primaryKey())
    .addColumn('type', 'varchar', (col) => col.notNull())
    .addColumn('operation', 'varchar', (col) => col.notNull())
    .addColumn('table', 'varchar')
    .addColumn('entityId', 'varchar')
    .addColumn('oldValues', 'jsonb')
    .addColumn('newValues', 'jsonb')
    .addColumn('payload', 'jsonb')
    .addColumn('timestamp', 'timestamp', (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addColumn('actorId', 'varchar')
    .addColumn('actorType', 'varchar')
    .addColumn('actorData', 'jsonb')
    .addColumn('metadata', 'jsonb')
    .execute();

  await db.schema
    .createIndex('idx_audit_logs_type')
    .on('auditLogs')
    .column('type')
    .execute();

  await db.schema
    .createIndex('idx_audit_logs_entity')
    .on('auditLogs')
    .column('entityId')
    .execute();

  await db.schema
    .createIndex('idx_audit_logs_actor')
    .on('auditLogs')
    .column('actorId')
    .execute();

  await db.schema
    .createIndex('idx_audit_logs_timestamp')
    .on('auditLogs')
    .column('timestamp')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('auditLogs').execute();
}
```

#### Querying Audit Records

The `KyselyAuditStorage` provides a `query` method:

```typescript
// In a handler or service
const audits = await auditStorage.query({
  entityId: userId,
  table: 'users',
  limit: 50,
  orderBy: 'timestamp',
  orderDirection: 'desc',
});
```

### Rate Limiting

Add rate limiting to endpoints:

```typescript
import { e } from '@geekmidas/constructs/endpoints';
import { InMemoryCache } from '@geekmidas/cache/memory';
import { z } from 'zod';

export const sendMessage = e
  .post('/api/messages')
  .rateLimit({
    limit: 10,
    windowMs: 60000, // 1 minute
    cache: new InMemoryCache(),
  })
  .body(z.object({
    content: z.string()
  }))
  .handle(async ({ body }) => {
    // Rate limited to 10 requests per minute
    return { success: true };
  });
```

## AWS Lambda Adapters

Deploy your constructs to AWS Lambda:

### API Gateway v1 Adapter

```typescript
import { AmazonApiGatewayV1Endpoint } from '@geekmidas/constructs/aws';
import { getUsers } from './endpoints';
import { envParser } from './env';

const adapter = new AmazonApiGatewayV1Endpoint(envParser, getUsers);

export const handler = adapter.handler;
```

### API Gateway v2 Adapter

```typescript
import { AmazonApiGatewayV2Endpoint } from '@geekmidas/constructs/aws';
import { getUsers } from './endpoints';
import { envParser } from './env';

const adapter = new AmazonApiGatewayV2Endpoint(envParser, getUsers);

export const handler = adapter.handler;
```

### Lambda Function Adapter

```typescript
import { AWSLambdaFunction } from '@geekmidas/constructs/aws';
import { processOrder } from './functions';
import { envParser } from './env';

const adapter = new AWSLambdaFunction(envParser, processOrder);

export const handler = adapter.handler;
```

### Lambda Cron Adapter

```typescript
import { AWSScheduledFunction } from '@geekmidas/constructs/aws';
import { dailyReport } from './crons';
import { envParser } from './env';

const adapter = new AWSScheduledFunction(envParser, dailyReport);

export const handler = adapter.handler;
```

### Lambda Subscriber Adapter

```typescript
import { AWSLambdaSubscriber } from '@geekmidas/constructs/aws';
import { userEventsSubscriber } from './subscribers';
import { envParser } from './env';

const adapter = new AWSLambdaSubscriber(envParser, userEventsSubscriber);

export const handler = adapter.handler;
```

## Hono Server Adapter

Deploy your endpoints as a Hono server:

```typescript
import { HonoEndpoint } from '@geekmidas/constructs/endpoints';
import { ServiceDiscovery } from '@geekmidas/services';
import { Hono } from 'hono';
import { envParser } from './env';
import { logger } from './logger';
import { getUsers, createUser } from './endpoints';

export function createApp(app?: Hono): Hono {
  const honoApp = app || new Hono();

  const endpoints = [getUsers, createUser];

  const serviceDiscovery = ServiceDiscovery.getInstance(logger, envParser);

  HonoEndpoint.addRoutes(endpoints, serviceDiscovery, honoApp);

  return honoApp;
}

// server.ts
import { serve } from '@hono/node-server';
import { createApp } from './app';

const app = createApp();

serve({
  fetch: app.fetch,
  port: 3000
}, () => {
  console.log('Server running on http://localhost:3000');
});
```

## OpenAPI Support

Extract OpenAPI components from endpoints:

```typescript
import { OpenApiExtractor } from '@geekmidas/constructs/endpoints';
import { getUsers, createUser } from './endpoints';

const extractor = new OpenApiExtractor();
const components = extractor.extractComponents([getUsers, createUser]);

// Use with @geekmidas/cli to generate full OpenAPI spec
```

## Environment Variable Detection

All constructs support automatic environment variable detection for build-time infrastructure provisioning. This allows deployment tools to know exactly which environment variables each construct requires.

### Using `getEnvironment()`

Every construct has an async `getEnvironment()` method that returns the environment variables required by its services:

```typescript
import { e } from '@geekmidas/constructs/endpoints';
import { databaseService } from './services/database';
import { cacheService } from './services/cache';

const endpoint = e
  .get('/users')
  .services([databaseService, cacheService])
  .handle(async ({ services }) => {
    // Implementation
  });

// Detect required environment variables
const envVars = await endpoint.getEnvironment();
// Returns: ['CACHE_URL', 'DATABASE_URL'] (sorted alphabetically)
```

### How It Works

The detection works by:

1. Creating a "sniffer" `EnvironmentParser` with empty configuration
2. Calling each service's `register()` method with the sniffer
3. Tracking which environment variables are accessed via `get('VAR_NAME')`
4. Collecting and deduplicating the variable names
5. Returning a sorted array of variable names

**Important**: Environment variables are tracked when `get('VAR_NAME')` is called, **before** `.parse()` validates the values. This means detection works even when actual environment values don't exist (build time).

### Service Pattern for Detection

For environment detection to work, services should return the `ConfigParser` from `envParser.create()`:

```typescript
import type { Service } from '@geekmidas/services';
import type { EnvironmentParser } from '@geekmidas/envkit';

// ✅ Sync service - returns ConfigParser directly
const databaseService = {
  serviceName: 'database' as const,
  register(envParser: EnvironmentParser<{}>) {
    // Return the ConfigParser - this tracks env vars
    return envParser.create((get) => ({
      url: get('DATABASE_URL').string(),
      port: get('DATABASE_PORT').string().transform(Number).default('5432')
    }));
  }
} satisfies Service<'database', any>;

// ✅ Async service - check for empty env to support detection
const eventService = {
  serviceName: 'events' as const,
  register(envParser: EnvironmentParser<{}>) {
    const configParser = envParser.create((get) => ({
      connectionString: get('EVENT_CONNECTION_STRING').string()
    }));

    // Return ConfigParser for environment detection (build time)
    // @ts-ignore - accessing internal property to detect sniffer
    if (Object.keys(envParser.env || {}).length === 0) {
      return configParser;
    }

    // Return Promise for runtime
    return (async () => {
      const config = configParser.parse();
      // Initialize service with config
      return await createService(config);
    })();
  }
} satisfies Service<'events', any>;
```

### Build-Time Usage

The `@geekmidas/cli` automatically calls `getEnvironment()` during build to populate the manifest:

```json
{
  "routes": [
    {
      "path": "/users",
      "method": "GET",
      "handler": ".gkm/getUsers.handler",
      "environment": [
        "DATABASE_URL",
        "DATABASE_PORT"
      ]
    }
  ]
}
```

This manifest can then be used by infrastructure-as-code tools (Terraform, CDK, SST, etc.) to automatically configure Lambda functions with the correct environment variables.

### Features

- **Automatic Detection**: No manual configuration needed
- **Async Service Support**: Works with both sync and async services
- **Deduplication**: Each variable listed once even if used by multiple services
- **Sorted Output**: Variables always returned in alphabetical order
- **Error Resilient**: Parse failures don't affect detection
- **Publisher Support**: Detects variables from `.publisher()` services

### Example with Multiple Services

```typescript
import { e } from '@geekmidas/constructs/endpoints';
import { databaseService } from './services/database';
import { cacheService } from './services/cache';
import { emailService } from './services/email';

const endpoint = e
  .post('/users')
  .services([databaseService, cacheService, emailService])
  .handle(async ({ services }) => {
    // Create user
  });

// Automatically detects all variables from all services
const envVars = await endpoint.getEnvironment();
// Returns: [
//   'CACHE_URL',
//   'DATABASE_URL',
//   'DATABASE_PORT',
//   'SMTP_HOST',
//   'SMTP_PORT',
//   'SMTP_USER',
//   'SMTP_PASS'
// ]
```

## Related Packages

- [@geekmidas/services](../services) - Service discovery and dependency injection
- [@geekmidas/events](../events) - Event publishing and subscription
- [@geekmidas/audit](../audit) - Transaction-aware audit logging
- [@geekmidas/logger](../logger) - Structured logging
- [@geekmidas/envkit](../envkit) - Environment configuration
- [@geekmidas/errors](../errors) - HTTP error classes
- [@geekmidas/client](../client) - Type-safe client for consuming endpoints
- [@geekmidas/cli](../cli) - CLI tools for building and deploying

## License

MIT
