# Constructs Observability Design

This document outlines the design for integrating observability (telemetry, metrics, analytics) into `@geekmidas/constructs`.

## Overview

### Three Pillars of Observability

| Pillar | Purpose | Audience | Examples |
|--------|---------|----------|----------|
| **Telemetry (Traces)** | Request flow & timing | Engineers | Spans, trace context, distributed tracing |
| **Metrics** | Operational health | SRE/DevOps | Latency p99, error rate, throughput |
| **Analytics** | Business intelligence | Product/Business | User signups, orders, feature usage |

### Design Principles

1. **Interface-first** - Define contracts, not implementations
2. **Opt-in** - No observability overhead if not configured
3. **Multi-provider** - Support arrays for multiple backends
4. **Automatic + Manual** - Capture common data automatically, allow custom data
5. **Consistent** - Same patterns across all construct types

---

## Interfaces

### Telemetry (Distributed Tracing)

```typescript
/**
 * Context passed between telemetry lifecycle hooks
 */
interface TelemetryContext {
  [key: string]: unknown;
}

/**
 * Request information for telemetry
 */
interface TelemetryRequest {
  event: unknown;
  context: LambdaContext;
}

/**
 * Response information for telemetry
 */
interface TelemetryResponse {
  statusCode: number;
  body?: string;
  headers?: Record<string, string>;
}

/**
 * Telemetry interface for distributed tracing
 *
 * Implementations: OTelTelemetry, DatadogTelemetry, XRayTelemetry
 */
interface Telemetry {
  /**
   * Called at request start - create span, extract trace context
   */
  onRequestStart(request: TelemetryRequest): TelemetryContext;

  /**
   * Called on successful completion - end span with success status
   */
  onRequestEnd(ctx: TelemetryContext, response: TelemetryResponse): void;

  /**
   * Called on error - record exception, end span with error status
   */
  onRequestError(ctx: TelemetryContext, error: Error): void;
}
```

### Metrics (Operational)

```typescript
/**
 * Labels/tags for metric dimensions
 */
type MetricLabels = Record<string, string | number | boolean>;

/**
 * Metrics interface for operational measurements
 *
 * Implementations: OTelMetrics, CloudWatchMetrics, PrometheusMetrics, StatsDMetrics
 */
interface Metrics {
  /**
   * Increment a counter
   * @example metrics.increment('cache.hit', 1, { cache: 'redis' })
   */
  increment(name: string, value?: number, labels?: MetricLabels): void;

  /**
   * Record a value in a histogram (for distributions/percentiles)
   * @example metrics.histogram('http.duration_ms', 142, { route: '/api/users' })
   */
  histogram(name: string, value: number, labels?: MetricLabels): void;

  /**
   * Set a gauge value (for current state)
   * @example metrics.gauge('queue.depth', 42, { queue: 'emails' })
   */
  gauge(name: string, value: number, labels?: MetricLabels): void;

  /**
   * Create a timer that records duration when stopped
   * @example const timer = metrics.timer('db.query'); ... timer.stop();
   */
  timer(name: string, labels?: MetricLabels): MetricTimer;
}

interface MetricTimer {
  stop(): void;
}
```

### Analytics (Business Events)

```typescript
/**
 * Event properties for analytics
 */
type AnalyticsProperties = Record<string, unknown>;

/**
 * User traits for analytics
 */
type AnalyticsTraits = Record<string, unknown>;

/**
 * Analytics interface for business intelligence
 *
 * Implementations: SegmentAnalytics, AmplitudeAnalytics, MixpanelAnalytics, PostHogAnalytics
 */
interface Analytics {
  /**
   * Track a business event
   * @example analytics.track('order.completed', { orderId: '123', total: 99.99 })
   */
  track(event: string, properties?: AnalyticsProperties): void;

  /**
   * Identify a user with traits
   * @example analytics.identify('user-123', { plan: 'pro', company: 'Acme' })
   */
  identify(userId: string, traits?: AnalyticsTraits): void;

  /**
   * Associate current user with a group/company
   * @example analytics.group('company-456', { name: 'Acme Inc', plan: 'enterprise' })
   */
  group(groupId: string, traits?: AnalyticsTraits): void;

  /**
   * Track a page/screen view
   * @example analytics.page('Checkout', { step: 2 })
   */
  page(name: string, properties?: AnalyticsProperties): void;
}
```

---

## Construct Options

### Endpoint Options

