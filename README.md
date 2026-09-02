# @geekmidas/toolbox

> A comprehensive TypeScript monorepo for building modern, type-safe web applications

[![Documentation](https://img.shields.io/badge/docs-geekmidas.github.io%2Ftoolbox-blue)](https://geekmidas.github.io/toolbox/)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)
[![pnpm Version](https://img.shields.io/badge/pnpm-10.13.1-blue)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.2-blue)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![CI](https://github.com/geekmidas/toolbox/actions/workflows/ci.yml/badge.svg)](https://github.com/geekmidas/toolbox/actions/workflows/ci.yml)
[![Docs](https://github.com/geekmidas/toolbox/actions/workflows/docs.yml/badge.svg)](https://github.com/geekmidas/toolbox/actions/workflows/docs.yml)

## 🚀 Overview

**@geekmidas/toolbox** is a collection of TypeScript utilities and frameworks designed to accelerate web application development. Built with modern tooling and best practices, it provides type-safe, developer-friendly APIs for common tasks.

> **Working on `main` (v10):** everything is a construct. A database, bucket,
> cache, or credential is one declaration in application code, and the local
> container, the deployed resource, the handler's environment, and its client
> all derive from it. See
> [Constructs Paradigm](./docs/design/constructs-paradigm.md).

### Key Features

- 🧱 **Declared infrastructure**: `new KyselyDatabase<Database, 'Orders'>('Orders')` is the whole declaration — the container, the roles, the schema, and `ORDERS_URL` all come from it
- 🔗 **One dependency edge**: `.dependsOn([uploads])` derives the handler's environment, its client, and exactly the cloud access it named
- 🔒 **Type Safety**: Full TypeScript support with runtime validation
- 📦 **Monorepo Structure**: Organized packages with clear separation of concerns
- 🚀 **Modern Tooling**: pnpm, Turbo, tsdown, Biome, and Vitest
- 🎯 **Zero Config**: Sensible defaults with extensive customization options
- 📖 **Well Documented**: Comprehensive docs with practical examples

## 📚 Documentation

**[geekmidas.github.io/toolbox](https://geekmidas.github.io/toolbox/)** — Full documentation with guides and API reference.

- [Getting Started](https://geekmidas.github.io/toolbox/guide/getting-started) — Create your first workspace
- [Workspaces](https://geekmidas.github.io/toolbox/guide/workspaces) — Multi-app configuration
- [Deployment](https://geekmidas.github.io/toolbox/guide/deployment) — Deploy to production
- [CLI Reference](https://geekmidas.github.io/toolbox/packages/cli) — All CLI commands
- [API Reference](https://geekmidas.github.io/toolbox/api/) — Package documentation

## 📦 Packages

### [@geekmidas/constructs](./packages/constructs)

A powerful framework for building type-safe HTTP endpoints, cloud functions, cron jobs, event subscribers — and the infrastructure they depend on.

- Declared resources: `KyselyDatabase`, `ObjectStorage`, `FileServer`, `Cache`, `Credential`, `Email`, `Topic`, `Queue`, `RestApi`, `StaticSite`
- `.dependsOn([…])` — the edge that derives environment, client, and cloud access
- Type-safe endpoint definitions with automatic type inference
- Schema validation using StandardSchema (Zod, Valibot, etc.)
- AWS Lambda support with API Gateway integration
- Built-in error handling and logging
- Automatic OpenAPI schema generation with reusable components
- Service-oriented architecture with dependency injection
- Advanced query parameter handling with nested object support
- Cloud functions, cron jobs, and event subscriber support

```typescript
import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';
import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod';

// One declaration: the Postgres container, its roles and schema, and ORDERS_URL.
export const database = new KyselyDatabase<Database, 'Orders'>('Orders');

const router = e.database(database);

const endpoint = router
  .get('/users/:id')
  .params(z.object({ id: z.string().uuid() }))
  .query(z.object({
    include: z.array(z.string()).optional(),
    'filter.status': z.enum(['active', 'inactive']).optional()
  }))
  .output(UserSchema)
  .handle(async ({ params, query, db }) => {
    return db
      .selectFrom('users')
      .where('id', '=', params.id)
      .selectAll()
      .executeTakeFirstOrThrow();
  });
```

[Learn more →](./packages/constructs/README.md)

### [@geekmidas/client](./packages/client)

Type-safe client utilities for consuming APIs with React Query integration.

- Type-safe API client with automatic type inference
- React Query hooks generation from OpenAPI specs
- Typed fetcher with error handling
- Automatic retries and request/response interceptors
- OpenAPI-based hooks for seamless integration

```typescript
import { createTypedQueryClient } from '@geekmidas/client';
import type { paths } from './openapi-types';

const api = createTypedQueryClient<paths>({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
});

// Use in React components
const { data, isLoading } = api.useQuery('GET /users/{id}', {
  params: { id: '123' }
});
```

[Learn more →](./packages/client/README.md)

### [@geekmidas/testkit](./packages/testkit)

A comprehensive testing utility library for creating type-safe test data with database factories.

- Factory pattern implementation for Kysely and Objection.js
- Type-safe builders with automatic schema inference
- Transaction-based test isolation
- Support for complex data relationships
- Built-in database migration utilities
- Batch operations and seeding support

```typescript
import { KyselyFactory } from '@geekmidas/testkit/kysely';

const userBuilder = KyselyFactory.createBuilder<Database, 'users'>({
  table: 'users',
  defaults: async () => ({
    name: 'John Doe',
    email: `user${Date.now()}@example.com`,
    createdAt: new Date(),
  }),
});

// In tests
const user = await factory.insert('user', { name: 'Jane Doe' });
const users = await factory.insertMany(5, 'user');
```

[Learn more →](./packages/testkit/README.md)

### [@geekmidas/envkit](./packages/envkit)

Type-safe environment configuration parser with Zod validation.

- Type-safe configuration with automatic inference
- Nested configuration structures
- Aggregated error reporting
- Path-based access using lodash utilities

```typescript
import { EnvironmentParser } from '@geekmidas/envkit';
import { z } from 'zod';

const config = new EnvironmentParser(process.env)
  .create((get) => ({
    port: get('PORT').string().transform(Number).default(3000),
    database: {
      url: get('DATABASE_URL').string().url()
    }
  }))
  .parse();
```

[Learn more →](./packages/envkit/README.md)

### [@geekmidas/db](./packages/db)

Database utilities for Kysely with flexible transaction management.

- Transaction helper that works with any DatabaseConnection type
- Handles Kysely, Transaction, and ControlledTransaction seamlessly
- Automatic transaction detection and reuse
- Type-safe database operations

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

[Learn more →](./packages/db/README.md)

### [@geekmidas/schema](./packages/schema)

Type utilities for StandardSchema-compatible validation libraries.

- Type inference helpers for StandardSchema
- ComposableStandardSchema type for nested schemas
- Works with any StandardSchema-compatible library (Zod, Valibot, etc.)
- Schema to JSON Schema conversion utilities
- Zero runtime overhead

```typescript
import type { InferStandardSchema } from '@geekmidas/schema';
import { z } from 'zod';

const userSchema = z.object({
  id: z.string(),
  email: z.string().email()
});

// Infer type from schema
type User = InferStandardSchema<typeof userSchema>;
```

[Learn more →](./packages/schema/README.md)

### [@geekmidas/logger](./packages/logger)

Simple structured logging library for Node.js and browsers.

- Standard logger interface with multiple log levels
- Structured logging with context objects
- Child logger support with context inheritance
- Automatic timestamp injection
- Console-based implementation

```typescript
import { ConsoleLogger } from '@geekmidas/logger/console';

const logger = new ConsoleLogger({ app: 'myApp', version: '1.0.0' });

// Structured logging
logger.info({ userId: 123, action: 'login' }, 'User logged in');

// Child logger with inherited context
const childLogger = logger.child({ module: 'auth' });
childLogger.debug({ action: 'validate' }, 'Validating token');
```

[Learn more →](./packages/logger/README.md)

### [@geekmidas/errors](./packages/errors)

HTTP error classes and error handling utilities.

- Comprehensive HTTP error classes (4xx and 5xx)
- Type-safe error factories with status codes
- Error serialization for API responses
- Integration with validation errors
- Stack trace support for debugging

```typescript
import { createError } from '@geekmidas/errors';

// Throw specific HTTP errors
throw createError.notFound('User not found');
throw createError.unauthorized('Invalid credentials');
throw createError.badRequest('Invalid input', { field: 'email' });
```

[Learn more →](./packages/errors/README.md)

### [@geekmidas/services](./packages/services)

Service discovery and dependency injection system — the escape hatch for
anything no construct describes. Infrastructure is a construct; a third-party
SDK or a client you assemble yourself is a `Service`.

- Singleton service registry with lazy initialization
- Type-safe service registration and retrieval
- Service caching and lifecycle management
- Integration with EnvironmentParser for configuration
- Support for async service initialization

```typescript
import type { Service } from '@geekmidas/services';
import { ServiceDiscovery } from '@geekmidas/services';

const databaseService = {
  serviceName: 'database' as const,
  async register(envParser) {
    const config = envParser.create((get) => ({
      url: get('DATABASE_URL').string()
    })).parse();

    const db = new Database(config.url);
    await db.connect();
    return db;
  }
} satisfies Service<'database', Database>;

const discovery = ServiceDiscovery.getInstance(logger, envParser);
const services = await discovery.register([databaseService]);
```

[Learn more →](./packages/services/README.md)

### [@geekmidas/events](./packages/events)

Unified event messaging library with support for multiple backends.

- Unified interface for publishing and subscribing across messaging systems
- Type-safe message types with full TypeScript inference
- Multiple backends: Basic (in-memory), RabbitMQ, AWS SQS, AWS SNS
- Connection string-based configuration
- SNS→SQS integration with automatic queue management
- Message filtering by event type

```typescript
import { Publisher, Subscriber } from '@geekmidas/events';
import type { PublishableMessage } from '@geekmidas/events';

type UserEvents =
  | PublishableMessage<'user.created', { userId: string }>
  | PublishableMessage<'user.updated', { userId: string }>;

const publisher = await Publisher.fromConnectionString<UserEvents>(
  'rabbitmq://localhost:5672?exchange=events'
);

const subscriber = await Subscriber.fromConnectionString<UserEvents>(
  'rabbitmq://localhost:5672?exchange=events&queue=user-service'
);

await subscriber.subscribe(['user.created'], async (message) => {
  console.log('User created:', message.payload.userId);
});
```

[Learn more →](./packages/events/README.md)

### [@geekmidas/rate-limit](./packages/rate-limit)

Rate limiting utilities with configurable windows and storage backends.

- Configurable rate limiting with time windows
- Multiple storage backends (memory, cache)
- IP-based and custom identifier support
- Sliding window algorithm
- Integration with @geekmidas/constructs endpoints

```typescript
import { rateLimit } from '@geekmidas/rate-limit';
import { InMemoryCache } from '@geekmidas/cache/memory';

const limiter = rateLimit({
  limit: 100,
  windowMs: 60000, // 1 minute
  cache: new InMemoryCache(),
});

// Use with endpoints
const endpoint = e
  .post('/api/messages')
  .rateLimit(limiter)
  .handle(async () => ({ success: true }));
```

[Learn more →](./packages/rate-limit/README.md)

### [@geekmidas/cache](./packages/cache)

Unified cache interface with multiple storage implementations.

- Consistent API across different storage backends
- In-memory, Upstash Redis, and Expo Secure Store implementations
- TTL support with automatic expiration
- Type-safe key-value operations
- React Native support via Expo Secure Store

```typescript
import { InMemoryCache } from '@geekmidas/cache/memory';
import { UpstashCache } from '@geekmidas/cache/upstash';

// Use the same API regardless of implementation
const cache = new InMemoryCache<User>();
await cache.set('user:123', { id: '123', name: 'John' }, { ttl: 3600 });
const user = await cache.get('user:123');
```

[Learn more →](./packages/cache/README.md)

### [@geekmidas/auth](./packages/auth)

Comprehensive JWT token management for client and server applications.

- Automatic token refresh with configurable strategies
- Multiple storage backends (memory, cache, custom)
- Type-safe token payloads
- Server-side token validation and generation
- OpenAuth integration support

```typescript
import { TokenClient } from '@geekmidas/auth/client';
import { CacheTokenStorage } from '@geekmidas/auth/cache';

const tokenClient = new TokenClient({
  storage: new CacheTokenStorage(cache),
  refreshEndpoint: '/auth/refresh',
  onTokensRefreshed: (tokens) => console.log('Tokens refreshed'),
});

// Automatic refresh when needed
const accessToken = await tokenClient.getAccessToken();
```

[Learn more →](./packages/auth/README.md)

### [@geekmidas/cli](./packages/cli)

Command-line tools for building and deploying API applications.

- Build AWS Lambda handlers from endpoint definitions
- Generate OpenAPI specifications
- Create React Query hooks from API definitions
- Multi-provider support (API Gateway v1/v2)
- Development server with hot reload

```bash
# Build Lambda handler
npx @geekmidas/cli build lambda --input ./src/api --output ./dist

# Generate OpenAPI spec
npx @geekmidas/cli generate openapi --input ./src/api --output ./openapi.json

# Start development server
npx @geekmidas/cli dev --input ./src/api --port 3000
```

[Learn more →](./packages/cli/README.md)

### [@geekmidas/storage](./packages/storage)

Cloud storage abstraction layer with provider-agnostic API.

- Unified interface for multiple storage providers
- AWS S3 implementation with presigned URLs
- File versioning support
- Presigned URL caching with `@geekmidas/cache`
- Type-safe file operations

```typescript
import { AmazonStorageClient } from '@geekmidas/storage/aws';
import { InMemoryCache } from '@geekmidas/cache/memory';

const storage = AmazonStorageClient.create({
  bucket: 'my-bucket',
  region: 'us-east-1',
  cache: new InMemoryCache(), // Optional: cache presigned URLs
});

// Upload file
await storage.upload('documents/report.pdf', fileBuffer, 'application/pdf');

// Get presigned URL for direct download (cached)
const url = await storage.getDownloadURL({ path: 'documents/report.pdf' }, 3600);
```

[Learn more →](./packages/storage/README.md)

### [@geekmidas/emailkit](./packages/emailkit)

Type-safe email sending with React template support.

- SMTP client with modern configuration
- React email template rendering
- Type-safe email composition
- Attachment support
- HTML and plain text variants

```typescript
import { EmailClient } from '@geekmidas/emailkit';
import { WelcomeEmail } from './templates';

const email = new EmailClient({
  host: 'smtp.example.com',
  port: 587,
  auth: { user: 'api@example.com', pass: 'password' },
});

await email.send({
  to: 'user@example.com',
  subject: 'Welcome!',
  react: <WelcomeEmail name="John" />,
});
```

[Learn more →](./packages/emailkit/README.md)

### [@geekmidas/audit](./packages/audit)

Type-safe audit logging with database integration.

- Type-safe audit actions with compile-time validation
- Transactional support for atomic database writes
- Pluggable storage backends (Kysely implementation included)
- Actor and metadata tracking
- Query and filtering capabilities

```typescript
import { DefaultAuditor, KyselyAuditStorage } from '@geekmidas/audit';
import type { AuditableAction } from '@geekmidas/audit';

type AppAuditAction =
  | AuditableAction<'user.created', { userId: string; email: string }>
  | AuditableAction<'order.placed', { orderId: string; total: number }>;

const storage = new KyselyAuditStorage({ db, tableName: 'audit_logs' });
const auditor = new DefaultAuditor<AppAuditAction>({
  actor: { id: 'user-123', type: 'user' },
  storage,
});

// Type-safe audit recording
auditor.audit('user.created', { userId: '789', email: 'test@example.com' });
await auditor.flush();
```

[Learn more →](./packages/audit/README.md)

### [@geekmidas/cloud](./packages/cloud)

Cloud infrastructure utilities with SST integration.

- SST resource utilities and helpers
- Cloud service abstractions
- Infrastructure configuration helpers

## 🛠️ Getting Started

### Prerequisites

- Node.js ≥ 22.0.0
- pnpm 10.13.1

### Installation

```bash
# Clone the repository
git clone https://github.com/geekmidas/toolbox.git
cd toolbox

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

### Development

```bash
# Run in development mode with hot reload
pnpm dev

# Type check all packages
pnpm typecheck

# Lint and format code
pnpm lint
pnpm format

# Run tests in watch mode
pnpm test:watch
```

## 📁 Project Structure

```
toolbox/
├── packages/
│   ├── audit/        # Type-safe audit logging with database integration
│   ├── auth/         # JWT token management
│   ├── cache/        # Unified cache interface
│   ├── cli/          # Command-line tools
│   ├── client/       # Type-safe API client with React Query
│   ├── cloud/        # Cloud services (SST integration)
│   ├── constructs/   # Endpoints, functions, crons, subscribers, and declared resources
│   ├── db/           # Database utilities for Kysely
│   ├── manifest/     # Declarations, naming, derivation — the build/run seam
│   ├── emailkit/     # Email sending utilities
│   ├── envkit/       # Environment configuration parser
│   ├── errors/       # HTTP error classes and utilities
│   ├── events/       # Event messaging library
│   ├── logger/       # Structured logging
│   ├── rate-limit/   # Rate limiting utilities
│   ├── schema/       # StandardSchema type utilities
│   ├── services/     # Service discovery and DI
│   ├── storage/      # Cloud storage abstraction
│   └── testkit/      # Testing utilities and database factories
├── apps/
│   ├── docs/         # Documentation site
│   └── example/      # Example API application
├── turbo.json        # Turbo configuration
├── pnpm-workspace.yaml
├── tsdown.config.ts  # Build configuration
├── vitest.config.ts  # Test configuration
├── biome.json        # Linting and formatting
├── CLAUDE.md         # AI assistant instructions
├── ARCHITECTURE.md   # System architecture
├── CONTRIBUTING.md   # Contribution guidelines
└── CHANGELOG.md      # Version history
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on:

- Code of Conduct
- Development workflow
- Coding standards
- Pull request process

## 📋 Roadmap

### Completed ✅
- [x] Core constructs package (@geekmidas/constructs)
- [x] Type-safe API client (@geekmidas/client)
- [x] CLI tools package (@geekmidas/cli)
- [x] Authentication helpers (@geekmidas/auth)
- [x] Cache abstraction layer (@geekmidas/cache)
- [x] Cloud storage utilities (@geekmidas/storage)
- [x] Email sending utilities (@geekmidas/emailkit)
- [x] Database utilities package (@geekmidas/db)
- [x] Schema utilities (@geekmidas/schema)
- [x] Structured logging (@geekmidas/logger)
- [x] HTTP errors (@geekmidas/errors)
- [x] Service discovery (@geekmidas/services)
- [x] Event messaging (@geekmidas/events)
- [x] Rate limiting (@geekmidas/rate-limit)
- [x] Testing utilities (@geekmidas/testkit)
- [x] Audit logging (@geekmidas/audit)
- [x] OpenAPI components support
- [x] Infinite query support for React Query
- [x] Nested query parameter handling
- [x] Expo Secure Cache implementation
- [x] Declarative audit logging in constructs

### In Progress 🚧
- [x] Constructs paradigm — thirteen declaration kinds, a construct for each one that needs it
- [x] Reconcile — local containers, databases, roles, and buckets derived from declarations
- [ ] AWS target: `rest-api` (twelve of thirteen kinds provision; nothing deployed end to end yet)
- [ ] Fullstack workspace on the constructs path (its auth app declares no half yet)
- [ ] Cloud services abstractions (@geekmidas/cloud)
- [ ] Documentation site improvements
- [ ] Comprehensive test coverage for all packages

### Planned 📅
- [ ] Additional validation adapters (ArkType, Typebox, etc.)
- [ ] GraphQL support in @geekmidas/constructs
- [ ] WebSocket support
- [ ] Enhanced middleware system
- [ ] Metrics and observability package
- [ ] Additional event backends (Kafka, Redis Streams)
- [ ] Distributed tracing support

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

Built with ❤️ by the GeekMidas team.

Special thanks to all contributors and the open-source community for the amazing tools that make this project possible.

---

<p align="center">
  <a href="https://geekmidas.github.io/toolbox/">Documentation</a> •
  <a href="https://github.com/geekmidas/toolbox">GitHub</a> •
  <a href="https://geekmidas.github.io/toolbox/guide/getting-started">Getting Started</a> •
  <a href="CONTRIBUTING.md">Contributing</a>
</p>
