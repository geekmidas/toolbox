# Environment Variable Detection for Build-Time Analysis

**Status**: Implemented
**Created**: 2025-10-13
**Updated**: 2026-01-17
**Author**: Architecture Team

## Overview

This document describes a proposed feature to automatically detect and track environment variables used by each construct (endpoints, functions, crons, subscribers) during the build process. The goal is to enhance deployment automation by providing per-construct environment variable requirements in the build manifest.

## Problem Statement

Currently, when deploying constructs to cloud providers (AWS Lambda, etc.):

1. **Manual Configuration**: Developers must manually specify which environment variables each construct needs
2. **Over-provisioning**: Often all environment variables are provided to all constructs for simplicity
3. **Security Concerns**: Constructs receive access to environment variables they don't actually use
4. **Documentation Gap**: No automatic documentation of environment dependencies
5. **IaC Complexity**: Infrastructure-as-Code tools require manual specification of environment variables per construct

### Example Scenario

```typescript
// Service that uses DATABASE_URL
const databaseService = {
  serviceName: 'database' as const,
  async register(envParser: EnvironmentParser<{}>) {
    const config = envParser.create((get) => ({
      url: get('DATABASE_URL').string(),
      poolSize: get('DB_POOL_SIZE').string().transform(Number).default(10)
    })).parse();

    return new Database(config.url, config.poolSize);
  }
} satisfies Service<'database', Database>;

// Endpoint using the service
export const getUser = e
  .services([databaseService])
  .get('/users/:id')
  .handle(async ({ params, services }) => {
    return services.database.findUser(params.id);
  });
```

**Current Problem**: When deploying `getUser`, we must manually specify that it needs `DATABASE_URL` and `DB_POOL_SIZE`.

**Desired Outcome**: Build process automatically detects these dependencies and includes them in the manifest.

## Proposed Solution

### High-Level Approach

Implement a "sniffer" mode for `EnvironmentParser` that:
1. Tracks which environment variables are accessed via `get(key)` calls
2. Doesn't perform actual validation (returns mock schemas)
3. Collects accessed keys in a set
4. Allows service registration to proceed without real environment values

### Architecture

#### 1. SnifferEnvironmentParser

**Location** (Current): `packages/envkit/src/SnifferEnvironmentParser.ts`
**Location** (Future): After refactoring to separate schema validation, still in `@geekmidas/envkit`

```typescript
/**
 * Special EnvironmentParser that tracks environment variable access
 * without performing validation. Used during build-time analysis.
 */
export class SnifferEnvironmentParser<T extends EmptyObject>
  extends EnvironmentParser<T> {

  private accessedKeys = new Set<string>();

  /**
   * Returns the set of all environment variable keys that were accessed
   */
  getAccessedKeys(): string[] {
    return Array.from(this.accessedKeys).sort();
  }

  /**
   * Override the getter to track access and return mock Zod schemas
   */
  protected getZodGetter = (name: string) => {
    this.accessedKeys.add(name);

    // Return mock Zod object that accepts everything
    return createMockZod();
  }

  /**
   * Reset the tracked keys (useful for testing)
   */
  reset(): void {
    this.accessedKeys.clear();
  }
}
```

#### 2. Service Environment Detector

**Location** (Current): `packages/cli/src/build/serviceEnvDetector.ts`
**Location** (Future): After constructs refactoring, may move to `@geekmidas/constructs` utilities

```typescript
import type { Service } from '@geekmidas/api/services';
import { SnifferEnvironmentParser } from '@geekmidas/envkit';

export interface ServiceEnvDetectionResult {
  serviceName: string;
  environmentVariables: string[];
  error?: Error;
}

/**
 * Detects environment variables used by a set of services
 *
 * @param services - Array of service objects to analyze
 * @returns Array of results, one per service
 */
export async function detectServiceEnvironmentVariables(
  services: Service[]
): Promise<ServiceEnvDetectionResult[]> {
  const results: ServiceEnvDetectionResult[] = [];

  for (const service of services) {
    const sniffer = new SnifferEnvironmentParser({});

    try {
      // Attempt to register the service with the sniffer
      await service.register(sniffer);

      results.push({
        serviceName: service.serviceName,
        environmentVariables: sniffer.getAccessedKeys(),
      });
    } catch (error) {
      // Some services may fail during sniffing (e.g., external connections)
      // Record the error but continue with other services
      results.push({
        serviceName: service.serviceName,
        environmentVariables: sniffer.getAccessedKeys(),
        error: error as Error,
      });
    }
  }

  return results;
}

/**
 * Aggregates environment variables from multiple services,
 * removing duplicates and sorting
 */
export function aggregateEnvironmentVariables(
  results: ServiceEnvDetectionResult[]
): string[] {
  const allVars = new Set<string>();

  for (const result of results) {
    for (const envVar of result.environmentVariables) {
      allVars.add(envVar);
    }
  }

  return Array.from(allVars).sort();
}
```

