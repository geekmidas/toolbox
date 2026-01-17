# @geekmidas/toolbox Brownfield Architecture Document

## Introduction

This document captures the **CURRENT STATE** of the @geekmidas/toolbox codebase, including technical patterns, package relationships, and known considerations. It serves as a comprehensive reference for AI agents and developers working on enhancements.

### Document Scope

Comprehensive documentation of the entire monorepo system.

### Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-01-17 | 1.0 | Initial brownfield analysis | Mary (Business Analyst) |

---

## Quick Reference - Key Files and Entry Points

### Critical Files for Understanding the System

| Category | File | Purpose |
|----------|------|---------|
| **Main Config** | `gkm.config.ts` | CLI configuration (routes, providers, hooks) |
| **Build Config** | `tsdown.config.ts` | Multi-format ESM/CJS build |
| **Test Config** | `vitest.config.ts` | Per-package test projects |
| **Turbo Config** | `turbo.json` | Task orchestration |
| **TS Config** | `tsconfig.base.json` | Shared TypeScript settings |
| **Linting** | `biome.json` | Code style and formatting |
| **Workspace** | `pnpm-workspace.yaml` | Package definitions |

### Package Entry Points

```
packages/
├── constructs/src/index.ts      # Core framework exports
├── cli/src/index.ts             # CLI binary entry
├── telescope/src/index.ts       # Debugging dashboard
├── studio/src/index.ts          # Dev tools dashboard
├── auth/src/index.ts            # Authentication
├── events/src/index.ts          # Event messaging
├── services/src/index.ts        # Service discovery
├── envkit/src/index.ts          # Environment parsing
└── [package]/src/index.ts       # Standard pattern
```

---

## High Level Architecture

### Technical Summary

@geekmidas/toolbox is a **TypeScript monorepo** providing utilities and frameworks for building modern full-stack web applications. It follows a layered architecture with clear dependency boundaries.

### Tech Stack (from package.json)

| Category | Technology | Version | Notes |
|----------|------------|---------|-------|
| **Runtime** | Node.js | >=22.0.0 | Required minimum |
| **Language** | TypeScript | 5.8.2 | Strict mode enabled |
| **Package Manager** | pnpm | 10.25.0 | Workspace support |
| **Build Tool** | tsdown | 0.12.8 | ESM + CJS output |
| **Monorepo Tool** | Turbo | 2.5.4 | Task orchestration |
| **Web Framework** | Hono | 4.x | Lightweight, fast |
| **ORM** | Kysely | 0.28.x | Type-safe SQL |
| **Validation** | Zod | 4.1.x | StandardSchema compatible |
| **Testing** | Vitest | 3.2.4 | Vite-native testing |
| **Linting** | Biome | 2.3.11 | Format + lint |
| **React** | React | 19.x | UI components |

### Repository Structure

- **Type**: Monorepo (pnpm workspaces)
- **Package Manager**: pnpm 10.25.0
- **Total Packages**: 21 packages + 2 apps
- **Build Strategy**: Incremental via Turbo + tsdown

---

## Source Tree and Module Organization

### Project Structure (Actual)

```
toolbox/
├── packages/                    # 21 library packages
│   ├── audit/                   # Type-safe audit logging
│   ├── auth/                    # JWT/OIDC authentication
│   ├── cache/                   # Unified caching interface
│   ├── cli/                     # CLI tools (gkm command)
│   ├── client/                  # Type-safe API client
│   ├── cloud/                   # SST integration utilities
│   ├── constructs/              # Core framework (endpoints, functions, crons)
│   ├── db/                      # Kysely transaction utilities
│   ├── emailkit/                # React email templates
│   ├── envkit/                  # Environment configuration
│   ├── errors/                  # HTTP error classes
│   ├── events/                  # Unified event messaging
│   ├── logger/                  # Structured logging
│   ├── rate-limit/              # Rate limiting utilities
│   ├── schema/                  # StandardSchema utilities
│   ├── services/                # Service discovery & DI
│   ├── storage/                 # Cloud storage (S3)
│   ├── studio/                  # Dev tools dashboard
│   │   └── ui/                  # Studio React UI (nested workspace)
│   ├── telescope/               # Debugging dashboard
│   │   └── ui/                  # Telescope React UI (nested workspace)
│   ├── testkit/                 # Testing utilities
│   └── ui/                      # Shared React components
├── apps/
│   ├── docs/                    # VitePress documentation
│   └── example/                 # Reference implementation
├── scripts/                     # Build utilities
├── .github/workflows/           # CI/CD pipelines
├── turbo.json                   # Turbo task config
├── tsdown.config.ts             # Build config
├── vitest.config.ts             # Test config
├── biome.json                   # Linting config
└── pnpm-workspace.yaml          # Workspace definition
```

