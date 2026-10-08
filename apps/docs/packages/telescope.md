# @geekmidas/telescope

Laravel Telescope-style debugging and monitoring for web applications. Captures requests, logs and exceptions, and serves them as a JSON API with a WebSocket feed for live updates.

::: info Headless
Telescope ships no dashboard. It records, stores and serves data; any UI —
your own, a script, an agent — is built on the JSON API below. (The embedded
React dashboard was removed in v10.)
:::

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
| `/hono` | Hono middleware and JSON API (alias for `/server/hono`) |
| `/server/hono` | Hono middleware and JSON API (`createMiddleware`, `createApi`, `setupWebSocket`) |
| `/storage/memory` | In-memory storage (development) |
| `/storage/kysely` | Kysely storage (PostgreSQL, MySQL, SQLite) |
| `/logger/pino` | Pino transport for log capture (`createPinoTransport`) |
| `/logger/console` | `TelescopeLogger` for ConsoleLogger |
| `/lambda` | AWS Lambda adapter and Middy middleware |
| `/core` | Core utilities and flush functions |
| `/metrics` | `MetricsAggregator` for analytics |
| `/otlp` | OpenTelemetry receiver |
| `/otlp/hono` | OpenTelemetry Hono middleware |
| `/instrumentation` | OpenTelemetry setup utilities |
| `/instrumentation/hono` | OpenTelemetry Hono instrumentation |

## Quick Start with Hono

```typescript
import { Hono } from 'hono';
import { Telescope, InMemoryStorage } from '@geekmidas/telescope';
import { createApi, createMiddleware } from '@geekmidas/telescope/hono';

// Create Telescope instance
const telescope = new Telescope({
  storage: new InMemoryStorage(),
  enabled: process.env.NODE_ENV === 'development',
});

const app = new Hono();

// Add middleware to capture requests
app.use('*', createMiddleware(telescope));

// Mount the JSON API
app.route('/__telescope', createApi(telescope));

// Your routes
app.get('/api/users', (c) => c.json({ users: [] }));

export default app;

// GET http://localhost:3000/__telescope/api/requests
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

Run `gkm dev` and read the data from `http://localhost:3000/__telescope/api/*`.

## JSON API

| Route | Returns |
|-------|---------|
| `GET /api/requests` | Recorded requests (`limit`, `offset`, `search`, `method`, `status`, `before`, `after`, `tags`) |
| `GET /api/requests/:id` | One request |
| `GET /api/exceptions` | Recorded exceptions |
| `GET /api/exceptions/:id` | One exception |
| `GET /api/logs` | Log entries (`level`, …) |
| `GET /api/stats` | Counts per kind |
| `GET /api/metrics` | Aggregated request metrics (`start`, `end`, `bucketSize`) |
| `GET /api/metrics/endpoints` | Metrics per endpoint |
| `GET /api/metrics/endpoint?method=&path=` | One endpoint's metrics |
| `GET /api/metrics/status` | Status code distribution |
| `DELETE /api/metrics` | Reset metrics |

Paths are relative to where `createApi` is mounted (`/__telescope` under `gkm dev`).

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

const storage = new KyselyStorage({ db });