#### 3. Updated Manifest Types

**Location**: `packages/cli/src/types.ts`

```typescript
export interface RouteInfo {
  path: string;
  method: string;
  handler: string;
  environment?: string[]; // Added: environment variables used
}

export interface FunctionInfo {
  name: string;
  handler: string;
  timeout?: number;
  environment?: string[]; // Added: environment variables used
}

export interface CronInfo {
  name: string;
  handler: string;
  schedule: string;
  timezone?: string;
  environment?: string[]; // Added: environment variables used
}

export interface SubscriberInfo {
  name: string;
  handler: string;
  events: string[];
  environment?: string[]; // Added: environment variables used
}
```

#### 4. Generator Integration

Update each generator (EndpointGenerator, FunctionGenerator, etc.) to detect and include environment variables.

**Example for EndpointGenerator**:

```typescript
async build(
  context: BuildContext,
  constructs: GeneratedConstruct<Endpoint<any, any, any, any, any, any>>[],
  outputDir: string,
  options?: GeneratorOptions,
): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];

  for (const { key, construct, path } of constructs) {
    // Detect environment variables from services
    const envVars = await this.detectEnvironmentVariables(construct.services);

    // Generate handler file...
    const handlerFile = await this.generateHandlerFile(/*...*/);

    const routeInfo: RouteInfo = {
      path: construct._path,
      method: construct.method,
      handler: relative(process.cwd(), handlerFile).replace(/\.ts$/, '.handler'),
      environment: envVars.length > 0 ? envVars : undefined,
    };

    routes.push(routeInfo);
  }

  return routes;
}

private async detectEnvironmentVariables(
  services: Service[]
): Promise<string[]> {
  if (!services || services.length === 0) {
    return [];
  }

  const results = await detectServiceEnvironmentVariables(services);
  return aggregateEnvironmentVariables(results);
}
```

### Example Output

After implementation, the manifest will include environment variable information:

```json
{
  "routes": [
    {
      "path": "/users/{id}",
      "method": "GET",
      "handler": ".gkm/aws-lambda/routes/getUser.handler",
      "environment": [
        "DATABASE_URL",
        "DB_POOL_SIZE"
      ]
    },
    {
      "path": "/auth/login",
      "method": "POST",
      "handler": ".gkm/aws-lambda/routes/login.handler",
      "environment": [
        "DATABASE_URL",
        "DB_POOL_SIZE",
        "JWT_SECRET",
        "JWT_EXPIRES_IN"
      ]
    }
  ],
  "functions": [
    {
      "name": "process-data",
      "handler": ".gkm/aws-lambda/functions/processData.handler",
      "timeout": 300,
      "environment": [
        "S3_BUCKET",
        "S3_REGION",
        "DATABASE_URL"
      ]
    }
  ],
  "crons": [
    {
      "name": "daily-cleanup",
      "handler": ".gkm/aws-lambda/crons/dailyCleanup.handler",
      "schedule": "cron(0 2 * * ? *)",
      "environment": [
        "DATABASE_URL",
        "RETENTION_DAYS"
      ]
    }
  ],
  "subscribers": [
    {
      "name": "user-created-subscriber",
      "handler": ".gkm/aws-lambda/subscribers/userCreated.handler",
      "events": ["user.created"],
      "environment": [
        "EMAIL_SERVICE_API_KEY",
        "WEBHOOK_URL"
      ]
    }
  ]
}
```

## Benefits

### 1. Infrastructure-as-Code Integration

**SST Example**:
```typescript
import manifest from './.gkm/manifest.json';

manifest.routes.forEach(route => {
  new Function(stack, route.handler, {
    handler: route.handler,
    environment: route.environment?.reduce((acc, key) => ({
      ...acc,
      [key]: process.env[key]
    }), {})
  });
});
```

