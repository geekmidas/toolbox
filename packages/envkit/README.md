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

### Type Safety

The parsed configuration is fully typed:

```typescript
const config = parser.create((get) => ({
  port: get('PORT').string().transform(Number),
  features: {
    auth: get('FEATURE_AUTH').string().transform(v => v === 'true')
  }
}));

const parsed = config.parse();
// TypeScript knows: parsed.port is number, parsed.features.auth is boolean
```

## API Reference

### `EnvironmentParser`

The main class for creating configuration parsers.

#### Constructor

```typescript
new EnvironmentParser(config: Record<string, unknown>)
```

- `config`: The configuration object to parse (typically `process.env`)

#### Methods

##### `create<T>(schemaBuilder: (get: GetFunction) => T): ConfigParser<T>`

Creates a configuration parser with the specified schema.

- `schemaBuilder`: A function that receives a `get` function and returns the schema definition
- Returns: A `ConfigParser` instance

### `ConfigParser`

The configuration parser returned by `EnvironmentParser.create()`.

#### Methods

##### `parse(): T`

Parses and validates the configuration.

- Returns: The parsed configuration object
- Throws: `ZodError` if validation fails

### `GetFunction`

The function passed to the schema builder for accessing configuration values.

```typescript
type GetFunction = (path: string) => ZodTypeAny
```

- `path`: The path to the configuration value (supports nested paths with dots)
- Returns: A Zod schema that will be used to validate the value at the specified path

## Best Practices

1. **Define configuration at startup**: Parse your configuration once at application startup and export the result:

```typescript
// config.ts
import { EnvironmentParser } from '@geekmidas/envkit';
import { z } from 'zod';

const parser = new EnvironmentParser(process.env);

export const config = parser.create((get) => ({
  // ... your schema
})).parse();

// Other files can import the typed config
import { config } from './config';
```

2. **Use meaningful defaults**: Provide sensible defaults for optional configuration:

```typescript
const config = parser.create((get) => ({
  port: get('PORT').string().transform(Number).default(3000),
  logLevel: get('LOG_LEVEL').enum(['debug', 'info', 'warn', 'error']).default('info')
}));
```

3. **Group related configuration**: Organize your configuration into logical groups:

```typescript
const config = parser.create((get) => ({
  server: { /* server config */ },
  database: { /* database config */ },
  features: { /* feature flags */ },
  thirdParty: { /* external service config */ }
}));
```

4. **Document your configuration**: Add comments to explain complex validations:

```typescript
const config = parser.create((get) => ({
  // Maximum number of concurrent connections
  maxConnections: get('MAX_CONNECTIONS')
    .string()
    .transform(Number)
    .int()
    .min(1)
    .max(1000)
    .default(100),
  
  // Comma-separated list of allowed origins
  allowedOrigins: get('ALLOWED_ORIGINS')
    .string()
    .transform(origins => origins.split(',').map(o => o.trim()))
    .default(['http://localhost:3000'])
}));
```

## License

MIT