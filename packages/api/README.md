# @geekmidas/api

A comprehensive REST API framework for building type-safe HTTP endpoints with built-in support for AWS Lambda, validation, error handling, and service dependency injection.

## Features

- 🔒 **Type-safe endpoints**: Full TypeScript support with automatic type inference
- ✅ **Schema validation**: Uses StandardSchema specification (Zod, Valibot, etc.)
- 🚀 **Multiple runtime support**: AWS Lambda adapters and test adapter included
- 💉 **Dependency injection**: Built-in service discovery and registration
- 🔐 **Authorization**: Flexible authorization system with session management
- 📄 **OpenAPI generation**: Automatic OpenAPI schema generation with reusable components
- 🚨 **Error handling**: Comprehensive HTTP error classes and handling
- 📊 **Structured logging**: Built-in logger with context propagation
- 📡 **Event publishing**: Automatic event publishing after successful endpoint execution
- 🎯 **Zero config**: Works out of the box with sensible defaults
- 🔍 **Advanced query parameters**: Support for nested objects and arrays in query strings
- ♾️ **Infinite queries**: Built-in React Query infinite pagination support
- 🪝 **OpenAPI hooks**: Generate type-safe hooks from operation IDs

### Available Adapters

- **AmazonApiGatewayV1Endpoint**: For AWS API Gateway v1 (REST API)
- **AmazonApiGatewayV2Endpoint**: For AWS API Gateway v2 (HTTP API)
- **TestEndpointAdaptor**: For unit testing endpoints

## Installation

```bash
npm install @geekmidas/api zod
# or
yarn add @geekmidas/api zod
# or
pnpm add @geekmidas/api zod
```

For AWS Lambda support:
```bash
npm install @geekmidas/api @geekmidas/envkit @types/aws-lambda aws-lambda
```

## Quick Start

### Basic Endpoint

```typescript
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

// Define a simple GET endpoint
const getUser = e
  .get('/users/:id')
  .params(z.object({ id: z.string().uuid() }))
  .output(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email()
  }))
  .handle(async ({ params, logger }) => {
    logger.info({ userId: params.id }, 'Fetching user');
    
    // Your logic here
    return {
      id: params.id,
      name: 'John Doe',
      email: 'john@example.com'
    };
  });
```

### AWS Lambda Handler

```typescript
import { AmazonApiGatewayV1Endpoint } from '@geekmidas/api/aws-apigateway';
import { EnvironmentParser } from '@geekmidas/envkit';

const envParser = new EnvironmentParser(process.env);

const endpoint = e
  .get('/health')
  .output(z.object({ status: z.string() }))
  .handle(() => ({ status: 'ok' }));

const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
export const handler = adapter.handler;
```

#### API Gateway v2 (HTTP API)

For AWS API Gateway v2 (HTTP APIs), use the `AmazonApiGatewayV2Endpoint` adapter:

```typescript
import { AmazonApiGatewayV2Endpoint } from '@geekmidas/api/aws-apigateway';
import { EnvironmentParser } from '@geekmidas/envkit';

const envParser = new EnvironmentParser(process.env);

const endpoint = e
  .post('/users')
  .body(z.object({ name: z.string(), email: z.string().email() }))
  .output(z.object({ id: z.string(), created: z.boolean() }))
  .handle(async ({ body }) => ({
    id: crypto.randomUUID(),
    created: true
  }));

const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);
export const handler = adapter.handler;
```

The v2 adapter automatically handles the differences in the API Gateway v2 event format, including:
- Different request context structure
- Simplified path and query parameter handling
- HTTP API-specific features

## Core Concepts

### Endpoint vs Function vs Subscriber

This package provides three main constructs:

1. **RestEndpoint** (`e` export) - For HTTP REST APIs
   - Handler receives destructured parameters: `{ params, query, body, headers, services, logger, session }`
   - Designed for web services with HTTP-specific concepts

2. **Function** (`f` export) - For general-purpose functions
   - Handler receives an `input` object: `{ input, services, logger }`
   - More generic construct for non-HTTP use cases

3. **Subscriber** (`s` export) - For event-driven processing
   - Handler receives batched events: `{ events, services, logger }`
   - Integrates with `@geekmidas/events` for message queue processing
   - Processes events from RabbitMQ, AWS SQS/SNS, or in-memory publishers

