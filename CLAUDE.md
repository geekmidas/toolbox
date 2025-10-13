# Claude AI Assistant Instructions for @geekmidas/toolbox

## Project Overview

This is a TypeScript monorepo containing utilities and frameworks for building modern web applications. The project is organized as a collection of packages under the `@geekmidas` namespace, each serving a specific purpose.

### Key Characteristics
- **Language**: TypeScript 5.8.2
- **Runtime**: Node.js ≥ 22.0.0
- **Package Manager**: pnpm 10.13.1
- **Build Tool**: tsdown (generates both ESM and CJS)
- **Code Style**: Biome (2-space indentation, single quotes, semicolons)
- **Testing**: Vitest
- **Monorepo Tool**: Turbo

## Architecture

### Package Structure
```
toolbox/
├── packages/
│   ├── api/          # REST API framework with AWS Lambda support
│   ├── auth/         # JWT authentication and token management
│   ├── cache/        # Unified caching interface with multiple backends
│   ├── cli/          # CLI tools for building and deployment
│   ├── cloud/        # Cloud infrastructure utilities (private)
│   ├── db/           # Database utilities for Kysely
│   ├── emailkit/     # Type-safe email client with React templates
│   ├── envkit/       # Environment configuration parser
│   ├── events/       # Unified event messaging library
│   ├── logger/       # Structured logging library
│   ├── schema/       # StandardSchema type utilities
│   ├── storage/      # Cloud storage abstraction (S3)
│   └── testkit/      # Testing utilities and database factories
├── apps/
│   └── docs/         # VitePress documentation site
├── test-cli/         # Test CLI application
├── turbo.json        # Turbo configuration
├── pnpm-workspace.yaml
├── tsdown.config.ts  # Build configuration
├── vitest.config.ts  # Test configuration
├── biome.json        # Linting and formatting
└── docker-compose.yml # Docker configuration for development
```

### Package Descriptions

#### @geekmidas/api
A comprehensive framework for building type-safe HTTP endpoints, cloud functions, scheduled tasks, and event subscribers.

**Key Features:**
- Fluent endpoint builder pattern using `e` export
- Cloud function builder using `f` export
- Scheduled task builder using `cron` export
- Event subscriber builder using `s` export (integrates with @geekmidas/events)
- Full TypeScript type inference
- StandardSchema validation (Zod, Valibot, etc.)
- AWS Lambda adapter support (API Gateway and direct Lambda)
- Service dependency injection system
- Built-in error handling with HTTP-specific error classes
- Session and authorization management
- Structured logging with context propagation
- Rate limiting with configurable windows and storage
- Hono framework adapter support
- OpenAPI components extraction

**Usage Pattern:**
```typescript
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

const endpoint = e
  .post('/users')
  .body(z.object({ name: z.string() }))
  .output(z.object({ id: z.string() }))
  .handle(async ({ body }) => ({ id: '123' }));

// With rate limiting
const rateLimited = e
  .post('/api/messages')
  .rateLimit({
    limit: 10,
    windowMs: 60000, // 1 minute
    cache: new InMemoryCache<RateLimitData>(),
  })
  .body(z.object({ content: z.string() }))
  .handle(async ({ body }) => ({ success: true }));
```

#### @geekmidas/testkit
Testing utilities focused on database factories and enhanced test data generation.

**Key Features:**
- Factory pattern for Kysely and Objection.js
- Type-safe builders with schema inference
- Transaction-based test isolation
- Batch operations support
- Database migration utilities
- Seed functions for complex scenarios
- Enhanced faker with custom utilities (timestamps, sequences, coordinates)
- Async wait utilities for testing
- Directory operation helpers for tests

**Usage Pattern:**
```typescript
import { KyselyFactory } from '@geekmidas/testkit/kysely';
import { faker } from '@geekmidas/testkit/faker';

// Database factories
const factory = new KyselyFactory(builders, seeds, db);
const user = await factory.insert('user', { name: 'Test User' });

// Enhanced faker utilities
const userData = {
  name: faker.person.fullName(),
  email: `user${faker.sequence('email')}@example.com`,
  ...faker.timestamps(),
  price: faker.price(),
};
```

#### @geekmidas/envkit
Type-safe environment configuration parser using Zod validation.

**Key Features:**
- Zod-based schema validation
- Nested configuration support
- Path-based access using lodash
- Aggregated error reporting
- Type inference from schema

