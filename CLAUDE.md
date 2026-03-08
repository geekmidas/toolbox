# @geekmidas/toolbox

TypeScript monorepo for building modern web applications. Packages are under the `@geekmidas` namespace.

## Stack

- **TypeScript** 5.8.2, **Node.js** ≥ 22.0.0
- **pnpm** 10.13.1 (package manager), **Turbo** (monorepo)
- **tsdown** (build, generates ESM + CJS), **Vitest** (testing)
- **Biome** (lint + format), **Hono** (HTTP framework)

## Structure

```
toolbox/
├── packages/
│   ├── audit/        # Type-safe audit logging
│   ├── auth/         # JWT/OIDC authentication
│   ├── cache/        # Caching (memory, Upstash, Expo)
│   ├── cli/          # CLI tools (gkm command)
│   ├── client/       # API client + React Query
│   ├── cloud/        # SST integration
│   ├── constructs/   # Endpoints, functions, crons, subscribers
│   ├── db/           # Kysely utilities
│   ├── emailkit/     # Email with React templates
│   ├── envkit/       # Environment config parser
│   ├── errors/       # HTTP error classes
│   ├── events/       # Event messaging (pgboss, SNS, RabbitMQ)
│   ├── logger/       # Structured logging
│   ├── rate-limit/   # Rate limiting
│   ├── schema/       # StandardSchema utilities
│   ├── services/     # Service discovery / DI
│   ├── storage/      # S3 abstraction
│   ├── studio/       # Dev dashboard + DB browser
│   ├── telescope/    # Request/exception monitoring
│   ├── testkit/      # Test factories + utilities
│   └── ui/           # React components (shadcn/ui)
├── apps/
│   ├── docs/         # VitePress documentation
│   └── example/      # Example API
```

## Code Style (Biome)

- 2-space indentation, single quotes, semicolons, trailing commas
- 80 char line width, arrow functions always have parens
- `import type` for type-only imports
- Files: camelCase. Classes/Types/Interfaces: PascalCase. Constants: UPPER_SNAKE_CASE.

## Key Patterns

### Endpoint Builder

```typescript
import { e } from '@geekmidas/constructs/endpoints';

const endpoint = e
  .post('/users')
  .body(z.object({ name: z.string() }))
  .output(z.object({ id: z.string() }))
  .handle(async ({ body }) => ({ id: '123' }));
```

### Service Pattern

```typescript
import type { Service } from '@geekmidas/services';

const databaseService = {
  serviceName: 'database' as const,
  async register(envParser) {
    const config = envParser.create((get) => ({
      url: get('DATABASE_URL').string()
    })).parse();
    return new Database(config.url);
  }
} satisfies Service<'database', Database>;
```

### Environment Config

```typescript
import { EnvironmentParser } from '@geekmidas/envkit';
import { Credentials } from '@geekmidas/envkit/credentials';

const config = new EnvironmentParser({...process.env, ...Credentials})
  .create((get) => ({
    port: get('PORT').string().transform(Number).default(3000),
    database: { url: get('DATABASE_URL').string().url() },
  }))
  .parse();
```

### Credentials (CJS/ESM safe)

`Credentials` from `@geekmidas/envkit/credentials` resolves via:
1. `globalThis.__gkm_credentials__` (set by `gkm dev`/`gkm exec` preload)
2. Build-time decryption via `GKM_MASTER_KEY` (AES-256-GCM)
3. Empty object fallback

This uses `globalThis` instead of mutating the export to survive CJS/ESM module duplication.

### Events Backend

Configured via `services.events` in workspace config: `'pgboss'` | `'sns'` | `'rabbitmq'`

- **pgboss**: Reuses PostgreSQL (dedicated user/schema). NOT a `ComposeServiceName` — uses separate `PGBOSS_DEFAULTS`.
- **sns**: Adds LocalStack container. Access keys must be `LSIA`-prefixed.
- **rabbitmq**: Adds RabbitMQ container.

All generate `EVENT_PUBLISHER_CONNECTION_STRING` and `EVENT_SUBSCRIBER_CONNECTION_STRING`.

## Testing

### Philosophy

- **Integration over unit**: prefer real dependencies (InMemoryCache, real DB) over mocks
- **MSW** for external HTTP APIs; traditional mocks only for filesystem, time, env vars
- **Behavior over implementation**: test what code does, not how it calls things

### Structure

- Test files: `.spec.ts` or `.test.ts` alongside source
- Integration tests in `__tests__/` directories
- Fixtures in `__fixtures__/`, helpers in `__helpers__/`

### Commands

```bash
pnpm test              # Watch mode
pnpm test:once         # Run once with coverage
```

Vitest root config uses `projects: ['packages/*']`. Each package needs its own vitest config to be discovered.

### Example

```typescript
describe('Feature', () => {
  it('should do the thing', () => {
    const cache = new InMemoryCache<string>();  // Real dependency, not mock
    const storage = new CacheTokenStorage(cache);
    await storage.setAccessToken('token');
    expect(await storage.getAccessToken()).toBe('token');
  });
});
```

## CLI Commands

```bash
gkm dev                    # Dev server with hot-reload
gkm build --provider server # Production build
gkm test                   # Run tests with secrets
gkm exec -- <cmd>          # Run command with injected secrets
gkm init                   # Scaffold project
gkm deploy --stage prod    # Deploy
gkm secrets:init/set/show/rotate  # Secrets management
gkm setup                  # Reconcile secrets/services
gkm docker                 # Generate Docker files
gkm openapi                # Generate OpenAPI spec
```

## Common Tasks

### Building

```bash
pnpm build    # Build all packages
pnpm lint     # Check with Biome
pnpm fmt      # Format with Biome
```

### Adding a Package

1. Create directory under `packages/`
2. Add `package.json` with `@geekmidas/` prefix
3. Create `src/index.ts` as entry point

## Principles

1. **Type safety first** — leverage TypeScript fully
2. **Zero config** — sensible defaults, work out of the box
3. **Composability** — small focused utilities that compose
4. **Integration testing** — real deps over mocks
5. **Avoid over-engineering** — minimum complexity for current task
