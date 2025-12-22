# Async Secrets Resolution Design

## Problem Statement

Applications often need to fetch sensitive configuration values (secrets) from external providers like HashiCorp Vault, AWS Secrets Manager, or other secret management systems. The current `EnvironmentParser` only supports synchronous parsing of environment variables, which doesn't accommodate async secret fetching.

Additionally, environment variables for secrets typically contain **references** to the actual secret (e.g., a Vault path), not the secret value itself:

```bash
# Environment variables
DB_HOST=localhost           # Actual value
DB_PASSWORD=/vault/prod/db  # Reference to secret, not the actual password
API_KEY=/vault/prod/api     # Reference to secret
```

## Proposed Solution

Extend `EnvironmentParser` with:
1. A separate `getSecret()` getter to distinguish secrets from regular env vars
2. A configurable `secretsResolver` that fetches actual values from refs
3. A cache to avoid redundant fetches for the same ref
4. An `echoSecretsResolver` for testing that returns refs as values

## API Design

### Constructor Options

```typescript
interface EnvironmentParserOptions {
  /**
   * Function to resolve secret references to actual values.
   * Receives an array of refs (values from env vars marked as secrets).
   * Returns a Map of ref → resolved value.
   */
  secretsResolver?: SecretsResolver;
}

type SecretsResolver = (refs: string[]) => Promise<Map<string, string>>;
```

### Getters

```typescript
parser.create((get, getSecret) => ({
  // Regular env var - resolved synchronously
  host: get('DB_HOST').string(),
  port: get('PORT').string().transform(Number),

  // Secret env var - resolved asynchronously via secretsResolver
  // The env var value is treated as a ref, not the actual value
  password: getSecret('DB_PASSWORD').string(),
  apiKey: getSecret('API_KEY').string(),
}));
```

### Parsed Config Types

```typescript
// Regular values are their actual types
config.host     // string
config.port     // number

// Secret values are Promises of their types
config.password // Promise<string>
config.apiKey   // Promise<string>

// Usage
const password = await config.password;
```

### Built-in Resolvers

```typescript
import { echoSecretsResolver } from '@geekmidas/envkit';

/**
 * Echo resolver returns the ref as the value.
 * Useful for testing where the "ref" IS the actual test value.
 */
export const echoSecretsResolver: SecretsResolver = async (refs) =>
  new Map(refs.map((ref) => [ref, ref]));
```

## Resolution Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         parse() called                               │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  1. Regular env vars (get) are parsed synchronously as normal        │
│     config.host = "localhost"                                        │
│     config.port = 3000                                               │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. Secret env vars (getSecret) return Promises                      │
│     config.password = Promise<string>                                │
│     config.apiKey = Promise<string>                                  │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. When Promise is awaited:                                         │
│     a. Read ref from env var (e.g., "/vault/prod/db")               │
│     b. Check cache - if cached, return cached value                  │
│     c. If not cached, call secretsResolver([ref])                    │
│     d. Cache the resolved value                                      │
│     e. Apply Zod validation/transformation                           │
│     f. Return validated value                                        │
└─────────────────────────────────────────────────────────────────────┘
```

## Caching Strategy

A resolved secrets cache prevents redundant API calls:

```typescript
// Internal cache (per EnvironmentParser instance)
private resolvedCache = new Map<string, string>();

async resolveSecret(ref: string): Promise<string> {
  // Return cached value if available
  if (this.resolvedCache.has(ref)) {
    return this.resolvedCache.get(ref)!;
  }

  // Fetch from resolver
  const resolved = await this.secretsResolver([ref]);
  const value = resolved.get(ref);

  if (value === undefined) {
    throw new Error(`Secret resolver did not return value for ref: ${ref}`);
  }

  // Cache for future use
  this.resolvedCache.set(ref, value);
  return value;
}
```

Benefits:
- Same ref accessed multiple times → single resolver call
- Consistent values within a parser instance
- Reduces load on secret providers

## Usage Examples

### Production with Vault

```typescript
import { EnvironmentParser } from '@geekmidas/envkit';

// Vault resolver implementation
const vaultResolver: SecretsResolver = async (refs) => {
  const secrets = await vaultClient.batchRead(refs);
  return new Map(refs.map((ref, i) => [ref, secrets[i].value]));
};

const parser = new EnvironmentParser(process.env, {
  secretsResolver: vaultResolver,
});

const config = parser.create((get, getSecret) => ({
  database: {
    host: get('DB_HOST').string(),
    port: get('DB_PORT').coerce.number(),
    password: getSecret('DB_PASSWORD').string(),
  },
  api: {
    baseUrl: get('API_BASE_URL').string().url(),
    key: getSecret('API_KEY').string().min(32),
  },
})).parse();

