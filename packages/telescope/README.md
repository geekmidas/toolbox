# @geekmidas/telescope

Laravel Telescope-style debugging and monitoring for web applications. Capture and inspect HTTP requests, exceptions, and logs in real-time.

**Framework-agnostic core** with adapters for Hono, AWS Lambda, and more.

## Installation

```bash
pnpm add @geekmidas/telescope
```

## Quick Start

### With Hono

```typescript
import { Hono } from 'hono';
import { Telescope, InMemoryStorage } from '@geekmidas/telescope';
import { createMiddleware, createUI } from '@geekmidas/telescope/server/hono';

const telescope = new Telescope({
  storage: new InMemoryStorage(),
});

const app = new Hono();

// Add middleware to capture requests
app.use('*', createMiddleware(telescope));

// Mount the dashboard
app.route('/__telescope', createUI(telescope));

// Your routes
app.get('/users', (c) => c.json({ users: [] }));

export default app;
```

Visit `http://localhost:3000/__telescope` to view the dashboard.

### Framework-Agnostic Core

The core `Telescope` class is framework-agnostic. You can use it directly for manual recording:

```typescript
import { Telescope, InMemoryStorage } from '@geekmidas/telescope';

const telescope = new Telescope({
  storage: new InMemoryStorage(),
});

// Record a request manually
await telescope.recordRequest({
  method: 'POST',
  path: '/api/users',
  url: 'http://localhost:3000/api/users',
  headers: { 'content-type': 'application/json' },
  body: { name: 'John' },
  query: {},
  status: 201,
  responseHeaders: {},
  responseBody: { id: '123' },
  duration: 45.2,
});

// Log messages
await telescope.log('info', 'User created', { userId: '123' });

// Record exceptions
try {
  throw new Error('Something went wrong');
} catch (error) {
  await telescope.exception(error);
}
```

## Features

- **Request Recording**: Capture HTTP requests with headers, body, query params, and response
- **Exception Tracking**: Record exceptions with stack traces and source context
- **Log Aggregation**: Collect application logs with context
- **Real-time Updates**: WebSocket-powered live dashboard
- **Storage Agnostic**: Use in-memory for dev, database for production
- **Hono Integration**: First-class middleware and route mounting
- **Lambda Integration**: Wrapper and Middy middleware for AWS Lambda with auto-flush

## Configuration

```typescript
const telescope = new Telescope({
  // Required: Storage backend
  storage: new InMemoryStorage(),

  // Optional: Enable/disable telescope (default: true)
  enabled: true,

  // Optional: Dashboard path (default: '/__telescope')
  path: '/__telescope',

  // Optional: Record request/response bodies (default: true)
  recordBody: true,

  // Optional: Max body size to record in bytes (default: 64KB)
  maxBodySize: 64 * 1024,

  // Optional: URL patterns to ignore
  ignorePatterns: ['/health', '/metrics', '/__telescope/*'],

  // Optional: Auto-prune entries older than X hours
  pruneAfterHours: 24,

  // Optional: Redact sensitive data (see Redaction section)
  redact: true,
});
```

## Sensitive Data Redaction

Telescope can automatically redact sensitive data from recorded requests, responses, and logs using `@pinojs/redact`.

### Enable Redaction

```typescript
const telescope = new Telescope({
  storage: new InMemoryStorage(),

  // Enable with default paths
  redact: true,
});
```

### Default Redacted Paths

When `redact: true`, these paths are automatically redacted:

**Headers:**
- `headers.authorization`, `headers.cookie`, `headers.x-api-key`
- `responseHeaders.set-cookie`

**Request/Response Body:**
- `body.password`, `body.token`, `body.accessToken`, `body.refreshToken`
- `body.apiKey`, `body.secret`, `body.creditCard`, `body.cardNumber`, `body.cvv`, `body.ssn`
- `body.*.password`, `body.*.token`, `body.*.secret` (nested fields)
- Same patterns for `responseBody.*`

**Query Parameters:**
- `query.token`, `query.api_key`, `query.apiKey`, `query.access_token`, `query.secret`

**Log Context:**
- `context.password`, `context.token`, `context.secret`, `context.apiKey`

### Add Custom Paths

Provide an array to add paths (merged with defaults):

```typescript
const telescope = new Telescope({
  storage: new InMemoryStorage(),

  // Add custom paths to defaults
  redact: ['user.ssn', 'payment.cardNumber', 'data.*.privateKey'],
});
```

### Full Control

Use an object for complete control over redaction:

```typescript
const telescope = new Telescope({
  storage: new InMemoryStorage(),

  redact: {
    paths: ['headers.authorization', 'body.password'],
    censor: '***HIDDEN***', // Custom replacement (default: '[REDACTED]')
  },
});
```

### Path Syntax

Paths use dot notation with wildcard support:

| Pattern | Matches |
|---------|---------|
| `headers.authorization` | Exact path |
| `body.password` | Exact nested path |
| `body.*.password` | Any object with password field in body |
| `*.secret` | Secret field at any level |

### Programmatic Access

```typescript
import { createRedactor, DEFAULT_REDACT_PATHS } from '@geekmidas/telescope';

// Create a standalone redactor
const redactor = createRedactor(true);
const safeData = redactor({ headers: { authorization: 'Bearer secret' } });
// safeData.headers.authorization === '[REDACTED]'

// Access default paths
console.log(DEFAULT_REDACT_PATHS);
```

## Storage Backends

### InMemoryStorage

Best for development and testing. Data is lost on restart.

```typescript
// From main package
import { InMemoryStorage } from '@geekmidas/telescope';
// Or direct import
import { InMemoryStorage } from '@geekmidas/telescope/storage/memory';

const storage = new InMemoryStorage({
  maxEntries: 1000, // Max entries per type (default: 1000)
});
```

### KyselyStorage (Coming Soon)

For production use with database persistence.

```typescript
import { KyselyStorage } from '@geekmidas/telescope/storage/kysely';

const storage = new KyselyStorage(db, {
  tablePrefix: 'telescope_', // Table name prefix
});
```

### Custom Storage

Implement the `TelescopeStorage` interface:

```typescript
import type { TelescopeStorage } from '@geekmidas/telescope';

class MyStorage implements TelescopeStorage {
  async saveRequest(entry: RequestEntry): Promise<void> { /* ... */ }
  async getRequests(options?: QueryOptions): Promise<RequestEntry[]> { /* ... */ }
  async getRequest(id: string): Promise<RequestEntry | null> { /* ... */ }

  async saveException(entry: ExceptionEntry): Promise<void> { /* ... */ }
  async getExceptions(options?: QueryOptions): Promise<ExceptionEntry[]> { /* ... */ }
  async getException(id: string): Promise<ExceptionEntry | null> { /* ... */ }

  async saveLog(entry: LogEntry): Promise<void> { /* ... */ }
  async getLogs(options?: QueryOptions): Promise<LogEntry[]> { /* ... */ }

  async prune(olderThan: Date): Promise<number> { /* ... */ }
  async getStats(): Promise<TelescopeStats> { /* ... */ }
}
```

## API

### Telescope Class (Core)

#### `telescope.recordRequest(entry)`

Record a request entry programmatically.

```typescript
await telescope.recordRequest({
  method: 'GET',
  path: '/api/users',
  url: 'http://localhost:3000/api/users',
  headers: {},
  query: {},
  status: 200,
  responseHeaders: {},
  duration: 25.5,
});
```

#### `telescope.log(level, message, context?, requestId?)`

Record a log entry programmatically.

```typescript
await telescope.log('info', 'User logged in', { userId: '123' });
await telescope.log('error', 'Payment failed', { orderId: '456' });
```

#### `telescope.exception(error, requestId?)`

Record an exception programmatically.

```typescript
try {
  await riskyOperation();
} catch (error) {
  await telescope.exception(error);
  throw error;
}
```

#### `telescope.broadcast(event)`

Send a custom event to all connected WebSocket clients.

```typescript
telescope.broadcast({
  type: 'custom',
  payload: { message: 'Hello' },
  timestamp: Date.now(),
});
```

#### `telescope.prune(olderThan)`

Manually prune entries older than a date.

```typescript
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
const deleted = await telescope.prune(oneHourAgo);
console.log(`Pruned ${deleted} entries`);
```

#### `telescope.destroy()`

Clean up resources (intervals, WebSocket clients).

```typescript
telescope.destroy();
```

### Hono Adapter

Import from `@geekmidas/telescope/server/hono`:

```typescript
import { createMiddleware, createUI, setupWebSocket, getRequestId } from '@geekmidas/telescope/server/hono';
```

#### `createMiddleware(telescope)`

Returns Hono middleware that captures requests and responses.

```typescript
app.use('*', createMiddleware(telescope));
```

#### `createUI(telescope)`

Returns a Hono app with dashboard UI and API routes.