const telescope = new Telescope({ storage });
```

The tables are `requests`, `logs` and `exceptions` — unqualified, and
deliberately. They used to carry a `telescope_` prefix, which is what you reach
for when the tables have to share a schema with an application's own. They do
not: a telescope derived from a database is a schema tenant with a role whose
`search_path` is pinned to it, so an unqualified name already resolves there,
and `DROP SCHEMA telescope CASCADE` is the whole cleanup.

Pass `schema` only when the connection is *not* pinned — a shared pool, or a
migration run as an owner whose `search_path` finds `public` first:

```typescript
const storage = new KyselyStorage({ db, schema: 'telescope' });
```

Required tables:

```sql
CREATE TABLE requests (
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

CREATE TABLE logs (
  id VARCHAR(21) PRIMARY KEY,
  level VARCHAR(10) NOT NULL,
  message TEXT NOT NULL,
  context JSONB,
  request_id VARCHAR(21),
  timestamp TIMESTAMPTZ NOT NULL
);

CREATE TABLE exceptions (
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
CREATE INDEX idx_requests_timestamp ON requests(timestamp DESC);
CREATE INDEX idx_logs_timestamp ON logs(timestamp DESC);
CREATE INDEX idx_logs_request_id ON logs(request_id);
CREATE INDEX idx_exceptions_timestamp ON exceptions(timestamp DESC);
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

// Logs appear in both the console and Telescope
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

Live updates come over a WebSocket. Subscribe programmatically:

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

## Production: OpenTelemetry

Production builds (`gkm build --production`, which `gkm docker` images run)
leave the Telescope dashboard out. In its place, the generated server entry
starts OpenTelemetry when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, before the app
is imported, so traces and logs go to your collector with no code in the app.

Install the instrumentation's optional peers in the app, then rebuild:

```bash
pnpm add @geekmidas/telescope @opentelemetry/api @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-logs-otlp-http @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/instrumentation-pino @opentelemetry/resources @opentelemetry/sdk-logs \
  @opentelemetry/sdk-node @opentelemetry/sdk-trace-base @opentelemetry/sdk-trace-node \
  @opentelemetry/semantic-conventions
```

| Variable | Effect |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Turns telemetry on. The collector's base URL; traces go to `/v1/traces`, logs to `/v1/logs`. Unset, the entry never loads the packages. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Headers for the collector, e.g. `authorization=Bearer …`. |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | Sampling, e.g. `parentbased_traceidratio` and `0.1` to keep one trace in ten. Every trace is kept by default. |
| `OTEL_RESOURCE_ATTRIBUTES` | Extra resource attributes, and overrides — e.g. `service.version=1.4.2` for the release. |
| `OTEL_SERVICE_NAME` | Overrides `service.name`. |
| `STAGE` | Sent as `deployment.environment.name` (and `deployment.environment`). `gkm deploy` sets it. |

The entry names the resource for you:

- `service.name`: the `RestApi` the server serves (its id), or the app's directory without one.
- `service.namespace`: the workspace's name.
- `deployment.environment.name`: `STAGE`.

An app built without the packages still builds and starts: its entry imports
none of them, and if `OTEL_EXPORTER_OTLP_ENDPOINT` is set it prints a
`TelemetryUnavailable` warning saying so. The same warning, and no crash, if the
packages fail to load at runtime.

::: tip Bundled builds
The production bundle inlines the app's dependencies, and OpenTelemetry's
auto-instrumentation patches modules as Node loads them — so in a bundle it
reaches Node built-ins (`http`, `fetch`), not the inlined libraries. Spans for
incoming and outgoing HTTP are there; library spans and Pino's `trace_id` /
`span_id` correlation are not guaranteed.
:::

### Calling `setupTelemetry` yourself

```typescript
import { setupTelemetry } from '@geekmidas/telescope/instrumentation';

setupTelemetry({
  serviceName: 'orders-api',
  serviceNamespace: 'shop',
  deploymentEnvironment: process.env.STAGE,
  // Omit `endpoint` to use the OTEL_EXPORTER_OTLP_* variables.
  sampleRatio: 0.1, // overrides OTEL_TRACES_SAMPLER; must be 0–1
  handleSignals: false, // leave SIGTERM to your own graceful shutdown
});
```

`sampleRatio` keeps that fraction of new traces and makes child spans follow
their parent. A value outside 0–1 throws `InvalidSampleRatio`.

### Sampling: the stage's rate is a cap

`setupTelemetry` samples with `traceSampler(rate)` — from `sampleRatio`, or from
`OTEL_TRACES_SAMPLER=parentbased_traceidratio` and `OTEL_TRACES_SAMPLER_ARG`.
It is `parentbased_traceidratio` with one change: a **remote** parent's sampled
flag is a request, not an order.

| Parent | Decision |
| --- | --- |
| none (a new trace) | the rate, from the trace id |
| remote, sampled | the rate again — a caller cannot force 100% |
| remote, not sampled | not sampled — a caller may ask for less |
| local (this process) | the parent's decision |

The rate is applied to the trace id (`TraceIdRatioBasedSampler`), so every
service at the same rate makes the same decision for the same trace, and a
trace kept where it started is kept at every hop. The generated API client
decides a page view's sampled flag by the same rule.

### Whose trace context is continued

An incoming `traceparent` is a claim made by the caller. Continued, it puts the
request's span inside a trace the caller chose, and its sampled flag asks this
API to record it. So `honoTelemetryMiddleware` continues it only from a
**trusted** caller:

- **The API's own sites.** An `Origin` header naming one of `trustedOrigins` —
  exactly, scheme, host and port. A built server passes the origins its CORS
  allows: the sites with an edge to the API (`<ID>_TRUSTED_ORIGINS`). A
  browser sets `Origin` itself on every cross-origin request, and a page
  cannot forge it. A wildcard trusts nothing.
- **An internal caller.** No `Origin`, no header a proxy adds on the way in
  (`X-Forwarded-For`, `Forwarded`, `X-Real-IP`, `CF-Connecting-IP`, …), and a
  TCP peer on a loopback or private address (`127/8`, `10/8`, `172.16/12`,
  `192.168/16`, `169.254/16`, `::1`, `fc00::/7`, `fe80::/10`). That is another
  service calling this one by its internal URL on the private network: a
  request from outside reaches the API through the stack's proxy, which adds
  `X-Forwarded-For`, or from a public address. The peer address is read from
  `@hono/node-server`'s socket; a request handed to the app in-process has
  none, and is not internal. `internalCallers: false` turns this off;
  a function decides it yourself.

Anyone else — an origin that is not the API's, a request with no origin that
came through the proxy — gets a **new trace**, with a **link** to the context
it claimed (`gkm.trace.untrusted_parent: true`), so the hop can still be
followed without the caller choosing the trace. Its baggage is dropped.

```typescript
import { honoTelemetryMiddleware } from '@geekmidas/telescope/instrumentation';

app.use(
  '*',
  honoTelemetryMiddleware({
    trustedOrigins: ['https://shop.example.com'], // or () => origins
    internalCallers: true, // the default: private network, no proxy, no Origin
  }),
);
```

A trusted caller's sampled flag is still capped by the [stage's
rate](#sampling-the-stage-s-rate-is-a-cap). Messages a worker receives from the
broker do not come over HTTP, and are not subject to these rules.

::: warning Published ports
The internal rule trusts the network, not a secret. An API port published
straight to the internet with Docker's userland proxy can see a private peer
address for outside traffic; publish the API only through the stack's proxy,
or pass `internalCallers: false`.
:::

The Lambda middleware (`telemetryMiddleware`) takes `trustedOrigins` too. API
Gateway has no private network to tell an internal caller by, so a request
from no trusted origin is continued only when `trustRequest(event)` vouches
for it — after IAM auth, say.

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

// Define endpoint — built from the surface, which is what carries the
// telescope instance into every handler on it
const getUsers = api
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