```typescript
interface EndpointOptions {
  /**
   * Distributed tracing - single provider or array
   */
  telemetry?: Telemetry | Telemetry[];

  /**
   * Operational metrics - single provider or array
   */
  metrics?: Metrics | Metrics[];

  /**
   * Business analytics - single provider or array
   */
  analytics?: Analytics | Analytics[];
}

// Usage
const adaptor = new AmazonApiGatewayV2Endpoint(envParser, endpoint, {
  telemetry: [
    new OTelTelemetry({ endpoint: 'http://jaeger:4318' }),
    new DatadogTelemetry({ apiKey: process.env.DD_API_KEY }),
  ],
  metrics: new CloudWatchMetrics({ namespace: 'MyApp' }),
  analytics: new SegmentAnalytics({ writeKey: process.env.SEGMENT_KEY }),
});
```

### Function Options

```typescript
interface FunctionOptions {
  telemetry?: Telemetry | Telemetry[];
  metrics?: Metrics | Metrics[];
  analytics?: Analytics | Analytics[];
}
```

### Cron Options

```typescript
interface CronOptions {
  telemetry?: Telemetry | Telemetry[];
  metrics?: Metrics | Metrics[];
  // Analytics typically not needed for crons
}
```

### Subscriber Options

```typescript
interface SubscriberOptions {
  telemetry?: Telemetry | Telemetry[];
  metrics?: Metrics | Metrics[];
  analytics?: Analytics | Analytics[];
}
```

---

## Handler Context

All three interfaces are injected into the handler context:

```typescript
interface HandlerContext<TServices, TSession> {
  // Existing
  logger: Logger;
  services: TServices;
  session: TSession;
  auditor: Auditor;
  db: Database;
  header: HeaderFn;
  cookie: CookieFn;

  // New - Observability
  metrics: Metrics;
  analytics: Analytics;
  // Note: telemetry is NOT exposed to handlers (managed by adaptor)
}
```

### Usage in Handler

```typescript
const createOrder = e
  .post('/orders')
  .body(OrderSchema)
  .output(OrderResponseSchema)
  .handle(async ({ body, services, metrics, analytics, logger }) => {
    const timer = metrics.timer('order.processing');

    try {
      // Create order
      const order = await services.orders.create(body);

      // Manual metrics
      metrics.histogram('order.total_cents', order.totalCents);
      metrics.histogram('order.items_count', order.items.length);
      metrics.increment('orders.created', 1, {
        region: order.region,
        type: order.type,
      });

      // Business analytics
      analytics.track('order.created', {
        orderId: order.id,
        total: order.totalCents / 100,
        currency: order.currency,
        itemCount: order.items.length,
        categories: order.items.map(i => i.category),
      });

      // Identify user traits update
      analytics.identify(order.userId, {
        lastOrderAt: new Date().toISOString(),
        totalOrders: order.userOrderCount,
      });

      return order;
    } finally {
      timer.stop();
    }
  });
```

---

## Automatic Capture

### Endpoint (HTTP)

| Metric | Type | Labels | Captured |
|--------|------|--------|----------|
| `http.requests` | Counter | method, route, status | After response |
| `http.request.duration_ms` | Histogram | method, route | After response |
| `http.request.size_bytes` | Histogram | method, route | Before handler |
| `http.response.size_bytes` | Histogram | method, route | After response |
| `http.errors` | Counter | method, route, error_type | On error |

Telemetry span attributes (automatic):
- `http.request.method`
- `http.route`
- `url.path`
- `http.response.status_code`
- `client.address`
- `user_agent.original`
- `enduser.id` (if session available)

### Function (Lambda)

| Metric | Type | Labels | Captured |
|--------|------|--------|----------|
| `faas.invocations` | Counter | name, trigger | After completion |
| `faas.duration_ms` | Histogram | name | After completion |
| `faas.errors` | Counter | name, error_type | On error |
| `faas.cold_starts` | Counter | name | On cold start |
| `faas.init_duration_ms` | Histogram | name | On cold start |

Telemetry span attributes (automatic):
- `faas.name`
- `faas.invocation_id`
- `faas.coldstart`
- `faas.trigger`
- `cloud.resource_id`

### Cron (Scheduled)

| Metric | Type | Labels | Captured |
|--------|------|--------|----------|
| `cron.runs` | Counter | name, status | After completion |
| `cron.duration_ms` | Histogram | name | After completion |
| `cron.errors` | Counter | name, error_type | On error |
| `cron.last_success_ts` | Gauge | name | On success |

Telemetry span attributes (automatic):
- `faas.cron.name`
- `faas.cron.schedule`
- `faas.trigger` = "timer"

### Subscriber (Event)

| Metric | Type | Labels | Captured |
|--------|------|--------|----------|
| `messaging.received` | Counter | queue, event_type | On receive |
| `messaging.processed` | Counter | queue, event_type | After success |
| `messaging.failed` | Counter | queue, event_type, error | On error |
| `messaging.duration_ms` | Histogram | queue, event_type | After completion |
| `messaging.age_ms` | Histogram | queue | On receive |

