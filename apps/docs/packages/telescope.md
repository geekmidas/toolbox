# @geekmidas/telescope

Laravel Telescope-style debugging and monitoring dashboard for web applications. Captures requests, logs, and exceptions in real-time with a beautiful dashboard UI.

## Installation

```bash
pnpm add @geekmidas/telescope
```

## Features

- Request recording with headers, body, query params, and response
- Exception tracking with stack traces and source context
- Log aggregation with context and request correlation
- Real-time WebSocket updates
- Metrics aggregation with time-series data
- Sensitive data redaction
- Multiple storage backends (in-memory, Kysely/PostgreSQL)
- Framework adapters (Hono, Lambda)
- Logger integrations (Pino, ConsoleLogger)
- Auto-pruning of old entries

## Package Exports

| Export | Description |
|--------|-------------|
| `/` | Core `Telescope` class and `InMemoryStorage` |
| `/hono` | Hono middleware and dashboard UI |
| `/storage/memory` | In-memory storage (development) |
| `/storage/kysely` | Kysely storage (PostgreSQL, MySQL, SQLite) |
| `/logger/pino` | Pino transport for log capture |
| `/logger/console` | TelescopeLogger for ConsoleLogger |
| `/lambda` | AWS Lambda adapter and Middy middleware |
| `/core` | Core utilities and flush functions |
| `/metrics` | MetricsAggregator for analytics |
| `/otlp` | OpenTelemetry receiver |
| `/instrumentation` | OpenTelemetry setup utilities |

## Quick Start with Hono

```typescript
import { Hono } from 'hono';
import { Telescope, InMemoryStorage } from '@geekmidas/telescope';
import { createMiddleware, createUI } from '@geekmidas/telescope/hono';

// Create Telescope instance
const telescope = new Telescope({
  storage: new InMemoryStorage(),
  enabled: process.env.NODE_ENV === 'development',
});

const app = new Hono();

// Add middleware to capture requests
app.use('*', createMiddleware(telescope));

// Mount the dashboard
app.route('/__telescope', createUI(telescope));

// Your routes
app.get('/api/users', (c) => c.json({ users: [] }));

export default app;

// Access dashboard at http://localhost:3000/__telescope
```

## Using with `gkm dev`

The CLI automatically integrates Telescope when enabled in your config:

```typescript
// gkm.config.ts
export default {
  routes: './src/endpoints/**/*.ts',
  envParser: './src/config/env',
  logger: './src/logger',
  telescope: {
    enabled: true,
    path: '/__telescope',
  },
};
```

Run `gkm dev` and access the dashboard at `http://localhost:3000/__telescope`.

## Storage Backends

### In-Memory Storage (Development)

```typescript
import { InMemoryStorage } from '@geekmidas/telescope/storage/memory';

const storage = new InMemoryStorage({
  maxRequests: 1000, // Max stored requests
  maxLogs: 5000,     // Max stored logs
  maxExceptions: 500 // Max stored exceptions
});
```

### Kysely Storage (Production)

```typescript
import { KyselyStorage } from '@geekmidas/telescope/storage/kysely';
import { db } from './database';

const storage = new KyselyStorage({
  db,
  tablePrefix: 'telescope', // Creates telescope_requests, telescope_logs, telescope_exceptions
});

const telescope = new Telescope({ storage });
```

Required database tables:

```sql
CREATE TABLE telescope_requests (
  id VARCHAR(21) PRIMARY KEY,
  method VARCHAR(10) NOT NULL,
  path VARCHAR(2048) NOT NULL,
  url VARCHAR(4096) NOT NULL,
  headers JSONB NOT NULL,
  body JSONB,
  query JSONB,
  status INTEGER NOT NULL,
  response_headers JSONB NOT NULL,
  response_body JSONB,
  duration INTEGER NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  ip VARCHAR(45),
  user_id VARCHAR(255),
  tags JSONB
);

CREATE TABLE telescope_logs (
  id VARCHAR(21) PRIMARY KEY,
  level VARCHAR(10) NOT NULL,
  message TEXT NOT NULL,
  context JSONB,
  request_id VARCHAR(21),
  timestamp TIMESTAMPTZ NOT NULL
);

CREATE TABLE telescope_exceptions (
  id VARCHAR(21) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  stack JSONB NOT NULL,
  source JSONB,
  request_id VARCHAR(21),
  timestamp TIMESTAMPTZ NOT NULL,
  handled BOOLEAN DEFAULT false,
  tags JSONB
);

-- Indexes for performance
CREATE INDEX idx_telescope_requests_timestamp ON telescope_requests(timestamp DESC);
CREATE INDEX idx_telescope_logs_timestamp ON telescope_logs(timestamp DESC);
CREATE INDEX idx_telescope_logs_request_id ON telescope_logs(request_id);
CREATE INDEX idx_telescope_exceptions_timestamp ON telescope_exceptions(timestamp DESC);
```

