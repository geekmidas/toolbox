# API Reference - @geekmidas/envkit

## Classes

### `EnvironmentParser`

The main class for creating configuration parsers.

```typescript
class EnvironmentParser {
  constructor(config: Record<string, unknown>)
  create<T>(schemaBuilder: (get: GetFunction) => T): ConfigParser<T>
}
```

#### Constructor

Creates a new environment parser instance.

**Parameters:**
- `config: Record<string, unknown>` - The configuration object to parse (typically `process.env`)

**Example:**
```typescript
const parser = new EnvironmentParser(process.env);
```

#### Methods

##### `create<T>(schemaBuilder: (get: GetFunction) => T): ConfigParser<T>`

Creates a configuration parser with the specified schema.

**Parameters:**
- `schemaBuilder: (get: GetFunction) => T` - A function that receives a `get` function and returns the schema definition

**Returns:**
- `ConfigParser<T>` - A configuration parser instance

**Example:**
```typescript
const config = parser.create((get) => ({
  port: get('PORT').string().transform(Number),
  apiKey: get('API_KEY').string()
}));
```

### `ConfigParser<T>`

The configuration parser returned by `EnvironmentParser.create()`.

```typescript
class ConfigParser<T> {
  parse(): T
}
```

#### Methods

##### `parse(): T`

Parses and validates the configuration according to the defined schema.

**Returns:**
- `T` - The parsed and validated configuration object

**Throws:**
- `ZodError` - If validation fails. The error contains all validation failures aggregated together.

**Example:**
```typescript
try {
  const config = parser.create((get) => ({
    port: get('PORT').string().transform(Number)
  })).parse();
  
  console.log(config.port); // number
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('Validation errors:', error.errors);
  }
}
```

## Type Definitions

### `GetFunction`

The function passed to the schema builder for accessing configuration values.

```typescript
type GetFunction = (path: string) => ZodTypeAny
```

**Parameters:**
- `path: string` - The path to the configuration value. Supports:
  - Simple paths: `'PORT'`, `'API_KEY'`
  - Nested paths with dots: `'database.host'`, `'api.endpoints.users'`

**Returns:**
- `ZodTypeAny` - A Zod schema that will be used to validate the value at the specified path

**Usage:**
```typescript
const config = parser.create((get) => ({
  // Simple path
  port: get('PORT').string(),
  
  // Nested path - looks for 'DATABASE_HOST' in config
  database: {
    host: get('DATABASE_HOST').string()
  },
  
  // With transformations
  maxRetries: get('MAX_RETRIES').string().transform(Number),
  
  // With validation
  email: get('ADMIN_EMAIL').string().email(),
  
  // With defaults
  logLevel: get('LOG_LEVEL').string().default('info'),
  
  // Optional values
  debugMode: get('DEBUG').string().optional()
}));
```

## Error Handling

### Validation Errors

When validation fails, the parser throws a `ZodError` containing all validation failures:

```typescript
import { z } from 'zod';

try {
  const config = parser.create((get) => ({
    port: get('PORT').string().transform(Number),
    apiKey: get('API_KEY').string().min(32),
    email: get('ADMIN_EMAIL').string().email()
  })).parse();
} catch (error) {
  if (error instanceof z.ZodError) {
    // error.errors is an array of all validation errors
    error.errors.forEach(err => {
      console.error(`${err.path.join('.')}: ${err.message}`);
    });
    
    // Example output:
    // port: Expected string, received undefined
    // apiKey: String must contain at least 32 character(s)
    // email: Invalid email
  }
}
```

### Error Aggregation

The parser collects all validation errors before throwing, allowing you to see all configuration problems at once:

```typescript
// If multiple values are invalid, all errors are reported together
const config = parser.create((get) => ({
  database: {
    host: get('DB_HOST').string(),        // Missing
    port: get('DB_PORT').string(),        // Missing
    name: get('DB_NAME').string()         // Missing
  },
  api: {
    key: get('API_KEY').string(),         // Missing
    url: get('API_URL').url()             // Invalid format
  }
}));

// Throws ZodError with all 5 validation errors
```

## Path Resolution

The parser uses lodash's `get` and `set` functions for path resolution:

### Simple Paths
```typescript
// Configuration object
const config = {
  PORT: '3000',
  API_KEY: 'secret'
};

// Access with get()
get('PORT')     // Looks for config.PORT
get('API_KEY')  // Looks for config.API_KEY
```

### Nested Objects
```typescript
// Configuration object
const config = {
  database: {
    host: 'localhost',
    port: '5432'
  }
};

// Access with get()
get('database.host')  // Returns 'localhost'
get('database.port')  // Returns '5432'
```

### Environment Variable Mapping
When using `process.env`, nested paths are automatically mapped:

```typescript
// These environment variables:
// DATABASE_HOST=localhost
// DATABASE_PORT=5432

// Can be accessed as:
const config = parser.create((get) => ({
  database: {
    host: get('DATABASE_HOST').string(),    // Maps to DATABASE_HOST
    port: get('DATABASE_PORT').string()     // Maps to DATABASE_PORT
  }
}));
```

## Zod Schema Integration

The parser returns Zod schemas, allowing you to use all Zod validation features:

### Transformations
```typescript
get('PORT').string().transform(Number)
get('ENABLED').string().transform(v => v === 'true')
get('TAGS').string().transform(v => v.split(','))
```

### Validations
```typescript
get('EMAIL').string().email()
get('URL').string().url()
get('PORT').string().transform(Number).int().min(1).max(65535)
get('NODE_ENV').enum(['development', 'production', 'test'])
```

### Refinements
```typescript
get('PASSWORD')
  .string()
  .min(8)
  .refine(password => /[A-Z]/.test(password), {
    message: 'Password must contain at least one uppercase letter'
  })
```

### Complex Types
```typescript
// Arrays
get('ALLOWED_ORIGINS')
  .string()
  .transform(v => v.split(','))
  .pipe(z.array(z.string().url()))

// Objects
get('CONFIG_JSON')
  .string()
  .transform(v => JSON.parse(v))
  .pipe(z.object({
    timeout: z.number(),
    retries: z.number()
  }))
```

## TypeScript Integration

The parser provides full type inference:

```typescript
const parser = new EnvironmentParser(process.env);

const config = parser.create((get) => ({
  server: {
    port: get('PORT').string().transform(Number),
    host: get('HOST').string().default('localhost')
  },
  features: {
    auth: get('FEATURE_AUTH').string().transform(v => v === 'true'),
    rateLimit: get('FEATURE_RATE_LIMIT').string().transform(v => v === 'true')
  }
}));

const parsed = config.parse();

// TypeScript knows:
// parsed.server.port: number
// parsed.server.host: string
// parsed.features.auth: boolean
// parsed.features.rateLimit: boolean
```

The types are automatically inferred from the Zod schemas, providing complete type safety without manual type definitions.