**Usage Pattern:**
```typescript
import { EnvironmentParser } from '@geekmidas/envkit';

const config = new EnvironmentParser(process.env)
  .create((get) => ({
    port: get('PORT').string().transform(Number).default(3000),
    database: {
      url: get('DATABASE_URL').string().url()
    }
  }))
  .parse();
```

#### @geekmidas/auth
JWT-based authentication with token management and automatic refresh.

**Key Features:**
- Access/refresh token pattern with automatic refresh
- Multiple storage backends (localStorage, memory, cache)
- Type-safe token payloads with generics
- Built on @openauthjs/openauth
- Configurable expiration and refresh behavior

**Usage Pattern:**
```typescript
// Server-side token generation
import { TokenManager } from '@geekmidas/auth/server';

const tokenManager = new TokenManager({
  accessTokenSecret: process.env.ACCESS_TOKEN_SECRET,
  refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET,
  accessTokenExpiresIn: '15m',
  refreshTokenExpiresIn: '7d'
});

const tokens = await tokenManager.createTokens({ userId: '123' });

// Client-side token management
import { TokenClient, LocalStorageTokenStorage } from '@geekmidas/auth/client';

const client = new TokenClient({
  storage: new LocalStorageTokenStorage(),
  refreshEndpoint: '/api/auth/refresh',
  onTokenExpired: () => window.location.href = '/login'
});
```

#### @geekmidas/cache
Unified caching interface with multiple backend implementations.

**Key Features:**
- Type-safe cache with TypeScript generics
- Consistent async API across all backends
- TTL (time-to-live) support
- Implementations: InMemoryCache, UpstashCache, ExpoSecureCache
- Easy testing with swappable backends

**Usage Pattern:**
```typescript
import { InMemoryCache } from '@geekmidas/cache/memory';
import { UpstashCache } from '@geekmidas/cache/upstash';

// Development/testing
const cache = new InMemoryCache<User>();

// Production with Redis
const cache = new UpstashCache<User>({
  url: process.env.UPSTASH_REDIS_URL,
  token: process.env.UPSTASH_REDIS_TOKEN
});

// Usage is identical
await cache.set('user:123', userData, 3600); // 1 hour TTL
const user = await cache.get('user:123');
await cache.delete('user:123');
```

#### @geekmidas/cli
Command-line tools for building and deployment.

**Key Features:**
- Build command for generating Lambda handlers or server applications
- OpenAPI specification generation from endpoints
- React Query hooks generation from OpenAPI
- Auto-discovery of endpoints via glob patterns
- Environment and logger configuration

**Usage Pattern:**
```bash
# Install globally or use via npx
npm install -g @geekmidas/cli

# Generate AWS Lambda handlers
gkm build --provider aws-apigatewayv1 --source "./src/endpoints/**/*.ts"

# Generate server application
gkm build --provider server --port 3000

# Generate OpenAPI specification
gkm openapi --source "./src/endpoints/**/*.ts" --output api-docs.json

# Generate React Query hooks
gkm generate:react-query --input api-docs.json --output ./src/hooks
```

#### @geekmidas/storage
Cloud storage abstraction with S3 implementation.

**Key Features:**
- Presigned URL generation for secure uploads/downloads
- Direct file uploads with content type support
- File versioning and metadata
- Compatible with S3-compatible services
- Type-safe operations

**Usage Pattern:**
```typescript
import { AmazonStorageClient } from '@geekmidas/storage/aws';

const storage = AmazonStorageClient.create({
  bucket: process.env.S3_BUCKET,
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

// Upload file
await storage.upload('documents/report.pdf', fileBuffer, 'application/pdf');

// Get presigned download URL (expires in 1 hour)
const url = await storage.getDownloadURL({ 
  path: 'documents/report.pdf',
  expiresIn: 3600 
});

// Get presigned upload URL
const uploadUrl = await storage.getUploadURL({
  path: 'documents/new-file.pdf',
  contentType: 'application/pdf'
});
```

#### @geekmidas/emailkit
Type-safe email client with React template support.

**Key Features:**
- React-based email templates with full TypeScript support
- SMTP support via nodemailer
- Type-safe template names and props
- Attachment support
- Batch sending capabilities

