# Dev Studio Integration Roadmap

## Completed

### Phase 1: Unified Navigation & UI Merge
- [x] React Router integration in Studio UI
- [x] Unified navigation sidebar with collapsible sections
- [x] Telescope pages (Requests, Logs, Exceptions) integrated
- [x] Feedback components added to UI package

### Phase 2: Metrics Aggregation in Telescope
- [x] `MetricsAggregator` with time-bucketing and reservoir sampling
- [x] Percentile calculations (p50, p95, p99)
- [x] Endpoint-level metrics with error rates
- [x] Status code distribution (2xx, 3xx, 4xx, 5xx)
- [x] Integration with `Telescope.recordRequest()`
- [x] Metrics API endpoints in Hono server
- [x] Analytics page in Studio UI

### Phase 3: OTLP Support
- [x] OTLP JSON types for traces, logs, and metrics
- [x] `OTLPReceiver` for ingesting OpenTelemetry data
- [x] Transformer utilities (OTLP → Telescope entries)
- [x] Hono routes at `/v1/traces`, `/v1/logs`, `/v1/metrics`
- [x] Tracing utilities (`withSpan`, `getActiveSpan`, `getTraceId`)
- [x] OpenTelemetry SDK setup with Pino instrumentation
- [x] Tests for all OTLP functionality

### Bug Fixes
- [x] **OpenAPI React Query generation bug** - Fixed indentation in generated `paths` type and conditional type distribution in `BuildRequestConfig` (packages/cli/src/generators/OpenApiTsGenerator.ts, packages/client/src/types.ts)

---

## Pending

### Phase 4: Studio UI Polish
- [ ] Analytics page data visualization improvements
- [ ] Real-time metrics updates via WebSocket
- [ ] Time range selector for metrics queries
- [ ] Endpoint details drill-down view
- [ ] Export metrics as CSV/JSON

### Phase 5: Telescope Modular Architecture (Core + Extensions)

Refactor Telescope into a modular architecture where core functionality is environment-agnostic, with pluggable extensions for specific environments.

#### Core (`@geekmidas/telescope`)
- [ ] Extract environment-agnostic core: storage, metrics, types, OTLP receiver
- [ ] Define `TelescopeAdapter` interface for environment extensions
- [ ] Core tracing utilities that work anywhere (no Node.js specifics)
- [ ] Pluggable span processor strategy (batch vs simple)
- [ ] `flushTelemetry()` for manual flush before context freeze

#### Lambda Extension (`@geekmidas/telescope/lambda`)
- [ ] `SimpleSpanProcessor` for immediate export (no batching)
- [ ] Lambda resource detector (function name, memory, region, request ID)
- [ ] Auto-flush wrapper for Lambda handlers
- [ ] Integration with `@geekmidas/constructs` Lambda adapters
- [ ] Cold start detection and metrics
- [ ] X-Ray trace header propagation

#### Hono Extension (`@geekmidas/telescope/hono`)
- [ ] Already exists - middleware and UI routes
- [ ] Add WebSocket support for real-time updates
- [ ] SSE fallback for environments without WebSocket

#### Express Extension (`@geekmidas/telescope/express`)
- [ ] Express middleware for request capture
- [ ] Error handler middleware
- [ ] Mount UI routes

#### Other Extensions (Future)
- [ ] Fastify extension
- [ ] Koa extension
- [ ] Cloudflare Workers extension
- [ ] Vercel Edge extension

### Phase 6: Constructs Auto-Instrumentation
- [ ] Auto-instrument `@geekmidas/constructs` endpoints with OTel spans
- [ ] Capture request/response metadata as span attributes
- [ ] Propagate trace context through service calls
- [ ] Add instrumentation hooks for custom spans
- [ ] Auto-flush integration for Lambda handlers

### Phase 7: Studio Dashboard
- [ ] Dashboard home page with key metrics overview
- [ ] Service health status indicators
- [ ] Recent errors summary widget
- [ ] Slowest endpoints widget
- [ ] Request volume trends chart

### Phase 8: Configuration UI
- [ ] Environment variables viewer/editor
- [ ] Service discovery status
- [ ] Telescope settings configuration
- [ ] OTLP exporter configuration

### Phase 9: Developer Tools
- [ ] API playground (test endpoints directly)
- [ ] Request replay functionality
- [ ] cURL command generator from requests
- [ ] OpenAPI documentation viewer

---

## Package Structure

### Current
```
packages/
├── telescope/           # Core monitoring library
│   ├── src/
│   │   ├── metrics/     # MetricsAggregator
│   │   ├── otlp/        # OTLP receiver & transformer
│   │   ├── instrumentation/  # OTel SDK setup & tracing utils
│   │   ├── server/      # Hono middleware & routes
│   │   └── storage/     # Memory & Kysely backends
│   └── package.json
│
├── studio/              # Dev Studio application
│   └── ui/              # React frontend
│       └── src/
│           ├── pages/   # Route pages (Analytics, Requests, etc.)
│           └── components/
│
└── cli/                 # CLI tools
    └── src/
        ├── dev/         # Development server with Telescope
        └── openapi/     # OpenAPI & React Query generation
```

### Target (Post Phase 5)
```
packages/telescope/
├── src/
│   ├── core/                # Environment-agnostic core
│   │   ├── Telescope.ts     # Main class
│   │   ├── types.ts         # Shared types
│   │   └── adapter.ts       # TelescopeAdapter interface
│   │
│   ├── metrics/             # Metrics aggregation (core)
│   ├── otlp/                # OTLP receiver (core)
│   ├── storage/             # Storage backends (core)
│   │   ├── memory.ts
│   │   └── kysely.ts
│   │
│   ├── instrumentation/     # OTel utilities (core)
│   │   ├── tracing.ts       # withSpan, getActiveSpan, etc.
│   │   └── processors.ts    # Batch vs Simple processor factory
│   │
│   ├── lambda/              # AWS Lambda extension
│   │   ├── index.ts
│   │   ├── handler.ts       # Auto-flush handler wrapper
│   │   ├── detector.ts      # Lambda resource detector
│   │   └── xray.ts          # X-Ray trace propagation
│   │
│   ├── hono/                # Hono extension
│   │   ├── index.ts
│   │   ├── middleware.ts
│   │   └── ui.ts
│   │
│   ├── express/             # Express extension
│   │   ├── index.ts
│   │   ├── middleware.ts
│   │   └── errorHandler.ts
│   │
│   └── logger/              # Logger integrations
│       ├── pino.ts
│       └── console.ts
│
└── package.json             # Subpath exports for each extension
    # exports:
    #   "."           -> core
    #   "./lambda"    -> lambda extension
    #   "./hono"      -> hono extension
    #   "./express"   -> express extension
    #   "./metrics"   -> metrics
    #   "./otlp"      -> otlp receiver
```

---

## Notes

- All OTel packages are optional peer dependencies in telescope
- Pino integration uses `@opentelemetry/instrumentation-pino` for log correlation
- Metrics are stored in memory by default (no persistence between restarts)
- OTLP endpoints accept JSON format (not protobuf)