### Endpoint Builder

The endpoint builder provides a fluent API for defining HTTP endpoints:

```typescript
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

const endpoint = e
  .post('/users')                                    // HTTP method and path
  .params(z.object({ orgId: z.string() }))          // URL parameters
  .query(z.object({ role: z.string().optional() })) // Query parameters
  .headers(z.object({ 'x-api-key': z.string() }))   // Headers validation
  .body(z.object({                                   // Request body
    name: z.string(),
    email: z.string().email()
  }))
  .output(z.object({                                 // Response schema
    id: z.string(),
    name: z.string(),
    email: z.string()
  }))
  .handle(async ({ params, query, headers, body, logger }) => {
    // Your endpoint logic
    return { id: '123', ...body };
  });
```

### Service Dependency Injection

Define and use services across your endpoints:

```typescript
import type { Service } from '@geekmidas/api/services';
import type { EnvironmentParser } from '@geekmidas/envkit';

// Define a service as an object
const databaseService = {
  serviceName: 'database' as const,
  async register(envParser: EnvironmentParser<{}>) {
    const config = envParser.create((get) => ({
      url: get('DATABASE_URL').string()
    })).parse();

    const db = new Database(config.url);
    await db.connect();
    return db;
  }
} satisfies Service<'database', Database>;

// Use in endpoints
const endpoint = e
  .services([databaseService])
  .post('/users')
  .body(userSchema)
  .handle(async ({ body, services }) => {
    const db = services.database;
    const user = await db.users.create(body);
    return user;
  });
```

### Error Handling

Comprehensive error handling with HTTP-specific error classes:

```typescript
import { 
  NotFoundError, 
  BadRequestError,
  UnauthorizedError,
  createError,
  createHttpError 
} from '@geekmidas/api/errors';

const endpoint = e
  .get('/users/:id')
  .handle(async ({ params }) => {
    const user = await findUser(params.id);
    
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    if (!user.isActive) {
      throw createError.forbidden('User account is inactive');
    }
    
    // Custom error with additional data
    throw createHttpError(422, 'Validation failed', {
      validationErrors: {
        email: 'Invalid format'
      }
    });
    
    return user;
  });
```

### Route Grouping

Organize endpoints with route prefixes:

```typescript
// Create API version prefix
const api = e.route('/api/v1');

// Group user endpoints
const users = api.route('/users');

const listUsers = users.get('/').handle(/* ... */);        // GET /api/v1/users
const getUser = users.get('/:id').handle(/* ... */);       // GET /api/v1/users/:id
const createUser = users.post('/').handle(/* ... */);      // POST /api/v1/users
const updateUser = users.put('/:id').handle(/* ... */);    // PUT /api/v1/users/:id

// Group admin endpoints
const admin = api.route('/admin');
const getStats = admin.get('/stats').handle(/* ... */);    // GET /api/v1/admin/stats
```

### Authorization

Implement authorization at the route or endpoint level:

```typescript
// Route-level authorization
const protectedApi = e.authorize(async ({ req, logger }) => {
  const token = req.headers.get('authorization');
  
  if (!token) {
    return false; // Unauthorized
  }
  
  try {
    const user = await verifyToken(token);
    return { userId: user.id }; // Pass data to endpoints
  } catch {
    return false;
  }
});

// All endpoints under protectedApi require authorization
const endpoint = protectedApi
  .get('/profile')
  .handle(({ auth }) => {
    // auth contains { userId: string }
    return { userId: auth.userId };
  });

// Endpoint-specific authorization
const adminEndpoint = e
  .get('/admin/users')
  .authorize(async ({ req }) => {
    const user = await getUser(req);
    return user.role === 'admin';
  })
  .handle(() => {
    // Only admins can access
  });
```

### Session Management

Add session data to all endpoints:

```typescript
interface SessionData {
  userId: string;
  organizationId: string;
}

const api = e.session<SessionData>(async ({ req }) => {
  const token = req.headers.get('authorization');
  
  if (!token) {
    return null;
  }
  
  return await decodeSessionToken(token);
});

const endpoint = api
  .get('/my-organization')
  .handle(({ session }) => {
    // session is SessionData | null
    if (!session) {
      throw new UnauthorizedError();
    }
    
    return { orgId: session.organizationId };
  });
```

