# @geekmidas/toolbox

> A comprehensive TypeScript monorepo for building modern, type-safe web applications

[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)
[![pnpm Version](https://img.shields.io/badge/pnpm-10.13.1-blue)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.2-blue)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![CI](https://github.com/geekmidas/toolbox/actions/workflows/ci.yml/badge.svg)](https://github.com/geekmidas/toolbox/actions/workflows/ci.yml)
[![Publish](https://github.com/geekmidas/toolbox/actions/workflows/publish.yml/badge.svg)](https://github.com/geekmidas/toolbox/actions/workflows/publish.yml)

## 🚀 Overview

**@geekmidas/toolbox** is a collection of TypeScript utilities and frameworks designed to accelerate web application development. Built with modern tooling and best practices, it provides type-safe, developer-friendly APIs for common tasks.

### Key Features

- 🔒 **Type Safety**: Full TypeScript support with runtime validation
- 📦 **Monorepo Structure**: Organized packages with clear separation of concerns
- 🚀 **Modern Tooling**: pnpm, Turbo, tsdown, Biome, and Vitest
- 🎯 **Zero Config**: Sensible defaults with extensive customization options
- 📖 **Well Documented**: Comprehensive docs with practical examples

## 📦 Packages

### [@geekmidas/api](./packages/api)

A powerful REST API framework for building type-safe HTTP endpoints.

- Type-safe endpoint definitions with automatic type inference
- Schema validation using StandardSchema (Zod, Valibot, etc.)
- AWS Lambda support with API Gateway integration
- Built-in error handling and logging
- Automatic OpenAPI schema generation with reusable components
- Service-oriented architecture with dependency injection
- Advanced query parameter handling with nested object support
- React Query integration with infinite query support

```typescript
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

const endpoint = e
  .get('/users/:id')
  .params(z.object({ id: z.string().uuid() }))
  .query(z.object({ 
    include: z.array(z.string()).optional(),
    'filter.status': z.enum(['active', 'inactive']).optional() 
  }))
  .output(UserSchema)
  .handle(async ({ params, query }) => {
    return getUserById(params.id, query);
  });
```

[Learn more →](./packages/api/README.md)

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
- File versioning and metadata support
- Stream-based uploads and downloads
- Type-safe file operations

```typescript
import { S3Storage } from '@geekmidas/storage/s3';

const storage = new S3Storage({
  bucket: 'my-bucket',
  region: 'us-east-1',
});

// Upload with metadata
const result = await storage.upload({
  key: 'documents/report.pdf',
  body: fileBuffer,
  metadata: { userId: '123' },
});

// Get presigned URL for direct download
const url = await storage.getPresignedUrl({
  key: 'documents/report.pdf',
  expiresIn: 3600,
});
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

### [@geekmidas/cloud](./packages/cloud) _(Coming Soon)_

Cloud service abstractions for common cloud providers.

- Unified interface for AWS, Azure, and Google Cloud services
- Service discovery and configuration
- Health checks and monitoring
- Serverless function deployments
- Queue and messaging abstractions

_This package is currently in development and will be available in a future release._

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
│   ├── api/          # REST API framework
│   ├── auth/         # JWT token management
│   ├── cache/        # Unified cache interface
│   ├── cli/          # Command-line tools
│   ├── cloud/        # Cloud services (in development)
│   ├── emailkit/     # Email sending utilities
│   ├── envkit/       # Environment configuration parser
│   ├── storage/      # Cloud storage abstraction
│   └── testkit/      # Testing utilities and database factories
├── apps/
│   └── docs/         # Documentation site
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
- [x] CLI tools package (@geekmidas/cli)
- [x] Authentication helpers (@geekmidas/auth)
- [x] Cache abstraction layer (@geekmidas/cache)
- [x] Cloud storage utilities (@geekmidas/storage)
- [x] Email sending utilities (@geekmidas/emailkit)
- [x] OpenAPI components support (@geekmidas/api)
- [x] Infinite query support for React Query (@geekmidas/api)
- [x] Nested query parameter handling (@geekmidas/api)
- [x] Expo Secure Cache implementation (@geekmidas/cache)

### In Progress 🚧
- [ ] Cloud services abstractions (@geekmidas/cloud)
- [ ] Documentation site improvements

### Planned 📅
- [ ] Additional validation adapters for @geekmidas/api
- [ ] GraphQL support in @geekmidas/api
- [ ] Database utilities package (@geekmidas/db)
- [ ] WebSocket support in @geekmidas/api
- [ ] Middleware system for @geekmidas/api
- [ ] Rate limiting enhancements
- [ ] Metrics and observability package

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

Built with ❤️ by the GeekMidas team.

Special thanks to all contributors and the open-source community for the amazing tools that make this project possible.

---

<p align="center">
  <a href="https://github.com/geekmidas/toolbox">GitHub</a> •
  <a href="./packages/api">API</a> •
  <a href="./packages/auth">Auth</a> •
  <a href="./packages/cache">Cache</a> •
  <a href="./packages/cli">CLI</a> •
  <a href="./packages/storage">Storage</a> •
  <a href="./packages/testkit">TestKit</a> •
  <a href="./packages/envkit">EnvKit</a> •
  <a href="./packages/emailkit">EmailKit</a> •
  <a href="CONTRIBUTING.md">Contributing</a>
</p>