**Usage Pattern:**
```typescript
import { createEmailClient } from '@geekmidas/emailkit';
import { WelcomeEmail, PasswordResetEmail } from './templates';

const templates = {
  welcome: WelcomeEmail,
  passwordReset: PasswordResetEmail
};

const client = createEmailClient({
  smtp: {
    host: process.env.SMTP_HOST,
    port: 587,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  },
  templates,
  defaults: { from: 'noreply@example.com' }
});

// Type-safe template sending
await client.sendTemplate('welcome', {
  to: 'user@example.com',
  subject: 'Welcome to our platform!',
  props: { 
    name: 'John Doe',
    confirmationUrl: 'https://example.com/confirm/123' 
  }
});
```

#### @geekmidas/events
Unified event messaging library with support for multiple backends.

**Key Features:**
- Unified interface for publishing and subscribing across messaging systems
- Type-safe message types with full TypeScript inference
- Multiple backends: Basic (in-memory), RabbitMQ, AWS SQS, AWS SNS
- Connection string-based configuration
- Factory pattern for publishers and subscribers
- SNS→SQS integration with automatic queue management
- Message filtering by event type

**Usage Pattern:**
```typescript
import { Publisher, Subscriber } from '@geekmidas/events';

// Define message types
type UserEvents =
  | PublishableMessage<'user.created', { userId: string }>
  | PublishableMessage<'user.updated', { userId: string }>;

// Create publisher from connection string
const publisher = await Publisher.fromConnectionString<UserEvents>(
  'rabbitmq://localhost:5672?exchange=events'
);

// Create subscriber
const subscriber = await Subscriber.fromConnectionString<UserEvents>(
  'rabbitmq://localhost:5672?exchange=events&queue=user-service'
);

// Subscribe to events
await subscriber.subscribe(['user.created'], async (message) => {
  console.log('User created:', message.payload.userId);
});

// Publish events
await publisher.publish([
  { type: 'user.created', payload: { userId: '123' } }
]);
```

#### @geekmidas/logger
Simple structured logging library for Node.js and browsers.

**Key Features:**
- Standard logger interface with multiple log levels
- Structured logging with context objects
- Child logger support with context inheritance
- Automatic timestamp injection
- Console-based implementation

**Usage Pattern:**
```typescript
import { ConsoleLogger } from '@geekmidas/logger/console';

const logger = new ConsoleLogger({ app: 'myApp', version: '1.0.0' });

// Structured logging
logger.info({ userId: 123, action: 'login' }, 'User logged in');

// Simple logging
logger.info('Application started');

// Child logger with inherited context
const childLogger = logger.child({ module: 'auth' });
childLogger.debug({ action: 'validate' }, 'Validating token');
```

#### @geekmidas/schema
Type utilities for StandardSchema-compatible validation libraries.

**Key Features:**
- Type inference helpers for StandardSchema
- ComposableStandardSchema type for nested schemas
- Works with any StandardSchema-compatible library (Zod, Valibot, etc.)
- Zero runtime overhead

**Usage Pattern:**
```typescript
import type { InferStandardSchema, ComposableStandardSchema } from '@geekmidas/schema';
import { z } from 'zod';

const userSchema = z.object({
  id: z.string(),
  email: z.string().email()
});

// Infer type from schema
type User = InferStandardSchema<typeof userSchema>;

// Composable schemas
const schemas: ComposableStandardSchema = {
  user: userSchema,
  post: z.object({ title: z.string() })
};
```

#### @geekmidas/db
Database utilities for Kysely with flexible transaction management.

**Key Features:**
- Transaction helper that works with any DatabaseConnection type
- Handles Kysely, Transaction, and ControlledTransaction seamlessly
- Automatic transaction detection and reuse
- Type-safe database operations

**Usage Pattern:**
```typescript
import { withTransaction } from '@geekmidas/db/kysely';
import type { DatabaseConnection } from '@geekmidas/db/kysely';

async function createUser(
  db: DatabaseConnection<Database>,
  data: UserData
) {
  return withTransaction(db, async (trx) => {
    const user = await trx
      .insertInto('users')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();

    await trx
      .insertInto('audit_log')
      .values({ userId: user.id, action: 'created' })
      .execute();

    return user;
  });
}
```

## Code Style Guidelines

### TypeScript
- Use TypeScript for all code
- Prefer type inference over explicit types where possible
- Use interfaces for object shapes, types for unions/aliases
- Enable strict mode TypeScript features