### Advanced Query Parameters

The framework supports complex query parameter structures including nested objects and arrays:

```typescript
const endpoint = e
  .get('/users')
  .query(z.object({
    // Simple parameters
    page: z.number().optional(),
    limit: z.number().optional(),
    
    // Arrays
    ids: z.array(z.string()).optional(),
    
    // Nested objects using dot notation
    'filter.status': z.enum(['active', 'inactive']).optional(),
    'filter.role': z.string().optional(),
    
    // Nested arrays
    'user.roles': z.array(z.string()).optional()
  }))
  .handle(async ({ query }) => {
    // Query: ?ids=1&ids=2&filter.status=active&user.roles=admin&user.roles=moderator
    // Parsed as:
    // {
    //   ids: ['1', '2'],
    //   filter: { status: 'active' },
    //   user: { roles: ['admin', 'moderator'] }
    // }
    return queryUsers(query);
  });
```

### Logging

Built-in structured logging with context:

```typescript
const endpoint = e
  .get('/users/:id')
  .handle(async ({ params, logger }) => {
    // Logger includes request context
    logger.info({ userId: params.id }, 'Fetching user');
    
    try {
      const user = await getUser(params.id);
      logger.debug({ user }, 'User found');
      return user;
    } catch (error) {
      logger.error({ error, userId: params.id }, 'Failed to fetch user');
      throw error;
    }
  });
```

### Subscriber Builder

Build event subscribers that process batched events from message queues. Subscribers integrate with `@geekmidas/events` to consume messages from RabbitMQ, AWS SQS/SNS, or in-memory event systems.

#### Basic Subscriber

```typescript
import { s } from '@geekmidas/api/subscriber';
import type { Service } from '@geekmidas/api/services';
import type { EventPublisher, PublishableMessage } from '@geekmidas/events';
import type { EnvironmentParser } from '@geekmidas/envkit';

// Define your event types
type UserEvents =
  | PublishableMessage<'user.created', { userId: string; email: string }>
  | PublishableMessage<'user.updated', { userId: string; changes: Record<string, any> }>
  | PublishableMessage<'user.deleted', { userId: string }>;

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

// Build a subscriber
const userCreatedSubscriber = s
  .publisher(userEventPublisher)
  .subscribe('user.created')
  .handle(async ({ events, logger }) => {
    logger.info(`Processing ${events.length} user.created events`);

    for (const event of events) {
      // event is typed as { type: 'user.created', payload: { userId: string, email: string } }
      logger.info({ userId: event.payload.userId }, 'User created');

      // Process the event
      await sendWelcomeEmail(event.payload.email);
    }
  });
```

#### Subscribing to Multiple Event Types

```typescript
const userSubscriber = s
  .publisher(UserEventPublisher)
  .subscribe(['user.created', 'user.updated', 'user.deleted'])
  .handle(async ({ events, logger }) => {
    for (const event of events) {
      // TypeScript knows event can be any of the subscribed types
      switch (event.type) {
        case 'user.created':
          logger.info({ userId: event.payload.userId }, 'New user');
          break;
        case 'user.updated':
          logger.info({ userId: event.payload.userId }, 'User updated');
          break;
        case 'user.deleted':
          logger.info({ userId: event.payload.userId }, 'User deleted');
          break;
      }
    }
  });
```

#### Subscriber with Services

```typescript
const emailService = {
  serviceName: 'email' as const,
  async register(envParser: EnvironmentParser<{}>) {
    const config = envParser.create((get) => ({
      apiKey: get('SENDGRID_API_KEY').string()
    })).parse();

    return new EmailClient({ apiKey: config.apiKey });
  }
} satisfies Service<'email', EmailClient>;

const databaseService = {
  serviceName: 'database' as const,
  async register(envParser: EnvironmentParser<{}>) {
    const config = envParser.create((get) => ({
      url: get('DATABASE_URL').string()
    })).parse();

    const db = new Database(config.url);
    await db.connect();
    return db;
  }
} satisfies Service<'database', Database>;

const userCreatedSubscriber = s
  .publisher(UserEventPublisher)
  .services([emailService, databaseService])
  .subscribe('user.created')
  .handle(async ({ events, services, logger }) => {
    const { email, database } = services;

    for (const event of events) {
      // Update local database
      await database.users.updateProcessedStatus(event.payload.userId);

      // Send welcome email
      await email.send({
        to: event.payload.email,
        subject: 'Welcome!',
        template: 'welcome'
      });

      logger.info({ userId: event.payload.userId }, 'Processed user.created event');
    }
  });
```