## Logger Integrations

### Pino Transport

Send Pino logs to both stdout and Telescope:

```typescript
import pino from 'pino';
import { Telescope, InMemoryStorage } from '@geekmidas/telescope';
import { createPinoTransport } from '@geekmidas/telescope/logger/pino';

const telescope = new Telescope({ storage: new InMemoryStorage() });

const logger = pino(
  { level: 'debug' },
  pino.multistream([
    { stream: process.stdout },
    { stream: createPinoTransport({ telescope }) },
  ])
);

// Logs appear in both console and Telescope dashboard
logger.info({ userId: '123' }, 'User logged in');
```

With request ID correlation:

```typescript
const logger = pino(
  { level: 'debug' },
  pino.multistream([
    { stream: process.stdout },
    {
      stream: createPinoTransport({
        telescope,
        requestId: (log) => log.reqId, // Extract from log context
      }),
    },
  ])
);
```

### ConsoleLogger Integration

Wrap `@geekmidas/logger` ConsoleLogger:

```typescript
import { Telescope, InMemoryStorage } from '@geekmidas/telescope';
import { TelescopeLogger } from '@geekmidas/telescope/logger/console';
import { ConsoleLogger } from '@geekmidas/logger/console';

const telescope = new Telescope({ storage: new InMemoryStorage() });

// Logs to both console and Telescope
const logger = new TelescopeLogger({
  telescope,
  logger: new ConsoleLogger({ app: 'myApp' }),
});

logger.info({ action: 'startup' }, 'Application started');

// Bind to request ID for correlation
const requestLogger = logger.child({ requestId: 'req-abc123' });
requestLogger.info('Processing request');
```

## Lambda Integration

### Using Middy Middleware

For `@geekmidas/constructs` endpoints:

```typescript
import { telescopeMiddleware } from '@geekmidas/telescope/lambda';
import { AmazonApiGatewayV2Endpoint } from '@geekmidas/constructs/endpoints';
import { Telescope, InMemoryStorage } from '@geekmidas/telescope';

const telescope = new Telescope({
  storage: new InMemoryStorage(),
  enabled: true,
});

const adaptor = new AmazonApiGatewayV2Endpoint(envParser, endpoint, {
  telescope: {
    middleware: telescopeMiddleware(telescope),
  },
});

export const handler = adaptor.handler;
```

### Wrapping Lambda Handlers Directly

```typescript
import { wrapLambdaHandler } from '@geekmidas/telescope/lambda';
import { Telescope, InMemoryStorage } from '@geekmidas/telescope';

const telescope = new Telescope({ storage: new InMemoryStorage() });

export const handler = wrapLambdaHandler(
  telescope,
  async (event, context) => {
    // Your Lambda logic
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  },
  { autoFlush: true }
);
```

### Using createTelescopeHandler

```typescript
import { createTelescopeHandler } from '@geekmidas/telescope/lambda';

export const handler = createTelescopeHandler(
  telescope,
  async (event, context) => {
    return { statusCode: 200, body: 'OK' };
  },
  {
    recordBody: true,      // Record request/response bodies
    flushThresholdMs: 1000, // Leave 1s buffer before Lambda timeout
    flushTimeoutMs: 5000,   // Max flush wait time
  }
);
```

## Configuration Options

```typescript
const telescope = new Telescope({
  // Required: Storage backend
  storage: new InMemoryStorage(),

  // Enable/disable recording (default: true)
  enabled: process.env.NODE_ENV === 'development',

  // Record request/response bodies (default: true)
  recordBody: true,

  // Paths to ignore (supports wildcards)
  ignorePatterns: [
    '/health',
    '/metrics',
    '/__telescope/*',
    '/favicon.ico',
  ],

  // Auto-prune entries older than N hours
  pruneAfterHours: 24,

  // Sensitive data redaction
  redact: {
    paths: [
      'headers.authorization',
      'headers.cookie',
      'body.password',
      'body.*.secret',
      'responseBody.token',
    ],
  },

  // Metrics configuration
  metrics: {
    bucketSizeMs: 60000,     // 1-minute buckets
    maxBuckets: 60,          // Keep 1 hour of metrics
    percentiles: [50, 90, 99],
  },
});
```

