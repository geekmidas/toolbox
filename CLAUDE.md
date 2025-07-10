# Claude AI Assistant Instructions for @geekmidas/toolbox

## Project Overview

This is a TypeScript monorepo containing utilities and frameworks for building modern web applications. The project is organized as a collection of packages under the `@geekmidas` namespace, each serving a specific purpose.

### Key Characteristics
- **Language**: TypeScript 5.8.2
- **Runtime**: Node.js ≥ 22.0.0
- **Package Manager**: pnpm 10.11.0
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
│   ├── testkit/      # Testing utilities and database factories
│   └── envkit/       # Environment configuration parser
├── turbo.json        # Turbo configuration
├── pnpm-workspace.yaml
├── tsdown.config.ts  # Build configuration
├── vitest.config.ts  # Test configuration
└── biome.json        # Linting and formatting
```

### Package Descriptions

#### @geekmidas/api
A comprehensive REST API framework for building type-safe HTTP endpoints.

**Key Features:**
- Fluent endpoint builder pattern using `e` export
- Full TypeScript type inference
- StandardSchema validation (Zod, Valibot, etc.)
- AWS Lambda adapter support
- Service dependency injection system
- Built-in error handling with HTTP-specific error classes
- Session and authorization management
- Structured logging with context propagation

**Usage Pattern:**
```typescript
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

const endpoint = e
  .post('/users')
  .body(z.object({ name: z.string() }))
  .output(z.object({ id: z.string() }))
  .handle(async ({ body }) => ({ id: '123' }));
```

#### @geekmidas/testkit
Testing utilities focused on database factories for test data creation.

**Key Features:**
- Factory pattern for Kysely and Objection.js
- Type-safe builders with schema inference
- Transaction-based test isolation
- Batch operations support
- Database migration utilities
- Seed functions for complex scenarios

**Usage Pattern:**
```typescript
import { KyselyFactory } from '@geekmidas/testkit/kysely';

const factory = new KyselyFactory(builders, seeds, db);
const user = await factory.insert('user', { name: 'Test User' });
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
- Extend `HermodService` for dependency injection
- Define `serviceName` as static property
- Implement `register()` and optionally `cleanup()`

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
- `@geekmidas/api/server` - Server-side utilities
- `@geekmidas/api/aws-lambda` - AWS Lambda adapters
- `@geekmidas/api/errors` - Error classes
- `@geekmidas/testkit/kysely` - Kysely factories
- `@geekmidas/testkit/objection` - Objection.js factories

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