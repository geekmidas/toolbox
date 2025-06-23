# @geekmidas/api

A comprehensive REST API framework for building type-safe HTTP endpoints with built-in support for AWS Lambda, validation, error handling, and service dependency injection.

## Features

- 🔒 **Type-safe endpoints**: Full TypeScript support with automatic type inference
- ✅ **Schema validation**: Uses StandardSchema specification (Zod, Valibot, etc.)
- 🚀 **Multiple runtime support**: AWS Lambda adapter included, extensible to other platforms
- 💉 **Dependency injection**: Built-in service discovery and registration
- 🔐 **Authorization**: Flexible authorization system with session management
- 📄 **OpenAPI generation**: Automatic OpenAPI schema generation
- 🚨 **Error handling**: Comprehensive HTTP error classes and handling
- 📊 **Structured logging**: Built-in logger with context propagation
- 🎯 **Zero config**: Works out of the box with sensible defaults

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
npm install @geekmidas/api @types/aws-lambda aws-lambda
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
import { AWSApiGatewayV1EndpointAdaptor } from '@geekmidas/api/aws-lambda';

const endpoint = e
  .get('/health')
  .output(z.object({ status: z.string() }))
  .handle(() => ({ status: 'ok' }));

const adapter = new AWSApiGatewayV1EndpointAdaptor(endpoint);
export const handler = adapter.handler;
```

## Core Concepts

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
import { HermodService } from '@geekmidas/api/server';

// Define a service
class DatabaseService extends HermodService<Database> {
  static readonly serviceName = 'Database';
  
  async register() {
    const db = new Database(process.env.DATABASE_URL);
    await db.connect();
    return db;
  }
  
  async cleanup(db: Database) {
    await db.disconnect();
  }
}

// Use in endpoints
const endpoint = e
  .services([DatabaseService])
  .post('/users')
  .body(userSchema)
  .handle(async ({ body, services }) => {
    const db = services.Database;
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

## Advanced Usage

### Custom Services

Create reusable services for your endpoints:

```typescript
// Cache service
class CacheService extends HermodService<Redis> {
  static readonly serviceName = 'Cache';
  
  async register() {
    const redis = new Redis(process.env.REDIS_URL);
    return redis;
  }
}

// Email service
class EmailService extends HermodService<EmailClient> {
  static readonly serviceName = 'Email';
  
  async register() {
    return new EmailClient({
      apiKey: process.env.SENDGRID_API_KEY
    });
  }
}

// Use multiple services
const endpoint = e
  .services([DatabaseService, CacheService, EmailService])
  .post('/users')
  .handle(async ({ body, services }) => {
    const { Database, Cache, Email } = services;
    
    // Check cache first
    const cached = await Cache.get(`user:${body.email}`);
    if (cached) return cached;
    
    // Create user
    const user = await Database.users.create(body);
    
    // Cache result
    await Cache.set(`user:${user.email}`, user, 3600);
    
    // Send welcome email
    await Email.send({
      to: user.email,
      subject: 'Welcome!',
      body: 'Thanks for signing up!'
    });
    
    return user;
  });
```

### OpenAPI Generation

Generate OpenAPI schemas from your endpoints:

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

The framework is designed to be easily testable:

```typescript
import { testEndpoint } from '@geekmidas/api/testing';

describe('User endpoint', () => {
  it('should return user by ID', async () => {
    const endpoint = e
      .get('/users/:id')
      .params(z.object({ id: z.string() }))
      .output(userSchema)
      .handle(async ({ params }) => {
        return { id: params.id, name: 'Test User' };
      });
    
    const response = await testEndpoint(endpoint, {
      params: { id: '123' }
    });
    
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: '123',
      name: 'Test User'
    });
  });
});
```

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

## Best Practices

1. **Use structured services**: Keep endpoint handlers thin by moving logic to services
2. **Validate everything**: Use schemas for params, query, headers, body, and output
3. **Handle errors gracefully**: Use appropriate HTTP error classes
4. **Log strategically**: Use structured logging with context
5. **Group related endpoints**: Use route prefixes to organize your API
6. **Document with OpenAPI**: Add OpenAPI metadata to your endpoints
7. **Test thoroughly**: Use the testing utilities to test endpoints in isolation

## License

MIT