### Formatting (Biome)
- **Indentation**: 2 spaces
- **Quotes**: Single quotes for strings
- **Semicolons**: Always use semicolons
- **Trailing commas**: Always include
- **Line width**: 80 characters
- **Import organization**: Automatic via Biome
- **Arrow functions**: Always use parentheses

### Naming Conventions
- **Files**: camelCase for regular files, PascalCase for classes/components
- **Classes**: PascalCase
- **Functions/Variables**: camelCase
- **Constants**: UPPER_SNAKE_CASE for true constants
- **Types/Interfaces**: PascalCase

### Import Style
- Use `import type` for type-only imports
- Group imports logically (external deps, internal deps, types)
- No unused imports (enforced by Biome)

## Development Patterns

### Error Handling
- Use specific HTTP error classes from @geekmidas/api/errors
- Throw errors early with descriptive messages
- Use error factories like `createError.forbidden()`

### Service Pattern
- Define services as object literals with `Service<TName, TInstance>` interface
- Define `serviceName` as object property with `as const` assertion
- Implement `register(envParser)` method that receives EnvironmentParser
- Use `satisfies Service<'name', Type>` for type safety
- Pass service objects directly (not class instances) to `.services([])`

Example:
```typescript
import type { Service } from '@geekmidas/api/services';
import type { EnvironmentParser } from '@geekmidas/envkit';

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

// Use in endpoints/functions
const endpoint = e
  .services([databaseService])
  .handle(async ({ services }) => {
    const db = services.database;
    // Use database
  });
```

### Testing
- Use factories from @geekmidas/testkit for test data
- Wrap tests in database transactions for isolation
- Create minimal data needed for each test
- Use seeds for complex test scenarios

## Test Structure

### File Organization
- Test files live alongside source files with `.spec.ts` or `.test.ts` suffix
- Integration tests in `__tests__/` directories
- Mock data and fixtures in `__fixtures__/` directories
- Test utilities in `__helpers__/` directories

### Test File Naming
- Unit tests: `ComponentName.spec.ts` or `functionName.test.ts`
- Integration tests: `feature.integration.spec.ts`
- E2E tests: `scenario.e2e.ts`

### Test Structure Pattern
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('ComponentName', () => {
  // Setup shared test data
  let testData: TestType;

  beforeEach(() => {
    // Initialize test data
    testData = createTestData();
  });

  afterEach(() => {
    // Cleanup if needed
  });

  describe('methodName', () => {
    it('should handle normal case', () => {
      // Arrange
      const input = 'test';
      
      // Act
      const result = methodName(input);
      
      // Assert
      expect(result).toBe('expected');
    });

    it('should handle edge case', () => {
      // Test edge cases
    });

    it('should throw error for invalid input', () => {
      // Test error scenarios
      expect(() => methodName(null)).toThrow('Expected error');
    });
  });
});
```

### Testing Patterns

#### Unit Tests
- Test individual functions/methods in isolation
- Mock external dependencies
- Focus on input/output relationships
- Test edge cases and error scenarios

#### Integration Tests
- Test multiple components working together
- Use real or in-memory databases
- Test API endpoints with supertest
- Verify data flow through system

#### Database Tests
```typescript
import { createTestDatabase } from '@geekmidas/testkit';

describe('UserRepository', () => {
  const { db, cleanup } = createTestDatabase();
  
  afterEach(async () => {
    await cleanup();
  });

  it('should create user', async () => {
    const user = await db.insert('users').values({ name: 'Test' });
    expect(user.id).toBeDefined();
  });
});
```

#### API Endpoint Tests
```typescript
import { createTestApp } from '@geekmidas/api/testing';
import { endpoint } from './endpoint';