```typescript
app.route('/__telescope', createUI(telescope));
```

#### `setupWebSocket(app, telescope, upgradeWebSocket)`

Set up WebSocket routes for real-time updates.

```typescript
import { createNodeWebSocket } from '@hono/node-ws';

const { upgradeWebSocket } = createNodeWebSocket({ app });
setupWebSocket(createUI(telescope), telescope, upgradeWebSocket);
```

#### `getRequestId(c)`

Get the request ID from Hono context (set by middleware).

```typescript
app.get('/api/data', (c) => {
  const requestId = getRequestId(c);
  // Use requestId for correlated logging
  telescope.log('info', 'Processing request', { data: 'value' }, requestId);
  return c.json({ success: true });
});
```

### Lambda Adapter

Import from `@geekmidas/telescope/adapters/lambda`:

```typescript
import { wrapLambdaHandler, LambdaAdapter } from '@geekmidas/telescope/adapters/lambda';
```

#### `wrapLambdaHandler(telescope, handler, options?)`

Wrap a Lambda handler to automatically record requests and flush telemetry before the Lambda context freezes.

```typescript
import { Telescope, InMemoryStorage } from '@geekmidas/telescope';
import { wrapLambdaHandler } from '@geekmidas/telescope/adapters/lambda';

const telescope = new Telescope({ storage: new InMemoryStorage() });

export const handler = wrapLambdaHandler(telescope, async (event, context) => {
  // Your Lambda logic here
  return { statusCode: 200, body: JSON.stringify({ success: true }) };
});
```

Supports API Gateway v1 (REST API), API Gateway v2 (HTTP API), and ALB events. For non-HTTP invocations, records the event as the request body.

#### Options

```typescript
wrapLambdaHandler(telescope, handler, {
  // Auto-flush telemetry before Lambda freezes (default: true)
  autoFlush: true,

  // Detect Lambda resource attributes from environment (default: true)
  detectResource: true,
});
```

#### `LambdaAdapter` Class

For more control, use the `LambdaAdapter` class directly:

```typescript
import { Telescope, InMemoryStorage } from '@geekmidas/telescope';
import { LambdaAdapter } from '@geekmidas/telescope/adapters/lambda';

const telescope = new Telescope({ storage: new InMemoryStorage() });
const adapter = new LambdaAdapter(telescope);

export const handler = async (event, context) => {
  const requestContext = adapter.extractRequestContext(event);

  try {
    const result = await processEvent(event);

    const responseContext = adapter.extractResponseContext(result, requestContext.startTime);
    await telescope.recordRequest({
      method: requestContext.method,
      path: requestContext.path,
      url: requestContext.url,
      headers: requestContext.headers,
      query: requestContext.query,
      body: requestContext.body,
      ip: requestContext.ip,
      status: responseContext.status,
      responseHeaders: responseContext.headers,
      responseBody: responseContext.body,
      duration: responseContext.duration,
    });

    return result;
  } catch (error) {
    await telescope.exception(error, requestContext.id);
    throw error;
  } finally {
    await adapter.flush();
  }
};
```

#### Middy Middleware

For use with the Middy middleware framework:

```typescript
import middy from '@middy/core';
import { Telescope, InMemoryStorage } from '@geekmidas/telescope';
import { telescopeMiddleware } from '@geekmidas/telescope/adapters/lambda';

const telescope = new Telescope({ storage: new InMemoryStorage() });

export const handler = middy(async (event, context) => {
  return { statusCode: 200, body: JSON.stringify({ success: true }) };
}).use(telescopeMiddleware({ telescope }));
```

### Logger Integrations

Telescope integrates with existing logging libraries so you don't need to change your application code.

#### Pino Transport

Use with Pino's multistream to send logs to both stdout and Telescope:

```typescript
import pino from 'pino';
import { Telescope, InMemoryStorage } from '@geekmidas/telescope';
import { createPinoDestination } from '@geekmidas/telescope/logger/pino';

const telescope = new Telescope({ storage: new InMemoryStorage() });

const logger = pino(
  { level: 'debug' },
  pino.multistream([
    { stream: process.stdout },
    { stream: createPinoDestination({ telescope }) }
  ])
);

// Logs go to both console and Telescope
logger.info({ userId: '123' }, 'User logged in');
```

#### TelescopeLogger (ConsoleLogger wrapper)

Wraps any Logger interface and forwards logs to Telescope:

```typescript
import { Telescope, InMemoryStorage } from '@geekmidas/telescope';
import { TelescopeLogger, createTelescopeLogger } from '@geekmidas/telescope/logger/console';
import { ConsoleLogger } from '@geekmidas/logger/console';

const telescope = new Telescope({ storage: new InMemoryStorage() });

// Option 1: Using the class
const logger = new TelescopeLogger({
  telescope,
  logger: new ConsoleLogger({ app: 'myApp' }),
});

// Option 2: Using the factory function
const logger = createTelescopeLogger(telescope, new ConsoleLogger());

// Logs go to both console and Telescope
logger.info({ action: 'startup' }, 'Application started');

// Create child loggers with context
const authLogger = logger.child({ module: 'auth' });
authLogger.debug({ userId: '123' }, 'User authenticated');

// Bind to a request ID for correlation
const requestLogger = logger.withRequestId('req-abc123');
requestLogger.info('Processing request');
```

## Dashboard API

The dashboard UI is served at the configured path. It also exposes a REST API:

| Endpoint | Description |
|----------|-------------|
| `GET /api/requests` | List requests |
| `GET /api/requests/:id` | Get request details |
| `GET /api/exceptions` | List exceptions |
| `GET /api/exceptions/:id` | Get exception details |
| `GET /api/logs` | List logs |
| `GET /api/stats` | Get storage statistics |

### Query Parameters

All list endpoints support:

- `limit` - Number of entries (default: 50, max: 100)
- `offset` - Pagination offset (default: 0)
- `search` - Full-text search
- `before` - Entries before date (ISO string)
- `after` - Entries after date (ISO string)
- `tags` - Comma-separated tags filter

Example:
```
GET /__telescope/api/requests?limit=20&search=POST&after=2024-01-01
```

## WebSocket

Connect to `/__telescope/ws` for real-time updates:

```typescript
const ws = new WebSocket('ws://localhost:3000/__telescope/ws');

ws.onmessage = (event) => {
  const { type, payload, timestamp } = JSON.parse(event.data);

  switch (type) {
    case 'request':
      console.log('New request:', payload);
      break;
    case 'exception':
      console.log('New exception:', payload);
      break;
    case 'log':
      console.log('New log:', payload);
      break;
    case 'connected':
      console.log('Connected, clients:', payload.clientCount);
      break;
  }
};
```

## Types

### RequestEntry

```typescript
interface RequestEntry {
  id: string;
  method: string;
  path: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
  status: number;
  responseHeaders: Record<string, string>;
  responseBody?: unknown;
  duration: number;
  timestamp: Date;
  ip?: string;
  userId?: string;
  tags?: string[];
}
```

### ExceptionEntry

```typescript
interface ExceptionEntry {
  id: string;
  name: string;
  message: string;
  stack: StackFrame[];
  source?: SourceContext;
  requestId?: string;
  timestamp: Date;
  handled: boolean;
  tags?: string[];
}
```

### LogEntry

```typescript
interface LogEntry {
  id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown>;
  requestId?: string;
  timestamp: Date;
}
```

## Integration with gkm dev

When using `gkm dev`, Telescope is automatically integrated:

```bash
gkm dev --port 3000

# Output:
# API:        http://localhost:3000
# Telescope:  http://localhost:3000/__telescope
```

Configure in `gkm.config.ts`:

```typescript
export default {
  routes: './src/endpoints/**/*.ts',
  envParser: './src/config/env',
  logger: './src/logger',

  dev: {
    telescope: {
      enabled: true,
      path: '/__telescope',
    },
  },
};
```

## Best Practices

1. **Disable in Production**: Use environment variables to disable Telescope in production
   ```typescript
   const telescope = new Telescope({
     storage: new InMemoryStorage(),
     enabled: process.env.NODE_ENV === 'development',
   });
   ```

2. **Ignore Health Checks**: Exclude noisy endpoints
   ```typescript
   ignorePatterns: ['/health', '/ready', '/metrics']
   ```

3. **Limit Body Size**: Prevent memory issues with large payloads
   ```typescript
   maxBodySize: 32 * 1024 // 32KB
   ```

4. **Auto-Prune**: Enable automatic cleanup for long-running dev sessions
   ```typescript
   pruneAfterHours: 4
   ```

5. **Use Database Storage in Staging**: For debugging issues in staging environments
   ```typescript
   const storage = process.env.NODE_ENV === 'production'
     ? null // Disabled
     : process.env.NODE_ENV === 'staging'
       ? new KyselyStorage(db)
       : new InMemoryStorage();
   ```

## License

MIT