**AWS CDK Example**:
```typescript
manifest.functions.forEach(func => {
  new lambda.Function(this, func.name, {
    code: lambda.Code.fromAsset('.gkm'),
    handler: func.handler,
    environment: func.environment?.reduce((acc, key) => ({
      ...acc,
      [key]: process.env[key] || ''
    }), {})
  });
});
```

### 2. Security & Least Privilege

- Each construct only receives the environment variables it actually uses
- Reduces attack surface by limiting environment variable exposure
- Supports zero-trust security principles

### 3. Documentation

- Auto-generated documentation of environment dependencies
- Clear visibility into what each construct needs
- Easier onboarding for new developers

### 4. Validation

- Pre-deployment validation of required environment variables
- Early detection of missing configuration
- Better error messages during deployment

### 5. Cost Optimization

- Smaller Lambda function configurations
- More efficient cold starts
- Better resource utilization

## Implementation Plan

### Phase 1: Core Implementation

1. **Create SnifferEnvironmentParser**
   - Implement tracking mechanism
   - Add mock Zod schema generation
   - Write comprehensive tests

2. **Create Service Environment Detector**
   - Implement detection logic
   - Add error handling
   - Test with various service patterns

3. **Update Manifest Types**
   - Add `environment` field to all construct info types
   - Update TypeScript types
   - Update manifest generation

### Phase 2: Generator Integration

4. **Update EndpointGenerator**
   - Add environment detection
   - Update manifest generation
   - Add tests

5. **Update FunctionGenerator**
   - Same as EndpointGenerator

6. **Update CronGenerator**
   - Same as EndpointGenerator

7. **Update SubscriberGenerator**
   - Same as EndpointGenerator

### Phase 3: Documentation & Examples

8. **Create User Documentation**
   - Add to VitePress docs
   - Provide IaC examples
   - Document configuration options

9. **Add CLI Output**
   - Show environment variables during build
   - Add verbose mode for debugging
   - Provide warnings for detection failures

### Phase 4: Advanced Features

10. **Optional: Add Configuration**
    - Allow users to disable detection
    - Support manual overrides
    - Add filtering options

11. **Optional: Validation Mode**
    - Check if required env vars are present
    - Warn about missing values
    - Generate .env.example files

## Future Architectural Considerations

### Planned Refactoring: @geekmidas/constructs

**Current State**: Constructs are in `@geekmidas/api/constructs`

**Future State**: Constructs will move to `@geekmidas/constructs`

**Impact on This Feature**:
- Service environment detector may move to `@geekmidas/constructs/utils`
- Generator utilities will need updated imports
- Core SnifferEnvironmentParser stays in `@geekmidas/envkit`

**Migration Path**:
```typescript
// Before
import { Endpoint, Function, Cron } from '@geekmidas/api/constructs';

// After
import { Endpoint, Function, Cron } from '@geekmidas/constructs';
```

### Planned Refactoring: @geekmidas/schema

**Current State**: Schema validation utilities are in `@geekmidas/api/constructs/helpers`

**Future State**: Schema utilities will move to `@geekmidas/schema`

**Impact on This Feature**:
- SnifferEnvironmentParser will need to work with the new schema utilities
- May need to extract schema validation logic from EnvironmentParser
- Consider if sniffer needs any schema utilities at all (likely not)

**Migration Path**:
```typescript
// Before
import { convertStandardSchemaToJsonSchema } from '@geekmidas/api/constructs/helpers';

// After
import { convertStandardSchemaToJsonSchema } from '@geekmidas/schema';
```

**Design Decision**: SnifferEnvironmentParser should be schema-agnostic where possible, only tracking access patterns rather than understanding schema details.

## Testing Strategy

### Unit Tests

1. **SnifferEnvironmentParser**
   - Test key tracking
   - Test nested access patterns
   - Test reset functionality
   - Test mock schema generation

2. **Service Environment Detector**
   - Test single service detection
   - Test multiple services
   - Test error handling
   - Test aggregation

### Integration Tests

3. **Generator Tests**
   - Test endpoint with services
   - Test function with services
   - Test cron with services
   - Test subscriber with services
   - Verify manifest output

4. **End-to-End Tests**
   - Full build with detection enabled
   - Verify manifest structure
   - Test with real service patterns

### Test Examples