#### Subscriber with Timeout

```typescript
const longRunningSubscriber = s
  .publisher(UserEventPublisher)
  .subscribe('user.created')
  .timeout(60000) // 60 second timeout
  .handle(async ({ events, logger }) => {
    // Long-running processing
    for (const event of events) {
      await processLongRunningTask(event);
    }
  });
```

#### Subscriber with Output Schema

```typescript
import { z } from 'zod';

const subscriberWithOutput = s
  .publisher(UserEventPublisher)
  .subscribe('user.created')
  .output(z.object({
    processedCount: z.number(),
    failedCount: z.number()
  }))
  .handle(async ({ events, logger }) => {
    let processedCount = 0;
    let failedCount = 0;

    for (const event of events) {
      try {
        await processEvent(event);
        processedCount++;
      } catch (error) {
        logger.error({ error, event }, 'Failed to process event');
        failedCount++;
      }
    }

    return { processedCount, failedCount };
  });
```

#### AWS Lambda Integration

Deploy subscribers as AWS Lambda functions:

```typescript
import { AWSLambdaFunction } from '@geekmidas/api/aws-lambda';
import { EnvironmentParser } from '@geekmidas/envkit';

const envParser = new EnvironmentParser(process.env);

const subscriber = s
  .publisher(UserEventPublisher)
  .subscribe(['user.created', 'user.updated'])
  .handle(async ({ events, logger }) => {
    logger.info(`Processing ${events.length} events`);
    // Process events...
  });

// Create Lambda handler
const adapter = new AWSLambdaFunction(envParser, subscriber);
export const handler = adapter.handler;
```

#### Event Processing Patterns

**Fan-out Pattern**: Multiple subscribers for the same events

```typescript
// Subscriber 1: Send emails
const emailSubscriber = s
  .publisher(UserEventPublisher)
  .services([EmailService])
  .subscribe('user.created')
  .handle(async ({ events, services }) => {
    for (const event of events) {
      await services.Email.sendWelcome(event.payload.email);
    }
  });

// Subscriber 2: Update analytics
const analyticsSubscriber = s
  .publisher(UserEventPublisher)
  .services([AnalyticsService])
  .subscribe('user.created')
  .handle(async ({ events, services }) => {
    for (const event of events) {
      await services.Analytics.trackUserCreated(event.payload.userId);
    }
  });

// Subscriber 3: Sync to CRM
const crmSubscriber = s
  .publisher(UserEventPublisher)
  .services([CRMService])
  .subscribe('user.created')
  .handle(async ({ events, services }) => {
    for (const event of events) {
      await services.CRM.createContact(event.payload);
    }
  });
```

**Batch Processing Pattern**: Process events in batches

```typescript
const batchSubscriber = s
  .publisher(UserEventPublisher)
  .subscribe('user.created')
  .handle(async ({ events, logger }) => {
    // Events are already batched
    logger.info(`Processing batch of ${events.length} events`);

    // Extract all user IDs
    const userIds = events.map(e => e.payload.userId);

    // Bulk database operation
    await database.users.updateMany(userIds, { processed: true });

    // Bulk email send
    await emailService.sendBulk(
      events.map(e => ({
        to: e.payload.email,
        template: 'welcome'
      }))
    );
  });
```

**Error Handling Pattern**: Graceful error handling with logging

```typescript
const resilientSubscriber = s
  .publisher(UserEventPublisher)
  .subscribe('user.created')
  .handle(async ({ events, logger }) => {
    const results = await Promise.allSettled(
      events.map(async (event) => {
        try {
          await processEvent(event);
          logger.info({ eventId: event.payload.userId }, 'Event processed');
        } catch (error) {
          logger.error({
            error,
            eventId: event.payload.userId
          }, 'Failed to process event');

          // Optionally send to dead letter queue
          await deadLetterQueue.send(event);

          throw error; // Re-throw to mark as failed
        }
      })
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    logger.info({ successful, failed, total: events.length }, 'Batch processing complete');
  });
```

