# Architecture Overview

This document describes the architecture and design decisions of the @geekmidas/toolbox monorepo.

## 🏗️ Monorepo Structure

### Overview

The project uses a monorepo structure managed by pnpm workspaces and Turbo. This approach provides:

- **Code Sharing**: Easy sharing of types, utilities, and configurations
- **Atomic Changes**: Related changes across packages in a single commit
- **Unified Tooling**: Consistent build, test, and lint processes
- **Simplified Dependencies**: Workspace protocol for internal dependencies

### Directory Layout

```
toolbox/
├── packages/               # All packages live here
│   ├── api/               # REST API framework
│   │   ├── src/           # Source code
│   │   ├── test/          # Tests
│   │   ├── examples/      # Usage examples
│   │   └── docs/          # Package documentation
│   └── envkit/            # Environment parser
│       └── (same structure)
├── docs/                  # Project-wide documentation
├── scripts/               # Build and maintenance scripts
└── configs/               # Shared configurations
```

## 📦 Package Architecture

### Design Principles

1. **Single Responsibility**: Each package has one clear purpose
2. **Minimal Dependencies**: Packages depend only on what they need
3. **Type Safety**: Full TypeScript with strict mode
4. **Tree Shaking**: ESM-first with proper exports
5. **Developer Experience**: Intuitive APIs with good defaults

### Package Structure

Each package follows a consistent structure:

```
package/
├── src/
│   ├── index.ts          # Main exports
│   ├── types.ts          # Type definitions
│   ├── errors.ts         # Error classes
│   └── utils/            # Internal utilities
├── test/
│   ├── unit/             # Unit tests
│   └── integration/      # Integration tests
├── examples/             # Usage examples
├── package.json          # Package manifest
└── README.md             # Package documentation
```

### Export Strategy

Packages use multiple entry points for better tree shaking:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./server": "./dist/server.js",
    "./client": "./dist/client.js",
    "./errors": "./dist/errors.js"
  }
}
```

## 🔧 Build System

### tsdown Configuration

We use tsdown for building packages because it:
- Outputs both CommonJS and ESM
- Handles TypeScript compilation
- Generates declaration files
- Supports modern JavaScript features

Build outputs:
- `dist/*.js` - ESM modules
- `dist/*.cjs` - CommonJS modules
- `dist/*.d.ts` - TypeScript declarations

### Turbo Pipeline

Turbo orchestrates tasks across packages:

```json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"]
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

## 🧩 Package Details

### @geekmidas/api

**Architecture Pattern**: Fluent Builder Pattern with Middleware Chain

```typescript
// Builder chain creates immutable endpoint instances
endpoint
  .method(verb)        // Returns new instance
  .path(pattern)       // Returns new instance
  .validate(schema)    // Returns new instance
  .handle(handler)     // Final configuration
```

**Key Components**:

1. **RestEndpoint**: Core builder class
   - Immutable configuration
   - Type-safe method chaining
   - Runtime validation

2. **HermodService**: Service base class
   - Dependency injection
   - Lifecycle management
   - Shared context

3. **Error System**: Comprehensive HTTP errors
   - One class per status code
   - Consistent error format
   - Stack trace preservation

4. **Type System**: Advanced TypeScript usage
   - Conditional types for inference
   - Branded types for safety
   - Mapped types for transforms

### @geekmidas/envkit

**Architecture Pattern**: Parser Factory with Schema Validation

```typescript
// Two-phase parsing for better error aggregation
const parser = new EnvironmentParser(env);
const builder = parser.create(schemaFn);
const config = builder.parse();
```

**Key Components**:

1. **EnvironmentParser**: Main factory
   - Wraps environment source
   - Creates typed builders
   - Handles missing values

2. **ConfigBuilder**: Schema builder
   - Fluent API for schemas
   - Type inference
   - Error collection

3. **Validation**: Zod integration
   - Schema composition
   - Transform support
   - Custom validators

## 🔐 Type Safety Strategy

### Compile-Time Safety

- **Strict Mode**: All packages use TypeScript strict mode
- **No Implicit Any**: Explicit types everywhere
- **Strict Null Checks**: Null safety enforced
- **No Unused Parameters**: Clean function signatures

### Runtime Safety

- **Schema Validation**: Input/output validation
- **Type Guards**: Runtime type checking
- **Error Boundaries**: Graceful error handling
- **Assertion Functions**: Debug-mode checks

### Type Inference

Heavy use of TypeScript's type inference:

```typescript
// Input types inferred from schema
const endpoint = e
  .get('/users/:id')
  .params(z.object({ id: z.string() }))
  .handle(async ({ params }) => {
    // params.id is typed as string
  });
```

## 🧪 Testing Strategy

### Test Levels

1. **Unit Tests**: Isolated component testing
2. **Integration Tests**: Cross-component testing
3. **Type Tests**: TypeScript compilation tests
4. **Example Tests**: Documentation as tests

### Test Organization

```
test/
├── unit/
│   ├── endpoint.test.ts
│   └── service.test.ts
├── integration/
│   └── aws-lambda.test.ts
└── types/
    └── inference.test-d.ts
```

### Testing Tools

- **Vitest**: Fast unit test runner
- **TypeScript**: Type-level testing
- **Supertest**: HTTP testing
- **MSW**: API mocking

## 🚀 Performance Considerations

### Bundle Size

- Tree-shakeable exports
- Minimal dependencies
- Lazy loading where possible
- Development/production splits

### Runtime Performance

- Efficient validation caching
- Middleware pre-compilation
- Memory-efficient error handling
- Connection pooling support

### Build Performance

- Turbo caching for rebuilds
- Parallel package builds
- Incremental TypeScript compilation
- Selective test running

## 🔄 Development Workflow

### Local Development

```bash
# Install dependencies
pnpm install

# Start development mode
pnpm dev

# Run specific package
pnpm --filter @geekmidas/api dev
```

### Making Changes

1. **Feature Branch**: Create from main
2. **Development**: Use watch mode
3. **Testing**: Write tests first
4. **Documentation**: Update as you go
5. **Review**: Self-review checklist

### Release Process

1. **Version Bump**: Update package versions
2. **Changelog**: Document changes
3. **Build**: Ensure clean build
4. **Test**: All tests pass
5. **Publish**: npm publish

## 🔮 Future Architecture Plans

### Planned Improvements

1. **Plugin System**: Extensible middleware
2. **Code Generation**: TypeScript from OpenAPI
3. **Performance Monitoring**: Built-in metrics
4. **Distributed Tracing**: Request tracking

### Potential Packages

- **@geekmidas/cli**: CLI tooling
- **@geekmidas/db**: Database utilities
- **@geekmidas/auth**: Authentication helpers
- **@geekmidas/queue**: Job queue abstractions

## 📚 Further Reading

- [Contributing Guide](./CONTRIBUTING.md)
- [API Package Docs](./packages/api/README.md)
- [EnvKit Package Docs](./packages/envkit/README.md)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)