### Package Dependency Layers

```
LAYER 4: Applications & High-Level
├── cli (5 deps)           - Build, dev server, deployment
├── client (2 deps)        - API client + React Query
├── studio (2 deps)        - Dev dashboard + DB browser
└── telescope (1 dep)      - Debugging dashboard

LAYER 3: Framework Core
└── constructs (10 peer deps) - Endpoints, functions, crons, subscribers

LAYER 2: Middleware & Integration
├── audit (2 deps)         - Audit logging
├── auth (1 dep)           - Authentication
├── events (1 dep)         - Event messaging
├── rate-limit (3 deps)    - Rate limiting
├── services (2 deps)      - Service discovery
├── storage (1 dep)        - Cloud storage
└── testkit (2 deps)       - Testing utilities

LAYER 1: Foundation (0 internal deps)
├── cache                  - Caching interface
├── cloud                  - SST utilities
├── db                     - Database utilities
├── emailkit               - Email templates
├── envkit                 - Environment parsing
├── errors                 - HTTP errors
├── logger                 - Logging interface
├── schema                 - Schema utilities
└── ui                     - React components
```

---

## Key Packages - Detailed Architecture

### @geekmidas/constructs (Core Framework)

**Purpose**: Type-safe HTTP endpoints, serverless functions, scheduled tasks, and event subscribers.

**Key Exports**:
- `e` - EndpointFactory singleton for HTTP endpoints
- `f` - FunctionBuilder for serverless functions
- `cron` - CronBuilder for scheduled tasks
- `s` - SubscriberBuilder for event handlers

**Architecture Pattern**: Fluent builder with 18+ generic type parameters for complete type inference.

```typescript
// Endpoint example
const endpoint = e
  .post('/users')
  .body(z.object({ name: z.string() }))
  .output(z.object({ id: z.string() }))
  .services([dbService])
  .handle(async ({ body, services }) => {
    return { id: await services.database.insert(body) };
  });
```

**Key Features**:
- StandardSchema validation (Zod, Valibot)
- Service dependency injection
- Declarative audit logging with transaction support
- Rate limiting integration
- Row-level security (RLS) configuration
- OpenAPI generation
- Multiple framework adapters (Hono, AWS Lambda)

**File Locations**:
- Entry: `packages/constructs/src/index.ts`
- Endpoints: `packages/constructs/src/endpoints/`
- Adapters: `packages/constructs/src/adaptors/`
- Types: `packages/constructs/src/types.ts`

---

### @geekmidas/cli (Build & Development)

**Purpose**: CLI tools for development, building, and deployment.

**Commands**:
| Command | Purpose |
|---------|---------|
| `gkm dev` | Start dev server with hot-reload |
| `gkm build` | Compile for production |
| `gkm openapi` | Generate OpenAPI spec |
| `gkm generate:react-query` | Generate React Query hooks |
| `gkm init` | Scaffold new projects |
| `gkm deploy` | Deploy to providers |
| `gkm secrets:*` | Secrets management |
| `gkm docker` | Generate Docker files |

**Configuration** (`gkm.config.ts`):
```typescript
import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  routes: 'src/endpoints/**/*.ts',
  envParser: './src/config/env',
  logger: './src/config/logger',
  functions: 'src/functions/**/*.ts',
  crons: 'src/crons/**/*.ts',
  subscribers: 'src/subscribers/**/*.ts',
  telescope: { enabled: true, path: '/__telescope' },
  studio: { enabled: true, path: '/__studio' },
  hooks: { server: './src/config/hooks' },
  providers: {
    server: { enableOpenApi: true },
    aws: { apiGateway: { v2: true } }
  }
});
```