```typescript
describe('SnifferEnvironmentParser', () => {
  it('should track accessed environment variable keys', () => {
    const sniffer = new SnifferEnvironmentParser({});

    const config = sniffer.create((get) => ({
      database: {
        url: get('DATABASE_URL').string(),
        port: get('DATABASE_PORT').string().transform(Number),
      },
      redis: {
        url: get('REDIS_URL').string().optional(),
      }
    }));

    // Don't parse, just check what was accessed
    const accessedKeys = sniffer.getAccessedKeys();

    expect(accessedKeys).toEqual([
      'DATABASE_PORT',
      'DATABASE_URL',
      'REDIS_URL',
    ]);
  });

  it('should handle service registration without errors', async () => {
    const service = {
      serviceName: 'test' as const,
      async register(envParser: EnvironmentParser<{}>) {
        const config = envParser.create((get) => ({
          apiKey: get('API_KEY').string(),
        })).parse();

        return { apiKey: config.apiKey };
      }
    };

    const sniffer = new SnifferEnvironmentParser({});

    // Should not throw even without API_KEY in environment
    await expect(service.register(sniffer)).resolves.toBeDefined();

    expect(sniffer.getAccessedKeys()).toContain('API_KEY');
  });
});

describe('detectServiceEnvironmentVariables', () => {
  it('should detect variables from multiple services', async () => {
    const services = [databaseService, cacheService, authService];

    const results = await detectServiceEnvironmentVariables(services);
    const envVars = aggregateEnvironmentVariables(results);

    expect(envVars).toContain('DATABASE_URL');
    expect(envVars).toContain('REDIS_URL');
    expect(envVars).toContain('JWT_SECRET');
  });

  it('should handle service registration errors gracefully', async () => {
    const failingService = {
      serviceName: 'failing' as const,
      async register() {
        throw new Error('Connection failed');
      }
    };

    const results = await detectServiceEnvironmentVariables([failingService]);

    expect(results[0].error).toBeDefined();
    expect(results[0].environmentVariables).toEqual([]);
  });
});
```

## Alternatives Considered

### 1. Static Analysis

**Approach**: Parse TypeScript files and extract environment variable access via AST analysis.

**Pros**:
- No runtime overhead
- Can detect variables even in dead code paths

**Cons**:
- Complex implementation
- Fragile to code patterns
- Doesn't handle dynamic access patterns
- Requires maintaining AST parser

**Decision**: Rejected in favor of runtime detection for simplicity and reliability.

### 2. Manual Annotation

**Approach**: Require developers to manually specify environment variables.

```typescript
export const getUser = e
  .services([databaseService])
  .environment(['DATABASE_URL', 'DB_POOL_SIZE']) // Manual
  .get('/users/:id')
  .handle(async ({ params, services }) => {
    return services.database.findUser(params.id);
  });
```

**Pros**:
- Simple implementation
- Explicit and clear

**Cons**:
- Manual maintenance burden
- Easy to forget to update
- Duplicates information already in services

**Decision**: Rejected. Prefer automatic detection.

### 3. Decorator/Metadata Approach

**Approach**: Use TypeScript decorators to mark environment variables.

**Pros**:
- Clean syntax
- Compile-time safety

**Cons**:
- Requires TypeScript experimental features
- Not all environments support decorators
- Still somewhat manual

**Decision**: Rejected. Current service pattern is sufficient.

## Configuration Options

### CLI Flags

```bash
# Enable environment detection (default: true)
gkm build --detect-env

# Disable environment detection
gkm build --no-detect-env

# Verbose output showing detected variables
gkm build --detect-env --verbose

# Fail build if detection errors occur
gkm build --detect-env --strict
```

### Configuration File

```typescript
// gkm.config.ts
export default {
  build: {
    detectEnvironmentVariables: true,
    environmentDetection: {
      // Fail build if any service detection fails
      strict: false,

      // Show detailed detection logs
      verbose: false,

      // Exclude certain environment variables from output
      exclude: ['NODE_ENV', 'AWS_REGION'],

      // Include these variables even if not detected
      include: ['LOG_LEVEL'],
    }
  }
};
```

## Security Considerations

1. **No Secrets in Manifest**: The manifest only contains environment variable *names*, not values
2. **Build-Time Only**: Detection happens during build, not at runtime
3. **No External Communication**: Sniffer doesn't make network calls or access external resources
4. **Error Isolation**: Errors in one service don't prevent other services from being detected