// Use in service registration
const databaseService = {
  serviceName: 'database' as const,
  async register(envParser: EnvironmentParser<{}>) {
    const config = envParser.create((get, getSecret) => ({
      host: get('DB_HOST').string(),
      password: getSecret('DB_PASSWORD').string(),
    })).parse();

    // Await the secret
    const password = await config.password;

    return new Database({
      host: config.host,
      password,
    });
  },
};
```

### Testing with Echo Resolver

```typescript
import { EnvironmentParser, echoSecretsResolver } from '@geekmidas/envkit';

describe('DatabaseService', () => {
  it('should connect with credentials', async () => {
    // In tests, the "ref" IS the actual test value
    const env = {
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_PASSWORD: 'test-password-123', // This IS the password for tests
    };

    const parser = new EnvironmentParser(env, {
      secretsResolver: echoSecretsResolver,
    });

    const service = await databaseService.register(parser);

    expect(service.isConnected()).toBe(true);
  });
});
```

### AWS Secrets Manager

```typescript
import { SecretsManagerClient, BatchGetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const awsResolver: SecretsResolver = async (refs) => {
  const client = new SecretsManagerClient({});
  const command = new BatchGetSecretValueCommand({
    SecretIdList: refs,
  });

  const response = await client.send(command);
  const result = new Map<string, string>();

  for (const secret of response.SecretValues ?? []) {
    if (secret.ARN && secret.SecretString) {
      result.set(secret.ARN, secret.SecretString);
    }
  }

  return result;
};
```

## Type Definitions

```typescript
/**
 * Function type for resolving secret references to actual values.
 */
export type SecretsResolver = (refs: string[]) => Promise<Map<string, string>>;

/**
 * Extended getter that includes secret() method.
 */
export type SecretEnvFetcher<TPath extends string = string> = (
  name: TPath,
) => typeof z;

/**
 * Builder function signature with both getters.
 */
export type EnvironmentBuilderWithSecrets<TResponse extends EmptyObject> = (
  get: EnvFetcher,
  getSecret: SecretEnvFetcher,
) => TResponse;

/**
 * Infers config type, wrapping secret values in Promise.
 */
export type InferConfigWithSecrets<T extends EmptyObject> = {
  [K in keyof T]: T[K] extends SecretSchema<infer U>
    ? Promise<U>
    : T[K] extends z.ZodSchema
      ? z.infer<T[K]>
      : T[K] extends Record<string, unknown>
        ? InferConfigWithSecrets<T[K]>
        : T[K];
};
```

## Error Handling

### Missing Resolver

```typescript
// If getSecret() is used but no resolver provided
const parser = new EnvironmentParser(env); // no resolver

const config = parser.create((get, getSecret) => ({
  password: getSecret('DB_PASSWORD').string(),
})).parse();

await config.password;
// Error: SecretsResolver is required when using getSecret().
// Configure it via EnvironmentParser options.
```

### Missing Ref in Environment

```typescript
// If env var doesn't exist
const env = { DB_HOST: 'localhost' }; // DB_PASSWORD not set

const config = parser.create((get, getSecret) => ({
  password: getSecret('DB_PASSWORD').string(),
})).parse();

await config.password;
// Error: Environment variable "DB_PASSWORD" is not defined.
// Expected a secret reference.
```

### Resolver Doesn't Return Value

```typescript
// If resolver doesn't return value for a ref
const brokenResolver: SecretsResolver = async (refs) => new Map();

await config.password;
// Error: Secret resolver did not return value for ref: /vault/prod/db
```

## Migration Path

Existing code using `EnvironmentParser` continues to work unchanged:

```typescript
// Before (still works)
const config = parser.create((get) => ({
  port: get('PORT').string().transform(Number),
})).parse();

// After (opt-in to secrets)
const config = parser.create((get, getSecret) => ({
  port: get('PORT').string().transform(Number),
  password: getSecret('DB_PASSWORD').string(),
})).parse();
```

## Open Questions

1. **Batch resolution timing**: Should we batch all secret resolutions when `parse()` is called, or resolve lazily when each Promise is awaited?
   - **Lazy (proposed)**: Each secret resolved on first await, cached for subsequent access
   - **Eager**: All secrets resolved upfront in parse(), requires parseAsync()

2. **Cache scope**: Should the cache be per-parser instance or global?
   - **Per-instance (proposed)**: Isolated, predictable behavior
   - **Global**: More efficient for multiple parsers with same refs

3. **Cache invalidation**: Should there be a way to clear the cache?
   - Could add `parser.clearSecretCache()` method if needed
