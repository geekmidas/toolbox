# @geekmidas/envkit

Type-safe environment configuration utilities for parsing environment variables and building environment records from typed resources.

## Features

- **EnvironmentParser**: Parse and validate environment variables with Zod schemas
- **EnvironmentBuilder**: Build environment records from type-discriminated objects
- **SstEnvironmentBuilder**: SST-specific builder with built-in resolvers for AWS resources
- Full TypeScript support with automatic type inference
- Nested configuration support
- Error aggregation and reporting

## Installation

```bash
pnpm add @geekmidas/envkit zod
```

## EnvironmentParser

Parse and validate environment variables using Zod schemas.

### Basic Usage

```typescript
import { EnvironmentParser } from '@geekmidas/envkit';

const parser = new EnvironmentParser(process.env);

const config = parser.create((get) => ({
  port: get('PORT').string().transform(Number).default(3000),
  database: {
    host: get('DATABASE_HOST').string(),
    port: get('DATABASE_PORT').string().transform(Number),
    name: get('DATABASE_NAME').string(),
  },
  api: {
    key: get('API_KEY').string().min(32),
    url: get('API_URL').url(),
  }
}));

const parsedConfig = config.parse();
```

### Nested Configuration

```typescript
const config = parser.create((get) => ({
  server: {
    host: get('SERVER_HOST').string().default('localhost'),
    port: get('SERVER_PORT').string().transform(Number).default(3000),
    ssl: {
      enabled: get('SSL_ENABLED').string().transform(v => v === 'true'),
      certPath: get('SSL_CERT_PATH').string().optional(),
    }
  }
}));
```

### Error Handling

The parser aggregates all validation errors:

```typescript
import { z } from 'zod';

try {
  const config = parser.create((get) => ({
    required1: get('MISSING_VAR_1').string(),
    required2: get('MISSING_VAR_2').string(),
  })).parse();
} catch (error) {
  if (error instanceof z.ZodError) {
    error.errors.forEach(err => {
      console.error(`- ${err.path.join('.')}: ${err.message}`);
    });
  }
}
```

## EnvironmentBuilder

A generic builder for creating environment variables from objects with type-discriminated values.

### Basic Usage

```typescript
import { EnvironmentBuilder } from '@geekmidas/envkit';

const env = new EnvironmentBuilder(
  {
    apiKey: { type: 'secret', value: 'xyz' },
    appName: 'my-app',
  },
  {
    // Resolver receives value without 'type' key
    secret: (key, value) => ({ [key]: value.value }),
  }
).build();

// Result: { API_KEY: 'xyz', APP_NAME: 'my-app' }
```

### How It Works

1. **Plain string values** are passed through with key transformation to `UPPER_SNAKE_CASE`
2. **Object values** with a `type` property are matched against resolvers
3. **Resolvers** receive values without the `type` key
4. **Root-level keys** from resolver output are transformed to `UPPER_SNAKE_CASE`

### Multiple Resolvers

```typescript
const env = new EnvironmentBuilder(
  {
    secret: { type: 'secret', value: 'my-secret' },
    database: { type: 'postgres', host: 'localhost', port: 5432 },
    bucket: { type: 'bucket', name: 'my-bucket' },
  },
  {
    secret: (key, value) => ({ [key]: value.value }),
    postgres: (key, value) => ({
      [`${key}Host`]: value.host,
      [`${key}Port`]: value.port,
    }),
    bucket: (key, value) => ({ [`${key}Name`]: value.name }),
  }
).build();

// Result:
// {
//   SECRET: 'my-secret',
//   DATABASE_HOST: 'localhost',
//   DATABASE_PORT: 5432,
//   BUCKET_NAME: 'my-bucket',
// }
```

### Typed Resolvers

Resolver keys and values are type-checked based on the input record:

```typescript
const env = new EnvironmentBuilder(
  {
    auth: { type: 'auth0' as const, domain: 'example.auth0.com', clientId: 'abc' },
  },
  {
    // TypeScript enforces 'auth0' resolver exists and value has correct shape
    auth0: (key, value) => ({
      [`${key}Domain`]: value.domain,
      [`${key}ClientId`]: value.clientId,
    }),
  }
).build();

// Result: { AUTH_DOMAIN: 'example.auth0.com', AUTH_CLIENT_ID: 'abc' }
```

### Handling Unmatched Values

```typescript
const env = new EnvironmentBuilder(
  { unknown: { type: 'unknown-type', data: 'test' } },
  {},
  {
    onUnmatchedValue: (key, value) => {
      console.warn(`No resolver for "${key}":`, value);
    },
  }
).build();
```

## SstEnvironmentBuilder

SST-specific builder with built-in resolvers for AWS resources.

### Basic Usage