describe('POST /users', () => {
  const app = createTestApp([endpoint]);

  it('should create user', async () => {
    const response = await app
      .post('/users')
      .send({ name: 'Test User' })
      .expect(201);

    expect(response.body).toMatchObject({
      id: expect.any(String),
      name: 'Test User',
    });
  });
});
```

### Testing Philosophy

The project follows a **"Integration over Unit"** testing philosophy that prioritizes real behavior verification over mocked implementations:

#### Core Principles

1. **Integration over Unit**: Prefer tests that verify complete integration between components rather than isolated unit tests with heavy mocking
2. **Behavior over Implementation**: Test what the code actually does, not how it calls underlying methods
3. **Real Dependencies over Mocks**: Use actual implementations (in-memory databases, real cache instances) instead of mocks when possible
4. **Comprehensive Coverage**: Test both happy path and edge cases with real data flow

#### When to Use Real Dependencies

- **Cache Operations**: Use `InMemoryCache` instead of mocking cache interface
- **Database Operations**: Use in-memory or test databases with real schemas
- **Internal Services**: Test actual service interactions rather than mocked calls
- **Data Transformations**: Test real data processing pipelines

#### When to Use MSW (Mock Service Worker)

- **External HTTP APIs**: Use MSW to intercept and mock network requests
- **Third-party Services**: Mock external service responses with realistic data
- **API Integration Tests**: Test complete HTTP request/response cycles

#### When to Use Traditional Mocks

- **File System Operations**: Mock file operations for consistency
- **Time-dependent Operations**: Mock `Date.now()` for predictable tests
- **Environment Variables**: Mock process.env for different configurations

#### Example: Real vs Mocked Testing

```typescript
// ❌ Avoid: Heavy mocking of internal dependencies
describe('CacheTokenStorage', () => {
  it('should store token', async () => {
    const mockCache = { set: vi.fn() };
    const storage = new CacheTokenStorage(mockCache);
    
    await storage.setAccessToken('token');
    
    expect(mockCache.set).toHaveBeenCalledWith('access_token', 'token');
  });
});

// ✅ Prefer: Real dependencies with actual behavior
describe('CacheTokenStorage', () => {
  it('should store and retrieve token', async () => {
    const cache = new InMemoryCache<string>();
    const storage = new CacheTokenStorage(cache);
    
    await storage.setAccessToken('token');
    const result = await storage.getAccessToken();
    
    expect(result).toBe('token');
  });
});
```

#### Example: MSW for External API Testing

```typescript
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { beforeAll, afterEach, afterAll } from 'vitest';

// Setup MSW server
const server = setupServer(
  http.post('/auth/refresh', () => {
    return HttpResponse.json({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    });
  }),
);

describe('TokenClient API Integration', () => {
  beforeAll(() => server.listen());
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('should refresh tokens via API', async () => {
    const storage = new MemoryTokenStorage();
    const client = new TokenClient({
      storage,
      refreshEndpoint: '/auth/refresh',
    });
    
    // Set up initial state
    await storage.setRefreshToken('valid-refresh-token');
    
    // Test actual HTTP request/response cycle
    const success = await client.refreshTokens();
    
    expect(success).toBe(true);
    expect(await storage.getAccessToken()).toBe('new-access-token');
    expect(await storage.getRefreshToken()).toBe('new-refresh-token');
  });

  it('should handle API errors gracefully', async () => {
    server.use(
      http.post('/auth/refresh', () => {
        return new HttpResponse(null, { status: 401 });
      }),
    );

    const storage = new MemoryTokenStorage();
    const client = new TokenClient({
      storage,
      refreshEndpoint: '/auth/refresh',
    });
    
    await storage.setRefreshToken('invalid-refresh-token');
    
    const success = await client.refreshTokens();
    
    expect(success).toBe(false);
    expect(await storage.getAccessToken()).toBeNull();
    expect(await storage.getRefreshToken()).toBeNull();
  });
});
```

#### Benefits of This Approach

- **Higher Confidence**: Tests verify actual behavior, not mocked behavior
- **Refactoring Safety**: Tests remain valid when internal implementation changes
- **Integration Issues**: Catches problems at component boundaries
- **Real Performance**: Tests reflect actual runtime performance characteristics
- **Realistic Network Testing**: MSW provides realistic HTTP request/response cycles
- **Network Error Handling**: MSW enables testing of network failures and edge cases
- **API Contract Testing**: Tests verify actual API integration without external dependencies

### Mocking Guidelines
- Use vitest's built-in mocking utilities
- Create type-safe mocks with `vi.fn<T>()`
- Mock at the boundary (external services, databases)
- Avoid mocking internal implementation details

### Test Coverage
- Aim for 80%+ coverage for critical paths
- Focus on behavior coverage, not line coverage
- Test public APIs thoroughly
- Don't test implementation details

### Performance Testing
```typescript
import { bench, describe } from 'vitest';