Telemetry span attributes (automatic):
- `messaging.system` (sqs, sns, rabbitmq)
- `messaging.operation` = "process"
- `messaging.message.id`
- `messaging.destination.name`

---

## Multi-Provider Support

When multiple providers are configured, the adaptor calls all of them:

```typescript
class MultiMetrics implements Metrics {
  constructor(private providers: Metrics[]) {}

  increment(name: string, value?: number, labels?: MetricLabels): void {
    for (const provider of this.providers) {
      provider.increment(name, value, labels);
    }
  }

  histogram(name: string, value: number, labels?: MetricLabels): void {
    for (const provider of this.providers) {
      provider.histogram(name, value, labels);
    }
  }

  gauge(name: string, value: number, labels?: MetricLabels): void {
    for (const provider of this.providers) {
      provider.gauge(name, value, labels);
    }
  }

  timer(name: string, labels?: MetricLabels): MetricTimer {
    const timers = this.providers.map(p => p.timer(name, labels));
    return {
      stop: () => timers.forEach(t => t.stop()),
    };
  }
}
```

---

## Noop Implementations

When no provider is configured, use noop implementations (zero overhead):

```typescript
const NoopMetrics: Metrics = {
  increment: () => {},
  histogram: () => {},
  gauge: () => {},
  timer: () => ({ stop: () => {} }),
};

const NoopAnalytics: Analytics = {
  track: () => {},
  identify: () => {},
  group: () => {},
  page: () => {},
};
```

---

## Implementation Plan

### Phase 1: Core Interfaces
- [ ] Define `Metrics` interface in `@geekmidas/constructs`
- [ ] Define `Analytics` interface in `@geekmidas/constructs`
- [ ] Create `NoopMetrics` and `NoopAnalytics`
- [ ] Create `MultiMetrics` and `MultiAnalytics` wrappers

### Phase 2: Endpoint Integration
- [ ] Add `metrics` and `analytics` to `EndpointOptions`
- [ ] Inject into handler context
- [ ] Add automatic metric capture in adaptor middleware
- [ ] Update tests

### Phase 3: OTel Implementations
- [ ] `OTelMetrics` in `@geekmidas/telescope/instrumentation`
- [ ] Update `OTelTelemetry` to also record metrics (optional)

### Phase 4: Other Construct Types
- [ ] Function integration
- [ ] Cron integration
- [ ] Subscriber integration

### Phase 5: Additional Providers
- [ ] `CloudWatchMetrics`
- [ ] `SegmentAnalytics`
- [ ] `PostHogAnalytics`

---

## Open Questions

1. **Should telemetry auto-derive metrics?**
   - RED metrics (Rate, Errors, Duration) can be derived from spans
   - Pros: Less configuration, automatic correlation
   - Cons: May want metrics without traces, different retention

2. **Batching and flushing?**
   - Metrics/analytics typically batch before sending
   - Lambda requires flush before handler ends
   - Add `flush()` method to interfaces?

3. **Sampling?**
   - High-volume endpoints may need sampling
   - Should this be per-provider or centralized?

4. **Error handling?**
   - What happens if a provider fails?
   - Silent failure vs logging vs throwing?

5. **Context propagation?**
   - Should metrics/analytics have access to trace context?
   - Useful for correlating metrics with specific traces

---

## Example: Full Integration

```typescript
import { e } from '@geekmidas/constructs/endpoints';
import { OTelTelemetry, OTelMetrics } from '@geekmidas/telescope/instrumentation';
import { SegmentAnalytics } from '@geekmidas/analytics/segment';

// Define endpoint
const createUser = e
  .post('/users')
  .body(CreateUserSchema)
  .output(UserSchema)
  .handle(async ({ body, metrics, analytics, logger }) => {
    const user = await db.users.create(body);

    // Custom metrics
    metrics.increment('users.created', 1, { plan: user.plan });

    // Business event
    analytics.track('user.signed_up', {
      userId: user.id,
      plan: user.plan,
      source: body.source,
    });
    analytics.identify(user.id, {
      email: user.email,
      plan: user.plan,
      createdAt: user.createdAt,
    });

    return user;
  });

// Create adaptor with all observability
const adaptor = new AmazonApiGatewayV2Endpoint(envParser, createUser, {
  telemetry: new OTelTelemetry({
    serviceName: 'user-service',
    endpoint: process.env.OTEL_ENDPOINT,
  }),
  metrics: new OTelMetrics({
    serviceName: 'user-service',
    endpoint: process.env.OTEL_ENDPOINT,
  }),
  analytics: new SegmentAnalytics({
    writeKey: process.env.SEGMENT_WRITE_KEY,
  }),
});

export const handler = adaptor.handler;
```