#### Subscriber Context

The subscriber handler receives a context object with:

- **`events`**: Array of typed events matching the subscribed event types
- **`services`**: Record of registered services (if `.services()` was called)
- **`logger`**: Logger instance with request context

```typescript
type SubscriberContext = {
  events: Array<{ type: string; payload: any }>;
  services: ServiceRecord<TServices>;
  logger: Logger;
};
```

#### Best Practices

1. **Process Events Idempotently**: Design handlers to safely reprocess events
   ```typescript
   const subscriber = s
     .subscribe('user.created')
     .handle(async ({ events, services }) => {
       for (const event of events) {
         // Check if already processed
         const exists = await services.Database.checkProcessed(event.payload.userId);
         if (exists) continue;

         // Process and mark as complete
         await processEvent(event);
         await services.Database.markProcessed(event.payload.userId);
       }
     });
   ```

2. **Use Batch Operations**: Take advantage of batched events for efficiency
   ```typescript
   // Extract all IDs upfront
   const userIds = events.map(e => e.payload.userId);

   // Single bulk database query
   const users = await database.users.findMany(userIds);

   // Process in batch
   await emailService.sendBulk(users.map(u => ({ to: u.email })));
   ```

3. **Handle Errors Gracefully**: Don't let one failure break the entire batch
   ```typescript
   for (const event of events) {
     try {
       await processEvent(event);
     } catch (error) {
       logger.error({ error, event }, 'Event processing failed');
       // Continue with next event
     }
   }
   ```

4. **Set Appropriate Timeouts**: Adjust based on your processing needs
   ```typescript
   const subscriber = s
     .timeout(30000) // 30 seconds for quick operations
     .subscribe('user.created')
     .handle(async ({ events }) => {
       // Fast processing
     });
   ```

5. **Use Structured Logging**: Include event context in all logs
   ```typescript
   for (const event of events) {
     logger.info({
       eventType: event.type,
       eventId: event.payload.userId,
       timestamp: Date.now()
     }, 'Processing event');
   }
   ```

## Advanced Usage

### Custom Services

Create reusable services for your endpoints:

```typescript
// Cache service
const cacheService = {
  serviceName: 'cache' as const,
  async register(envParser: EnvironmentParser<{}>) {
    const config = envParser.create((get) => ({
      url: get('REDIS_URL').string()
    })).parse();

    const redis = new Redis(config.url);
    await redis.connect();
    return redis;
  }
} satisfies Service<'cache', Redis>;

// Email service
const emailService = {
  serviceName: 'email' as const,
  async register(envParser: EnvironmentParser<{}>) {
    const config = envParser.create((get) => ({
      apiKey: get('SENDGRID_API_KEY').string()
    })).parse();

    return new EmailClient({ apiKey: config.apiKey });
  }
} satisfies Service<'email', EmailClient>;

// Use multiple services
const endpoint = e
  .services([databaseService, cacheService, emailService])
  .post('/users')
  .handle(async ({ input, services }) => {
    const { database, cache, email } = services;

    // Check cache first
    const cached = await cache.get(`user:${input.body.email}`);
    if (cached) return cached;

    // Create user
    const user = await database.users.create(input.body);

    // Cache result
    await cache.set(`user:${user.email}`, user, 3600);

    // Send welcome email
    await email.send({
      to: user.email,
      subject: 'Welcome!',
      body: 'Thanks for signing up!'
    });
    
    return user;
  });
```

### OpenAPI Generation

Generate OpenAPI schemas from your endpoints:

#### Basic OpenAPI Generation

```typescript
const endpoint = e
  .get('/users/:id')
  .params(z.object({ id: z.string().uuid() }))
  .query(z.object({ 
    include: z.enum(['profile', 'posts']).optional() 
  }))
  .output(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
    profile: z.object({
      bio: z.string(),
      avatar: z.string().url()
    }).optional()
  }))
  .openapi({
    summary: 'Get user by ID',
    description: 'Retrieves a user by their unique identifier',
    tags: ['Users'],
    security: [{ bearerAuth: [] }]
  })
  .handle(async ({ params, query }) => {
    // Implementation
  });

// Generate OpenAPI document
const openApiDoc = generateOpenApiDocument([endpoint]);
```

#### OpenAPI Components (Reusable Schemas)

