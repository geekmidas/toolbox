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

## Related Packages

- [@geekmidas/services](../services) - Service discovery and dependency injection
- [@geekmidas/events](../events) - Event publishing and subscription
- [@geekmidas/logger](../logger) - Structured logging
- [@geekmidas/envkit](../envkit) - Environment configuration
- [@geekmidas/errors](../errors) - HTTP error classes
- [@geekmidas/client](../client) - Type-safe client for consuming endpoints
- [@geekmidas/cli](../cli) - CLI tools for building and deploying

## License

MIT
