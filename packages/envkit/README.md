# @geekmidas/envkit

A type-safe environment configuration parser that uses Zod schemas to validate and parse environment variables or configuration objects.

## Features

- 🔒 **Type-safe**: Full TypeScript support with automatic type inference
- ✅ **Schema validation**: Uses Zod schemas for robust validation
- 🏗️ **Nested configuration**: Support for complex, nested configuration structures
- 🚨 **Error aggregation**: Collects and reports all validation errors at once
- 🔍 **Path-based access**: Uses lodash's `get` and `set` for deep object access
- 🎯 **Zero dependencies**: Only depends on Zod and minimal lodash utilities

## Installation

```bash
npm install @geekmidas/envkit zod
# or
yarn add @geekmidas/envkit zod
# or
pnpm add @geekmidas/envkit zod
```

## Quick Start

```typescript
import { EnvironmentParser } from '@geekmidas/envkit';
import { z } from 'zod';

// Create parser with your config object (e.g., process.env)
const parser = new EnvironmentParser(process.env);

// Define your configuration schema
const config = parser.create((get) => ({
  port: get('PORT').string().transform(Number).default(3000),
  database: {
    host: get('DATABASE_HOST').string(),
    port: get('DATABASE_PORT').string().transform(Number),
    name: get('DATABASE_NAME').string(),
    user: get('DATABASE_USER').string(),
    password: get('DATABASE_PASSWORD').string()
  },
  api: {
    key: get('API_KEY').string().min(32),
    url: get('API_URL').url(),
    timeout: get('API_TIMEOUT').string().transform(Number).default(5000)
  }
}));

// Parse and validate
try {
  const parsedConfig = config.parse();
  console.log('Configuration loaded successfully:', parsedConfig);
} catch (error) {
  console.error('Configuration validation failed:', error);
  process.exit(1);
}
```

## Usage

### Basic Configuration

The simplest use case is parsing flat environment variables:

```typescript
const parser = new EnvironmentParser(process.env);

const config = parser.create((get) => ({
  appName: get('APP_NAME').string(),
  port: get('PORT').string().transform(Number),
  isProduction: get('NODE_ENV').string().transform(env => env === 'production')
}));

const { appName, port, isProduction } = config.parse();
```

### Nested Configuration

Create deeply nested configuration structures:

```typescript
const config = parser.create((get) => ({
  server: {
    host: get('SERVER_HOST').string().default('localhost'),
    port: get('SERVER_PORT').string().transform(Number).default(3000),
    ssl: {
      enabled: get('SSL_ENABLED').string().transform(v => v === 'true'),
      certPath: get('SSL_CERT_PATH').string().optional(),
      keyPath: get('SSL_KEY_PATH').string().optional()
    }
  },
  features: {
    authentication: get('FEATURE_AUTH').string().transform(v => v === 'true'),
    rateLimit: get('FEATURE_RATE_LIMIT').string().transform(v => v === 'true'),
    cache: {
      enabled: get('CACHE_ENABLED').string().transform(v => v === 'true'),
      ttl: get('CACHE_TTL').string().transform(Number).default(3600)
    }
  }
}));
```

### Using Different Config Sources

While `process.env` is the most common source, you can use any object:

```typescript
// From a JSON file
import configJson from './config.json';
const parser = new EnvironmentParser(configJson);

// From a custom object
const customConfig = {
  API_URL: 'https://api.example.com',
  API_KEY: 'secret-key-123'
};
const parser = new EnvironmentParser(customConfig);

// Combining multiple sources
const mergedConfig = {
  ...defaultConfig,
  ...process.env
};
const parser = new EnvironmentParser(mergedConfig);
```

### Advanced Validation

Leverage Zod's full validation capabilities:

```typescript
const config = parser.create((get) => ({
  email: get('ADMIN_EMAIL').string().email(),
  webhook: get('WEBHOOK_URL').url(),
  retries: get('MAX_RETRIES').string().transform(Number).int().min(0).max(10),
  allowedOrigins: get('ALLOWED_ORIGINS')
    .string()
    .transform(origins => origins.split(','))
    .refine(origins => origins.every(o => o.startsWith('http')), {
      message: 'All origins must be valid URLs'
    }),
  logLevel: get('LOG_LEVEL')
    .enum(['debug', 'info', 'warn', 'error'])
    .default('info')
}));
```

### Error Handling

The parser aggregates all validation errors and throws a single `ZodError`:

```typescript
try {
  const config = parser.create((get) => ({
    required1: get('MISSING_VAR_1').string(),
    required2: get('MISSING_VAR_2').string(),
    invalid: get('INVALID_NUMBER').string().transform(Number)
  })).parse();
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('Configuration errors:');
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