You can extract schemas to the OpenAPI components section for reuse:

```typescript
import { z } from 'zod';

// Mark schema for extraction to components
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email()
}).describe('User').openapi('User');

const ProfileSchema = z.object({
  bio: z.string(),
  avatar: z.string().url()
}).describe('UserProfile').openapi('UserProfile');

// Use in endpoints - will generate $ref in OpenAPI
const endpoint = e
  .get('/users/:id')
  .output(UserSchema.extend({
    profile: ProfileSchema.optional()
  }))
  .handle(async ({ params }) => {
    // Implementation
  });

// Generated OpenAPI will include:
// components:
//   schemas:
//     User:
//       type: object
//       properties: ...
//     UserProfile:
//       type: object
//       properties: ...
```

### Middleware Pattern

While the framework doesn't have traditional middleware, you can compose functionality:

```typescript
// Create a base endpoint with common functionality
const authenticatedApi = e
  .session(getSession)
  .authorize(requireAuth)
  .services([DatabaseService, LoggerService]);

// Build on top of the base
const userEndpoints = authenticatedApi.route('/users');

const getProfile = userEndpoints
  .get('/profile')
  .handle(({ session, services }) => {
    // Has session, auth, and services from base
  });
```

### Testing

The framework provides a dedicated test adapter for unit testing endpoints:

```typescript
import { TestEndpointAdaptor } from '@geekmidas/api/testing';
import { EnvironmentParser } from '@geekmidas/envkit';

describe('User endpoint', () => {
  const envParser = new EnvironmentParser({});
  
  it('should return user by ID', async () => {
    const endpoint = e
      .get('/users/:id')
      .params(z.object({ id: z.string() }))
      .output(userSchema)
      .handle(async ({ params }) => {
        return { id: params.id, name: 'Test User' };
      });
    
    const adapter = new TestEndpointAdaptor(envParser, endpoint);
    const response = await adapter.request({
      method: 'GET',
      url: '/users/123'
    });
    
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: '123',
      name: 'Test User'
    });
  });
  
  it('should handle POST requests with body', async () => {
    const createEndpoint = e
      .post('/users')
      .body(z.object({ name: z.string(), email: z.string().email() }))
      .output(z.object({ id: z.string(), name: z.string() }))
      .handle(async ({ body }) => ({
        id: '123',
        name: body.name
      }));
    
    const adapter = new TestEndpointAdaptor(envParser, createEndpoint);
    const response = await adapter.request({
      method: 'POST',
      url: '/users',
      body: { name: 'John Doe', email: 'john@example.com' }
    });
    
    expect(response.status).toBe(200);
    expect(response.body.name).toBe('John Doe');
  });
});
```

# Typed API Client

A fully type-safe API client for TypeScript that uses OpenAPI specifications to provide automatic type inference for requests and responses.

## Features

- 🚀 Full TypeScript support with automatic type inference
- 🔒 Type-safe request parameters (path, query, body)
- 📦 Built-in React Query integration
- 🛡️ Request/response interceptors
- 🔄 Automatic OpenAPI types generation
- 💪 Zero runtime overhead - all types are compile-time only

## Installation

```bash
npm install @geekmidas/api
# or
pnpm add @geekmidas/api
```

## Quick Start

### 1. Generate Types from OpenAPI Spec

First, generate TypeScript types from your OpenAPI specification using `openapi-typescript`:

```bash
# Install openapi-typescript
npm install -D openapi-typescript

# Generate types from URL
npx openapi-typescript https://api.example.com/openapi.json -o ./src/openapi-types.d.ts

# Or generate types from local file
npx openapi-typescript ./openapi.yaml -o ./src/openapi-types.d.ts
```

This will create a file with your API types that looks like:

```typescript
export interface paths {
  "/users": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": User[];
          };
        };
      };
    };
    post: {
      requestBody: {
        content: {
          "application/json": {
            name: string;
            email: string;
          };
        };
      };
      responses: {
        201: {
          content: {
            "application/json": User;
          };
        };
      };
    };
  };
  // ... more endpoints
}
```

### 2. Create a Typed Fetcher