**Build Output**:
```
.gkm/
├── server/
│   ├── app.ts           # Hono app entry
│   ├── endpoints.ts     # All endpoint exports
│   └── dist/            # Production bundle
├── aws-apigatewayv2/
│   ├── routes/*.ts      # Per-endpoint handlers
│   └── manifest.json    # Route manifest
└── manifest.json        # Multi-provider summary
```

---

### @geekmidas/telescope (Debugging Dashboard)

**Purpose**: Laravel Telescope-style request recording, exception tracking, and log aggregation.

**Features**:
- HTTP request/response capture
- Exception tracking with stack traces
- Log aggregation with context
- Real-time WebSocket updates
- Metrics aggregation (p50, p95, p99)
- OpenTelemetry integration

**Storage Options**:
- `InMemoryStorage` - Development (default 1000 entries)
- `KyselyStorage` - Persistent database storage

**Integration**:
```typescript
import { Telescope, InMemoryStorage } from '@geekmidas/telescope';
import { createMiddleware, createUI } from '@geekmidas/telescope/server/hono';

const telescope = new Telescope({
  storage: new InMemoryStorage(),
  enabled: process.env.NODE_ENV === 'development',
});

app.use('*', createMiddleware(telescope));
app.route('/__telescope', createUI(telescope));
```

---

### @geekmidas/studio (Dev Tools Dashboard)

**Purpose**: Unified development dashboard with database browser and request monitoring.

**Features**:
- Wraps Telescope for request/exception monitoring
- Database schema introspection
- Cursor-based pagination for data browsing
- Filtering and sorting with multiple operators
- WebSocket real-time updates

**Components**:
- `Studio<DB>` - Main orchestrator
- `DataBrowser<DB>` - Kysely-based database introspection

---

### @geekmidas/auth (Authentication)

**Purpose**: JWT and OIDC authentication with multiple deployment targets.

**Exports**:
| Export | Purpose |
|--------|---------|
| `/jwt` | JwtVerifier with secret or JWKS |
| `/oidc` | OidcVerifier with auto-discovery |
| `/hono/jwt` | Hono middleware |
| `/lambda/jwt` | AWS Lambda authorizers |
| `/client` | Client-side token management |
| `/server` | Server-side token management |

**Usage**:
```typescript
// JWT verification
const verifier = new JwtVerifier({
  secret: process.env.JWT_SECRET,
  issuer: 'my-app',
});

// Hono middleware
app.use('/api/*', new JwtMiddleware({ config }).handler());
```

---

### @geekmidas/events (Event Messaging)

**Purpose**: Unified event publishing and subscribing across messaging backends.

**Supported Backends**:
- Basic (in-memory)
- RabbitMQ
- AWS SQS
- AWS SNS (with managed SQS subscriptions)

**Usage**:
```typescript
// Connection string factory
const publisher = await Publisher.fromConnectionString<Events>(
  'rabbitmq://localhost:5672?exchange=events'
);

const subscriber = await Subscriber.fromConnectionString<Events>(
  'rabbitmq://localhost:5672?exchange=events&queue=user-service'
);

await subscriber.subscribe(['user.created'], async (msg) => {
  console.log('User created:', msg.payload);
});
```

---

### @geekmidas/services (Dependency Injection)

**Purpose**: Singleton service registry with lazy initialization.

**Pattern**:
```typescript
const databaseService = {
  serviceName: 'database' as const,
  async register(envParser) {
    const config = envParser.create((get) => ({
      url: get('DATABASE_URL').string()
    })).parse();
    return new Database(config.url);
  }
} satisfies Service<'database', Database>;

// Registration
const discovery = ServiceDiscovery.getInstance(logger, envParser);
const services = await discovery.register([databaseService]);
```

---

### @geekmidas/envkit (Environment Parsing)

**Purpose**: Type-safe environment configuration with Zod validation.

**Features**:
- Proxy-based schema wrapping
- Accessed variable tracking
- Error enrichment with variable names
- Nested configuration support

**Usage**:
```typescript
const config = new EnvironmentParser(process.env)
  .create((get) => ({
    database: {
      url: get('DATABASE_URL').string().url(),
      pool: get('DB_POOL_SIZE').coerce.number().default(10),
    },
    port: get('PORT').coerce.number().default(3000),
  }))
  .parse();
```

---

### @geekmidas/testkit (Testing Utilities)

**Purpose**: Comprehensive testing library with factories, enhanced faker, and transaction isolation.