## Performance Impact

- **Build Time**: Adds ~100-500ms per construct depending on service complexity
- **Runtime**: Zero impact (detection only happens during build)
- **Manifest Size**: Minimal increase (~10-50 bytes per construct)

## Open Questions

1. **Should we detect environment variables used in handler code directly?**
   - Currently only detects service-level dependencies
   - Handler might access `process.env` directly
   - Possible future enhancement: AST analysis for handler code

2. **How to handle optional vs required environment variables?**
   - SnifferEnvironmentParser can distinguish between `.optional()` and required
   - Should manifest indicate which are optional?
   - Need to design schema for this distinction

3. **Should we validate that detected variables exist?**
   - Could add a validation mode that checks `process.env`
   - Useful for pre-deployment checks
   - Should this be opt-in or opt-out?

4. **How to handle environment-specific variables?**
   - Development vs staging vs production
   - Different values, same keys
   - Manifest tracks keys only, values provided at deployment

## Success Metrics

1. **Adoption**: X% of projects using auto-detected environment variables
2. **Accuracy**: >95% accuracy in detection (measured by manual audit)
3. **Build Performance**: <500ms overhead per construct
4. **Developer Satisfaction**: Positive feedback from users
5. **Security**: Measurable reduction in over-provisioned environment variables

## References

- [EnvironmentParser API Documentation](../packages/envkit/docs/api-reference.md)
- [Service Pattern Documentation](../packages/api/docs/api-reference.md)
- [Build Process Documentation](../apps/docs/guide/cli.md)
- [StandardSchema Specification](https://github.com/standard-schema/standard-schema)

## Changelog

- **2025-10-13**: Initial draft created
- **2026-01-17**: Implementation completed

---

## Current Implementation

The environment variable detection feature has been implemented in `@geekmidas/cli/deploy/sniffer`. The implementation supports multiple detection strategies:

### Detection Strategies (in order of priority)

1. **Frontend apps**: Returns empty (no server secrets needed)
2. **Explicit `requiredEnv`**: Uses explicit list from app config
3. **Entry-based apps**: Imports entry file in subprocess to capture `config.parse()` calls
4. **Route-based apps**: Loads route files and calls `getEnvironment()` on each construct
5. **Apps with `envParser` (no routes)**: Runs SnifferEnvironmentParser to detect usage
6. **Apps with neither**: Returns empty

### Key Files

- `packages/cli/src/deploy/sniffer.ts` - Main sniffing orchestration
- `packages/cli/src/deploy/sniffer-routes-worker.ts` - Subprocess worker for route-based sniffing
- `packages/cli/src/deploy/sniffer-worker.ts` - Subprocess worker for entry-based sniffing
- `packages/cli/src/deploy/sniffer-loader.ts` - Module loader hook for entry sniffing
- `packages/envkit/src/SnifferEnvironmentParser.ts` - Environment parser that tracks access

### Route-Based App Sniffing

For apps that define `routes` in their config (e.g., `./src/endpoints/**/*.ts`), the sniffer:

1. Spawns a subprocess with tsx loader for TypeScript/path alias support
2. Uses fast-glob to find all route files matching the pattern
3. Imports each route file and checks exports for constructs
4. Calls `construct.getEnvironment()` on each found construct
5. Aggregates all detected environment variables

The `Construct.getEnvironment()` method sniffs environment variables from:
- All services attached to the construct
- Publisher service (if any)
- Auditor storage service (if any)
- Database service (if any)

### Example Usage

```typescript
import { sniffAppEnvironment } from '@geekmidas/cli/deploy/sniffer';

const app = {
  type: 'backend',
  path: 'apps/api',
  port: 3000,
  routes: './src/endpoints/**/*.ts',
  envParser: './src/config/env#envParser',
  dependencies: [],
  resolvedDeployTarget: 'dokploy',
};

const result = await sniffAppEnvironment(app, 'api', workspacePath);
// result: { appName: 'api', requiredEnvVars: ['DATABASE_URL', 'REDIS_URL', ...] }
```

### Deployment Integration

The sniffer is used during `gkm deploy` to:
1. Detect required environment variables for each app
2. Resolve values from user secrets, auto-generated values, or infrastructure config
3. Validate all required variables are available before deployment
4. Inject resolved values into Docker containers or deployment configuration