```typescript
import { createTypedFetcher } from '@geekmidas/api/client';
import type { paths } from './openapi-types';

const client = createTypedFetcher<paths>({
  baseURL: 'https://api.example.com',
  headers: {
    'Authorization': 'Bearer your-token',
  },
});

// TypeScript automatically infers the response type!
const user = await client('GET /users/{id}', {
  params: { id: '123' },
});

console.log(user.name); // TypeScript knows this is a string
```

### 3. Use with React Query

```typescript
import { createTypedQueryClient } from '@geekmidas/api/client';
import type { paths } from './openapi-types';

const queryClient = createTypedQueryClient<paths>({
  baseURL: 'https://api.example.com',
});

function UserProfile({ userId }: { userId: string }) {
  const { data: user, isLoading } = queryClient.useQuery(
    'GET /users/{id}',
    { params: { id: userId } }
  );
  
  if (isLoading) return <div>Loading...</div>;
  
  // TypeScript knows user has properties: id, name, email
  return <div>{user?.name}</div>;
}

// Query Invalidation
async function refreshUser(userId: string) {
  // Invalidate specific user query
  await queryClient.invalidateQueries('GET /users/{id}', {
    params: { id: userId }
  });
  
  // Invalidate all user queries
  await queryClient.invalidateQueries('GET /users');
  
  // Invalidate all queries
  await queryClient.invalidateAllQueries();
}

// Mutations
function CreateUser() {
  const { mutate: createUser } = queryClient.useMutation(
    'POST /users',
    {
      onSuccess: (data) => {
        console.log('User created:', data);
      }
    }
  );
  
  const handleSubmit = () => {
    createUser({
      body: { name: 'New User', email: 'new@example.com' }
    });
  };
  
  return <button onClick={handleSubmit}>Create User</button>;
}
```

## API Reference

### `createTypedFetcher<Paths>(options)`

Creates a typed fetcher instance.

#### Type Parameters

- `Paths`: Your OpenAPI paths type (generated from your OpenAPI spec)

#### Options

- `baseURL`: Base URL for all requests
- `headers`: Default headers to include with every request
- `onRequest`: Request interceptor
- `onResponse`: Response interceptor
- `onError`: Error handler

### `createTypedQueryClient<Paths>(options)`

Creates a typed React Query client.

#### Type Parameters

- `Paths`: Your OpenAPI paths type (generated from your OpenAPI spec)

#### Options

Extends `FetcherOptions`

### Request Configuration

The second parameter accepts a configuration object with the following properties (only available properties based on the endpoint will be accepted):

- `params`: Path parameters (e.g., `{id}` in `/users/{id}`)
- `query`: Query parameters
- `body`: Request body (for POST, PUT, PATCH requests)
- `headers`: Additional headers for this request

## Advanced Usage

### Interceptors

```typescript
import type { paths } from './your-openapi-types';

const client = createTypedFetcher<paths>({
  baseURL: 'https://api.example.com',
  onRequest: async (config) => {
    // Modify request before sending
    config.headers['X-Request-ID'] = generateRequestId();
    return config;
  },
  onResponse: async (response) => {
    // Process response
    if (response.headers.get('X-Refresh-Token')) {
      await refreshAuth();
    }
    return response;
  },
  onError: async (error) => {
    // Handle errors globally
    if (error.response?.status === 401) {
      window.location.href = '/login';
    }
  },
});
```

### Infinite Queries (Pagination)

The client supports React Query's infinite queries for pagination:

```typescript
function PostList() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = queryClient.useInfiniteQuery(
    'GET /posts',
    {
      query: { limit: 20 }, // Will be merged with pageParam
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      initialPageParam: undefined,
    }
  );

  return (
    <div>
      {data?.pages.map((page) =>
        page.items.map((post) => <PostCard key={post.id} post={post} />)
      )}
      
      {hasNextPage && (
        <button 
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  );
}
```

### OpenAPI Hooks (Operation ID-based)

Generate hooks using OpenAPI operation IDs for better organization:

```typescript
import { createOpenAPIHooks } from '@geekmidas/api/client';
import type { paths } from './openapi-types';

// Create hooks based on operation IDs
const api = createOpenAPIHooks<paths>({
  baseURL: 'https://api.example.com',
});

// Use hooks with operation IDs
function UserProfile() {
  // Assumes your OpenAPI spec has operationId: "getUser"
  const { data: user } = api.useGetUser({
    params: { id: '123' }
  });
  
  // Assumes operationId: "updateUser"
  const { mutate: updateUser } = api.useUpdateUser();
  
  return <div>{user?.name}</div>;
}
```