**Key Components**:
- `KyselyFactory` / `ObjectionFactory` - Database factories
- `faker` - Enhanced faker with timestamps, sequences, coordinates
- `VitestKyselyTransactionIsolator` - Test transaction rollback
- AWS mocking, logger mocking, Better Auth helpers

**Testing Philosophy**: "Integration over Unit" - prefer real dependencies over mocks.

---

## Data Models and APIs

### API Specifications

OpenAPI specifications are generated via `gkm openapi` command:
- Output: `.gkm/openapi.ts`
- React Query hooks: `gkm generate:react-query`

### Database Models

Each project defines its own models. Patterns:
- Kysely for type-safe SQL
- Factories in `@geekmidas/testkit` for test data
- Migrations via custom or Kysely migrator

---

## Technical Patterns and Conventions

### Service Pattern

Services follow a specific object literal pattern:

```typescript
const service = {
  serviceName: 'name' as const,  // MUST use 'as const'
  async register(envParser) {
    // Parse config and return instance
    return instance;
  }
} satisfies Service<'name', InstanceType>;
```

### Endpoint Factory Pattern

```typescript
const api = new EndpointFactory()
  .services([dbService])
  .authorizer('jwt')  // Default for all endpoints
  .database(dbService);

// Endpoints inherit factory defaults
export const getUsers = api.get('/users').handle(async () => []);
export const getHealth = api.get('/health')
  .authorizer('none')  // Override default
  .handle(async () => ({ status: 'ok' }));
```

### Error Handling

Use `@geekmidas/errors` HTTP error classes:

```typescript
import { createError } from '@geekmidas/errors';

throw createError.notFound('User not found');
throw createError.unauthorized('Invalid token');
throw createError.badRequest('Invalid input', { field: 'email' });
```

### Testing Pattern

```typescript
// Integration over Unit - use real dependencies
describe('CacheTokenStorage', () => {
  it('should store and retrieve token', async () => {
    const cache = new InMemoryCache<string>();  // Real cache
    const storage = new CacheTokenStorage(cache);

    await storage.setAccessToken('token');
    expect(await storage.getAccessToken()).toBe('token');
  });
});

// MSW for external APIs
const server = setupServer(
  http.post('/auth/refresh', () => HttpResponse.json({ token: 'new' }))
);
```

---

## Build and Development

### Local Development Setup

```bash
# Install dependencies
pnpm install

# Start dev server (single app)
pnpm gkm dev

# Start docs
pnpm docs:dev

# Build all packages
pnpm build

# Run tests
pnpm test        # Watch mode
pnpm test:once   # Single run with coverage
```

### Build Commands

| Command | Purpose |
|---------|---------|
| `pnpm build` | Build all packages (tsdown) |
| `pnpm ts:check` | TypeScript type checking |
| `pnpm lint` | Biome linting |
| `pnpm fmt` | Biome formatting |
| `pnpm test` | Vitest watch mode |
| `pnpm test:once` | Single test run with coverage |
| `pnpm bench` | Run benchmarks |

### Build Output

All packages output to `dist/`:
- `*.mjs` - ESM modules
- `*.cjs` - CommonJS modules
- `*.d.ts` - TypeScript declarations
- `*.d.ts.map` - Declaration source maps

---

## Testing

### Coverage Requirements

- Functions: 85%
- Branches: 85%
- Provider: V8

### Test File Patterns

- Unit tests: `*.spec.ts` or `*.test.ts`
- Integration tests: `__tests__/` directories
- Benchmarks: `__benchmarks__/**/*.bench.ts`

### Running Tests

```bash
pnpm test                    # Watch mode
pnpm test:once               # Single run
pnpm test path/to/file       # Specific file
pnpm bench                   # Benchmarks
```

---

## CI/CD

### GitHub Actions Workflows

**ci.yml** (on push/PR to main):
1. Install dependencies (frozen lockfile)
2. Build all packages
3. Run linting
4. Setup Docker Compose (for integration tests)
5. Run tests with coverage
6. Publish to npm (main branch only)

**benchmark.yml** (on push/PR to main):
1. Build packages
2. Run benchmarks
3. Upload results as artifacts

### Release Process

Uses Changesets for version management:

```bash
pnpm changeset          # Create changeset
pnpm version            # Bump versions
pnpm release            # Build + publish
```

---

## Technical Considerations

### Known Complexities

| Area | Issue | Impact |
|------|-------|--------|
| **Constructs Generics** | 18+ type parameters | Complex error messages |
| **CLI Provider System** | Two-tier legacy support | Code navigation difficulty |
| **CLI Handler Templates** | String concatenation | Hard to debug generated code |
| **Telescope Kysely** | Uses `as any` for dynamic tables | Type safety bypass |

### Architectural Decisions

1. **Peer Dependencies**: All major deps are optional peers for flexible composition
2. **Builder Pattern**: Fluent APIs guide developers and enable type narrowing
3. **Lazy Resolution**: Headers, cookies, services resolved on-demand
4. **Feature Detection**: Pre-computed at registration time for performance
5. **Service as Object Literals**: Enables `as const` for names, better tree-shaking

### Performance Characteristics

- **Build**: Incremental via Turbo, parallel package builds
- **Runtime**: Lazy parsing, service caching, feature detection
- **Testing**: Per-package projects, database transaction isolation

---

## Documentation Gaps

### Critical Gaps

| Package/Feature | Status |
|-----------------|--------|
| @geekmidas/studio | Not in VitePress docs |
| @geekmidas/ui | No documentation |
| CLI init/deploy/secrets commands | Undocumented |
| Deployment guide | Missing |

### Recommended Documentation Updates

1. Add Studio and UI to VitePress sidebar
2. Create CLI command reference
3. Create deployment guide (Docker, AWS, Dokploy)
4. Fix getting-started.md package names
5. Add advanced testing patterns guide

---

## Package Exports Reference

### @geekmidas/constructs
- `/` - Core types
- `/endpoints` - `e` endpoint builder
- `/functions` - `f` function builder
- `/crons` - `cron` scheduler
- `/subscribers` - `s` event subscriber
- `/hono` - Hono adapter
- `/aws` - AWS Lambda adapters
- `/testing` - Test utilities

### @geekmidas/cli
- `/` - CLI utilities
- `/config` - Configuration types
- `/openapi` - OpenAPI generation
- `/openapi-react-query` - React Query generation
- `/workspace` - Workspace utilities

### @geekmidas/telescope
- `/` - Core Telescope class
- `/server/hono` - Hono middleware and UI
- `/storage/memory` - InMemoryStorage
- `/logger/pino` - Pino transport
- `/logger/console` - TelescopeLogger

### @geekmidas/auth
- `/jwt` - JwtVerifier
- `/oidc` - OidcVerifier
- `/hono/jwt` - Hono middleware
- `/lambda/jwt` - Lambda authorizer
- `/client` - Client token management
- `/server` - Server token management

### @geekmidas/events
- `/` - Publisher/Subscriber factories
- `/basic` - In-memory implementation
- `/rabbitmq` - RabbitMQ implementation
- `/sqs` - AWS SQS implementation
- `/sns` - AWS SNS implementation

### @geekmidas/cache
- `/` - Cache interface
- `/memory` - InMemoryCache
- `/upstash` - Upstash Redis
- `/expo` - Expo Secure Store

---

## Appendix - Useful Commands

### Development

```bash
# Start dev server with Telescope
gkm dev --port 3000

# Generate OpenAPI spec
gkm openapi

# Generate React Query hooks
gkm generate:react-query --input .gkm/openapi.ts --output src/api/hooks.ts

# Build for production
gkm build --provider server
```

### Testing

```bash
# Run all tests
pnpm test:once

# Run specific package tests
pnpm -w test:once packages/constructs

# Run with UI
pnpm vitest --ui
```

### Deployment

```bash
# Initialize secrets for a stage
gkm secrets:init --stage production

# Deploy to Dokploy
gkm deploy --stage production

# Generate Docker files
gkm docker
```

---

## Summary

@geekmidas/toolbox is a **production-ready, well-architected TypeScript monorepo** that successfully balances:

- **Complete type safety** with fluent builder APIs
- **Flexible composition** via peer dependencies
- **Excellent DX** through CLI tooling and sensible defaults
- **Production capabilities** with multiple deployment targets

The main areas for documentation improvement are the Studio, UI, and Cloud packages, plus comprehensive guides for deployment and advanced testing patterns.