describe('performance', () => {
  bench('should handle large datasets', () => {
    processLargeDataset(testData);
  });
});
```

### Snapshot Testing
- Use for complex object structures
- Store snapshots in `__snapshots__/` directories
- Review snapshot changes carefully
- Update snapshots with `pnpm test -u`

### Test Commands
```bash
pnpm test                 # Run tests in watch mode
pnpm test:once           # Run tests once
pnpm test:coverage       # Generate coverage report
pnpm test:ui             # Open Vitest UI
pnpm test path/to/file   # Test specific file
```

### Configuration
- Parse all environment variables at startup
- Use @geekmidas/envkit for type-safe parsing
- Export parsed config as singleton
- Provide sensible defaults

## Documentation Site

The project includes a VitePress-based documentation site located in `apps/docs/`. This provides:
- Interactive API documentation
- Package guides and examples
- Architecture overview
- Contributing guidelines

Run the documentation locally:
```bash
cd apps/docs
pnpm dev  # Start development server on http://localhost:5173
```

## Common Tasks

### Adding a New Package
1. Create new directory under `packages/`
2. Add package.json with proper naming (@geekmidas/package-name)
3. Create src/index.ts as main entry point
4. Update root tsdown.config.ts if needed

### Building
```bash
pnpm build  # Build all packages
```

### Testing
```bash
pnpm test       # Run tests in watch mode
pnpm test:once  # Run tests once
```

### Code Quality
```bash
pnpm lint  # Check code with Biome
pnpm fmt   # Format code with Biome
```

## Key Principles

1. **Type Safety First**: Leverage TypeScript's type system fully
2. **Developer Experience**: Provide intuitive, well-documented APIs
3. **Zero Config**: Work out of the box with sensible defaults
4. **Composability**: Build small, focused utilities that work together
5. **Testing**: Make code easy to test with proper abstractions

## Package Exports

Each package uses subpath exports for better tree-shaking:

### @geekmidas/api
- `/server` - Server-side utilities and endpoint builder (`e` export)
- `/client` - Client-side typed fetcher
- `/errors` - HTTP error classes
- `/services` - Service base classes
- `/function` - Cloud function builder (`f` export)
- `/cron` - Scheduled function builder (`cron` export)
- `/subscriber` - Event subscriber builder (`s` export, uses @geekmidas/events)
- `/constructs` - All constructs (Function, Cron, Subscriber)
- `/aws-apigateway` - AWS API Gateway adapters (v1 and v2)
- `/aws-lambda` - AWS Lambda function adaptors
- `/hono` - Hono framework adapter
- `/testing` - Testing utilities

### @geekmidas/auth
- `/` - Core interfaces and types
- `/server` - Server-side token management
- `/client` - Client-side token management

### @geekmidas/cache
- `/` - Core cache interface
- `/memory` - In-memory cache implementation
- `/upstash` - Upstash Redis cache
- `/expo` - Expo Secure Store cache

### @geekmidas/cli
- Binary `gkm` - Command line interface for builds and code generation

### @geekmidas/db
- `/kysely` - Kysely transaction utilities

### @geekmidas/emailkit
- Main export only - Email client factory

### @geekmidas/envkit
- Main export only - Environment parser

### @geekmidas/events
- `/` - Core interfaces and factory functions
- `/basic` - Basic (in-memory) implementation
- `/rabbitmq` - RabbitMQ implementation
- `/sqs` - AWS SQS implementation
- `/sns` - AWS SNS implementation with managed queues

### @geekmidas/logger
- Main export only - Logger interface and ConsoleLogger

### @geekmidas/schema
- Main export only - StandardSchema type utilities

### @geekmidas/storage
- `/` - Core storage interface
- `/aws` - AWS S3 implementation

### @geekmidas/testkit
- `/kysely` - Kysely database factories
- `/objection` - Objection.js factories
- `/faker` - Enhanced faker with custom utilities (timestamps, sequences, etc.)
- `/timer` - Async wait utilities
- `/os` - OS test utilities (directory operations)

## Important Notes

- Always check existing patterns in the codebase before implementing new features
- Use the builder pattern for fluent APIs (see api package)
- Prefer composition over inheritance
- Keep external dependencies minimal
- Document complex logic with inline comments
- Write comprehensive README files for each package

## CI/CD

The project uses GitHub Actions for:
- CI workflow for testing and type checking
- Publish workflow for npm releases
- Changesets for version management

When making changes, ensure all tests pass and types are correct before committing.