### Type-Safe Error Handling

```typescript
try {
  const user = await client('GET /users/{id}', {
    params: { id: userId },
  });
  // Handle success
} catch (error) {
  if (error.response?.status === 404) {
    // User not found
  }
}
```

## How It Works

1. **OpenAPI Types**: The `openapi-typescript` tool generates TypeScript interfaces from your OpenAPI spec
2. **Type Magic**: Our client uses TypeScript's template literal types and conditional types to:
   - Parse the endpoint string (e.g., `'GET /users/{id}'`)
   - Extract the HTTP method and path
   - Look up the corresponding types from the OpenAPI definitions
   - Infer request parameters and response types
   - Provide VS Code autocomplete for all valid endpoints
3. **Runtime Fetching**: At runtime, the client constructs and executes the HTTP request

## VS Code Autocomplete

When you type endpoint strings, you get **full autocomplete** showing all available endpoints:

```typescript
// Start typing: client('
// VS Code shows:
//   ✓ 'GET /users'
//   ✓ 'POST /users' 
//   ✓ 'GET /users/{id}'
//   ✓ 'PUT /users/{id}'
//   ✓ 'DELETE /users/{id}'
//   ✓ 'GET /posts'

const user = await client('GET /users/{id}', {
  params: { id: '123' }  // ← TypeScript enforces required params
});
```

## Best Practices

1. **Keep OpenAPI Spec Updated**: Regenerate types whenever your API changes
   ```bash
   npx openapi-typescript https://api.example.com/openapi.json -o ./src/openapi-types.d.ts
   ```
2. **Use Specific Endpoints**: Let TypeScript autocomplete guide you to valid endpoints
3. **Handle Errors**: Always handle potential errors, especially for mutations
4. **Cache Wisely**: Configure React Query's `staleTime` and `cacheTime` appropriately
5. **Commit Generated Types**: Include the generated types file in your repository for team consistency

## TypeScript Support

This library requires TypeScript 4.5+ for full template literal type support.

## License

MIT

## Error Reference

The framework provides a comprehensive set of HTTP error classes:

| Error Class | Status Code | Usage |
|------------|-------------|--------|
| `BadRequestError` | 400 | Invalid request data |
| `UnauthorizedError` | 401 | Missing or invalid authentication |
| `PaymentRequiredError` | 402 | Payment required |
| `ForbiddenError` | 403 | Authenticated but not authorized |
| `NotFoundError` | 404 | Resource not found |
| `MethodNotAllowedError` | 405 | HTTP method not allowed |
| `ConflictError` | 409 | Resource conflict |
| `UnprocessableEntityError` | 422 | Validation errors |
| `TooManyRequestsError` | 429 | Rate limit exceeded |
| `InternalServerError` | 500 | Server errors |
| `BadGatewayError` | 502 | Gateway errors |
| `ServiceUnavailableError` | 503 | Service unavailable |

## Documentation

### Event Publishing

The framework includes powerful event publishing capabilities for building event-driven architectures:

- **[Events Quick Start](./docs/events-quick-start.md)** - Get started with event publishing in 5 minutes
- **[Complete Events Guide](./docs/events.md)** - Comprehensive documentation with examples and best practices

```typescript
const createUserEndpoint = e
  .publisher(eventPublisher)
  .post('/users')
  .body(userSchema)
  .event({
    type: 'user.created',
    payload: (response) => ({ userId: response.id, email: response.email }),
  })
  .handle(async ({ body }) => {
    const user = await createUser(body);
    return user; // Event published automatically after success
  });
```

## Best Practices

1. **Use structured services**: Keep endpoint handlers thin by moving logic to services
2. **Validate everything**: Use schemas for params, query, headers, body, and output
3. **Handle errors gracefully**: Use appropriate HTTP error classes
4. **Log strategically**: Use structured logging with context
5. **Group related endpoints**: Use route prefixes to organize your API
6. **Document with OpenAPI**: Add OpenAPI metadata to your endpoints
7. **Test thoroughly**: Use the testing utilities to test endpoints in isolation
8. **Publish events wisely**: Use events for cross-service communication and audit trails

## License

MIT