# @geekmidas/envkit

Type-safe environment configuration parser using Zod validation.

## Installation

```bash
pnpm add @geekmidas/envkit
```

## Features

- ✅ Zod-based schema validation
- ✅ Nested configuration support
- ✅ Path-based access using lodash
- ✅ Aggregated error reporting
- ✅ Type inference from schema
- ✅ Default values
- ✅ Transform functions

## Basic Usage

```typescript
import { EnvironmentParser } from '@geekmidas/envkit';

const config = new EnvironmentParser(process.env)
  .create((get) => ({
    // Simple values
    port: get('PORT').string().transform(Number).default(3000),
    nodeEnv: get('NODE_ENV').string().default('development'),
    
    // Nested configuration
    database: {
      url: get('DATABASE_URL').string().url(),
      poolSize: get('DATABASE_POOL_SIZE').string().transform(Number).default(10),
    },
    
    // Optional values
    apiKey: get('API_KEY').string().optional(),
    
    // Boolean values
    debug: get('DEBUG').string().transform(v => v === 'true').default(false),
  }))
  .parse();

// Type-safe access
console.log(config.port); // number
console.log(config.database.url); // string
console.log(config.apiKey); // string | undefined
```

## Advanced Usage

### Custom Validation

```typescript
const config = new EnvironmentParser(process.env)
  .create((get) => ({
    email: get('ADMIN_EMAIL').string().email(),
    url: get('API_URL').string().url(),
    port: get('PORT').string().regex(/^\d+$/).transform(Number),
  }))
  .parse();
```

### Arrays and Complex Types

```typescript
const config = new EnvironmentParser(process.env)
  .create((get) => ({
    // Comma-separated list
    allowedOrigins: get('ALLOWED_ORIGINS')
      .string()
      .transform(v => v.split(','))
      .default([]),
    
    // JSON parsing
    features: get('FEATURE_FLAGS')
      .string()
      .transform(v => JSON.parse(v))
      .default({}),
  }))
  .parse();
```

### Error Handling

```typescript
try {
  const config = new EnvironmentParser(process.env)
    .create((get) => ({
      required: get('REQUIRED_VAR').string(),
      mustBeNumber: get('NUMBER_VAR').string().transform(Number),
    }))
    .parse();
} catch (error) {
  // Aggregated errors for all invalid fields
  console.error('Configuration errors:', error.message);
  process.exit(1);
}
```

### Using with Services

```typescript
// config.ts
export const config = new EnvironmentParser(process.env)
  .create((get) => ({
    server: {
      port: get('PORT').string().transform(Number).default(3000),
      host: get('HOST').string().default('localhost'),
    },
    database: {
      url: get('DATABASE_URL').string().url(),
    },
  }))
  .parse();

// Usage
import { config } from './config';

app.listen(config.server.port, config.server.host);
```