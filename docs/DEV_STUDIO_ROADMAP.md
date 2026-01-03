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

---

## Pending

### Bug Fixes
- [ ] **OpenAPI React Query generation bug** - Args for `useQuery` and `useMutation` are incorrect in generated hooks (packages/cli/src/openapi/, packages/client/src/react-query/)

### Phase 4: Studio UI Polish
- [ ] Analytics page data visualization improvements
- [ ] Real-time metrics updates via WebSocket
- [ ] Time range selector for metrics queries
- [ ] Endpoint details drill-down view
- [ ] Export metrics as CSV/JSON

### Phase 5: Constructs Auto-Instrumentation
- [ ] Auto-instrument `@geekmidas/constructs` endpoints with OTel spans
- [ ] Capture request/response metadata as span attributes
- [ ] Propagate trace context through service calls
- [ ] Add instrumentation hooks for custom spans

### Phase 6: Studio Dashboard
- [ ] Dashboard home page with key metrics overview
- [ ] Service health status indicators
- [ ] Recent errors summary widget
- [ ] Slowest endpoints widget
- [ ] Request volume trends chart

### Phase 7: Configuration UI
- [ ] Environment variables viewer/editor
- [ ] Service discovery status
- [ ] Telescope settings configuration
- [ ] OTLP exporter configuration

### Phase 8: Developer Tools
- [ ] API playground (test endpoints directly)
- [ ] Request replay functionality
- [ ] cURL command generator from requests
- [ ] OpenAPI documentation viewer

---

## Package Structure

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

---

## Notes

- All OTel packages are optional peer dependencies in telescope
- Pino integration uses `@opentelemetry/instrumentation-pino` for log correlation
- Metrics are stored in memory by default (no persistence between restarts)
- OTLP endpoints accept JSON format (not protobuf)