```typescript
import { SstEnvironmentBuilder, ResourceType } from '@geekmidas/envkit/sst';

const env = new SstEnvironmentBuilder({
  database: {
    type: ResourceType.Postgres,
    host: 'db.example.com',
    port: 5432,
    database: 'myapp',
    username: 'admin',
    password: 'secret',
  },
  apiKey: {
    type: ResourceType.Secret,
    value: 'super-secret',
  },
  appName: 'my-app',
}).build();

// Result:
// {
//   DATABASE_HOST: 'db.example.com',
//   DATABASE_PORT: 5432,
//   DATABASE_NAME: 'myapp',
//   DATABASE_USERNAME: 'admin',
//   DATABASE_PASSWORD: 'secret',
//   API_KEY: 'super-secret',
//   APP_NAME: 'my-app',
// }
```

### Supported Resource Types

| Resource Type | Properties | Output |
|--------------|------------|--------|
| `Secret` / `SSTSecret` | `value` | `{key}: value` |
| `Postgres` / `SSTPostgres` | `host`, `port`, `database`, `username`, `password` | `{key}Host`, `{key}Port`, `{key}Name`, `{key}Username`, `{key}Password` |
| `Bucket` / `SSTBucket` | `name` | `{key}Name` |
| `SnsTopic` | `arn` | `{key}Arn` |
| `ApiGatewayV2` | - | No output (noop) |
| `Function` | - | No output (noop) |
| `Vpc` | - | No output (noop) |

### Custom Resolvers

Add custom resolvers alongside built-in SST resolvers:

```typescript
const env = new SstEnvironmentBuilder(
  {
    database: { type: ResourceType.Postgres, /* ... */ },
    custom: { type: 'my-custom' as const, data: 'custom-data' },
  },
  {
    // Custom resolver merged with SST resolvers
    'my-custom': (key, value) => ({ [`${key}Data`]: value.data }),
  }
).build();

// Result includes both SST resources and custom type
```

### Resource Type Enum

```typescript
import { ResourceType } from '@geekmidas/envkit/sst';

// Legacy format (dot notation)
ResourceType.Postgres    // 'sst.aws.Postgres'
ResourceType.Secret      // 'sst.sst.Secret'
ResourceType.Bucket      // 'sst.aws.Bucket'

// Modern format (colon notation)
ResourceType.SSTPostgres // 'sst:aws:Postgres'
ResourceType.SSTSecret   // 'sst:sst:Secret'
ResourceType.SSTBucket   // 'sst:aws:Bucket'
ResourceType.SnsTopic    // 'sst:aws:SnsTopic'
```

### Using with SST Resource

Combine `SstEnvironmentBuilder` with `EnvironmentParser` to create a type-safe configuration from SST resources:

```typescript
// config.ts
import { EnvironmentParser } from '@geekmidas/envkit';
import { SstEnvironmentBuilder } from '@geekmidas/envkit/sst';
import { Resource } from 'sst';

// Build environment variables from SST resources
const env = new SstEnvironmentBuilder(Resource as {}).build();

// Create parser with the normalized environment
export const envParser = new EnvironmentParser(env);

// Define your configuration schema
export const config = envParser.create((get) => ({
  database: {
    host: get('DATABASE_HOST').string(),
    port: get('DATABASE_PORT').number(),
    name: get('DATABASE_NAME').string(),
    username: get('DATABASE_USERNAME').string(),
    password: get('DATABASE_PASSWORD').string(),
  },
  apiKey: get('API_KEY').string(),
})).parse();
```

This pattern allows you to:
1. Normalize SST resources (Postgres, Secrets, Buckets, etc.) into flat environment variables
2. Parse and validate them with Zod schemas
3. Get full TypeScript type inference for your configuration

## API Reference

### EnvironmentParser

```typescript
class EnvironmentParser {
  constructor(config: Record<string, unknown>);
  create<T>(schemaBuilder: (get: GetFunction) => T): ConfigParser<T>;
}
```

### EnvironmentBuilder

```typescript
class EnvironmentBuilder<TRecord, TResolvers> {
  constructor(
    record: TRecord,
    resolvers: TResolvers,
    options?: EnvironmentBuilderOptions
  );
  build(): EnvRecord;
}

interface EnvironmentBuilderOptions {
  onUnmatchedValue?: (key: string, value: unknown) => void;
}
```

### SstEnvironmentBuilder

```typescript
class SstEnvironmentBuilder<TRecord> {
  constructor(
    record: TRecord,
    additionalResolvers?: CustomResolvers<TRecord>,
    options?: EnvironmentBuilderOptions
  );
  build(): EnvRecord;
}
```

### environmentCase

```typescript
function environmentCase(name: string): string;

// Examples:
environmentCase('myVariable')  // 'MY_VARIABLE'
environmentCase('apiUrl')      // 'API_URL'
environmentCase('databaseName') // 'DATABASE_NAME'
```

## License

MIT