## Recording Data Manually

```typescript
// Record a request
const requestId = await telescope.recordRequest({
  method: 'POST',
  path: '/api/users',
  url: 'http://localhost/api/users',
  headers: { 'content-type': 'application/json' },
  query: {},
  body: { name: 'John' },
  status: 201,
  responseHeaders: { 'content-type': 'application/json' },
  responseBody: { id: '123', name: 'John' },
  duration: 45,
  ip: '192.168.1.1',
});

// Record logs
await telescope.info({ userId: '123' }, 'User created');
await telescope.warn({ attempts: 3 }, 'Rate limit approaching');
await telescope.error({ error: 'DB timeout' }, 'Failed to save');

// Record exception
try {
  throw new Error('Something went wrong');
} catch (error) {
  await telescope.exception(error, requestId);
}

// Batch log entries
await telescope.log([
  { level: 'info', message: 'Step 1 complete' },
  { level: 'info', message: 'Step 2 complete' },
  { level: 'debug', message: 'Processing details', context: { items: 100 } },
]);
```

## Querying Data

```typescript
// Get recent requests
const requests = await telescope.getRequests({
  limit: 50,
  offset: 0,
});

// Get logs for a specific request
const logs = await telescope.getLogs({
  requestId: 'abc123',
});

// Get exceptions
const exceptions = await telescope.getExceptions({
  limit: 20,
});

// Get a specific request with full details
const request = await telescope.getRequest('request-id');

// Get statistics
const stats = await telescope.getStats();
// { requests: 1000, logs: 5000, exceptions: 10 }
```

## Metrics and Analytics

```typescript
// Get endpoint metrics
const metrics = await telescope.getEndpointMetrics({
  timeRange: 'hour', // 'hour' | 'day' | 'week'
});

// Returns per-endpoint statistics:
// {
//   '/api/users': {
//     count: 150,
//     avgDuration: 45,
//     p50: 40,
//     p90: 80,
//     p99: 150,
//     statusDistribution: { '200': 140, '400': 8, '500': 2 }
//   }
// }
```

## Real-Time WebSocket Updates

The dashboard uses WebSocket for real-time updates. You can also subscribe programmatically:

```typescript
// Add WebSocket client for broadcasts
telescope.addWsClient(websocket);

// Remove client
telescope.removeWsClient(websocket);

// Manual broadcast
telescope.broadcast({
  type: 'request',
  payload: requestEntry,
  timestamp: Date.now(),
});
```

## Pruning Old Data

```typescript
// Manual prune - delete entries older than date
const deletedCount = await telescope.prune(new Date('2024-01-01'));

// Auto-prune is configured via pruneAfterHours option
const telescope = new Telescope({
  storage,
  pruneAfterHours: 24, // Auto-prune entries older than 24 hours
});
```

## Cleanup

```typescript
// Destroy telescope instance (clears intervals, etc.)
telescope.destroy();
```

## Integration with @geekmidas/constructs

Telescope integrates seamlessly with the constructs package for Lambda endpoints:

```typescript
import { e, EndpointFactory } from '@geekmidas/constructs/endpoints';
import { AmazonApiGatewayV2Endpoint } from '@geekmidas/constructs/endpoints';
import { telescopeMiddleware } from '@geekmidas/telescope/lambda';
import { Telescope, InMemoryStorage } from '@geekmidas/telescope';

// Create telescope instance
const telescope = new Telescope({
  storage: new InMemoryStorage(),
});

// Define endpoint
const getUsers = e
  .get('/users')
  .output(UsersSchema)
  .handle(async ({ logger }) => {
    logger.info('Fetching users');
    return { users: [] };
  });

// Create Lambda handler with Telescope
const adaptor = new AmazonApiGatewayV2Endpoint(envParser, getUsers, {
  telescope: {
    middleware: telescopeMiddleware(telescope, {
      recordBody: true,
      flushThresholdMs: 1000,
    }),
  },
});

export const handler = adaptor.handler;
```
