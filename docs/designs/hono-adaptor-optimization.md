# Hono Adaptor Optimization Investigation

## Executive Summary

This document investigates the efficiency of the `HonoEndpointAdaptor` implementation and explores optimization strategies. We'll implement multiple approaches, benchmark them, and determine the best path forward.

---

## Table of Contents

1. [Current Architecture Analysis](#current-architecture-analysis)
2. [Identified Inefficiencies](#identified-inefficiencies)
3. [Optimization Strategies](#optimization-strategies)
4. [Implementation Plan](#implementation-plan)
5. [Benchmarking Strategy](#benchmarking-strategy)
6. [Decision Matrix](#decision-matrix)

---

## Current Architecture Analysis

### Request Flow

```
Request
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ Global Middleware (runs on EVERY request)               │
│ ├── timing()                                            │
│ ├── honoLogger() [dev only]                            │
│ └── eventPublishMiddleware (post-response)             │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ Route Matching                                          │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ Per-Route Validators (3 per endpoint)                   │
│ ├── validator('json', ...)   - Body validation          │
│ ├── validator('query', ...)  - Query validation         │
│ └── validator('param', ...)  - Path param validation    │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ Main Handler (ALL logic inline)                         │
│ ├── 1. Logger initialization                           │
│ ├── 2. Header/cookie parsing                           │
│ ├── 3. Service registration (general)                  │
│ ├── 4. Service registration (database - DUPLICATE)     │
│ ├── 5. Session extraction                              │
│ ├── 6. Authorization check                             │
│ ├── 7. Rate limit check + header setting               │
│ ├── 8. Audit context creation                          │
│ ├── 9. RLS context extraction                          │
│ ├── 10. Handler execution (with audit transaction)     │
│ ├── 11. Output validation                              │
│ ├── 12. Response building                              │
│ └── 13. Context setting for event middleware           │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ Post-Response (event middleware)                        │
│ └── publishConstructEvents() if success                │
└─────────────────────────────────────────────────────────┘
```

### Code Structure

```
packages/constructs/src/endpoints/
├── HonoEndpointAdaptor.ts    # Main adaptor (545 lines)
├── Endpoint.ts               # Endpoint class
├── EndpointBuilder.ts        # Fluent builder
├── processAudits.ts          # Audit processing
├── rls.ts                    # Row-level security
└── helpers.ts                # Utility functions
```

### Key Files Analysis

| File | Lines | Responsibility | Complexity |
|------|-------|----------------|------------|
| HonoEndpointAdaptor.ts | 545 | Route registration, handler execution | High |
| processAudits.ts | 300 | Audit context, transaction handling | Medium |
| rls.ts | 150 | RLS context management | Medium |
| Endpoint.ts | 400 | Endpoint configuration | Low |

---

## Identified Inefficiencies

### 1. Duplicate Service Registration

**Location:** `HonoEndpointAdaptor.ts:300-310`

```typescript
// Problem: Two separate registrations
const services = await serviceDiscovery.register(endpoint.services);

const rawDb = endpoint.databaseService
  ? await serviceDiscovery
      .register([endpoint.databaseService])
      .then(s => s[endpoint.databaseService!.serviceName as keyof typeof s])
  : undefined;
```

**Impact:**
- Double async overhead for DB endpoints
- Potential duplicate initialization
- ~2x service init cost per request

**Severity:** HIGH

---

### 2. Unconditional Audit Context Creation

**Location:** `HonoEndpointAdaptor.ts:357-367`, `processAudits.ts:249-287`

```typescript
// Problem: Always creates audit context
const auditContext = await createAuditContext(
  endpoint,
  serviceDiscovery,
  logger,
  { session, requestId, ... }
);

// Inside createAuditContext():
// - Registers audit storage service (even if no audits)
// - Extracts actor (even if no audits)
// - Creates DefaultAuditor instance
```

**Impact:**
- Service registration overhead on every request
- Actor extraction runs unnecessarily
- Memory allocation for unused Auditor

**Severity:** MEDIUM

---

### 3. Global Event Middleware on All Requests

**Location:** `HonoEndpointAdaptor.ts:122-149`

```typescript
// Problem: Runs on EVERY request including 404s
app.use(async (c, next) => {
  await next();

  // These lookups happen even on non-matching routes
  const endpoint = c.get('__endpoint') as Endpoint<...>;
  const response = c.get('__response');
  const logger = c.get('__logger') as Logger;

  if (Endpoint.isSuccessStatus(c.res.status) && endpoint) {
    await publishConstructEvents(...);
  }
});
```

**Impact:**
- 3 context lookups per request
- Type assertions on every request
- Overhead on 404s and errors

**Severity:** MEDIUM

---

### 4. Monolithic Handler Anti-Pattern

**Location:** `HonoEndpointAdaptor.ts:285-543`

The main handler is a 258-line async function containing all logic inline:

```typescript
async (c) => {
  // 1. Logger init (5 lines)
  // 2. Header parsing (10 lines)
  // 3. Service registration (15 lines)
  // 4. Session extraction (20 lines)
  // 5. Authorization (15 lines)
  // 6. Rate limiting (25 lines)
  // 7. Audit setup (30 lines)
  // 8. RLS setup (20 lines)
  // 9. Handler execution (50 lines)
  // 10. Response building (50 lines)
  // ... 258 lines total
}
```

**Impact:**
- Hard to test individual concerns
- No early returns for simple endpoints
- All code paths executed regardless of endpoint configuration
- Memory pressure from closure scope

**Severity:** MEDIUM

---

### 5. Per-Request Work That Could Be Per-Route

| Operation | Current | Ideal |
|-----------|---------|-------|
| Logger child creation | Per-request | Per-route (with request binding) |
| Service list building | Per-request | Per-route (static) |
| Feature flag checks | Per-request | Per-route (compile-time) |
| Validator creation | Per-route ✓ | Per-route ✓ |

**Severity:** LOW-MEDIUM

---

### 6. Magic String Context Keys

**Location:** Throughout HonoEndpointAdaptor.ts

```typescript
// Current: Magic strings, no type safety
c.set('__endpoint', endpoint);
c.set('__response', response);
c.set('__logger', logger);

// Later:
const endpoint = c.get('__endpoint') as Endpoint<...>;  // Type assertion
```

**Impact:**
- No compile-time type checking
- Easy to misspell keys
- Requires type assertions

**Severity:** LOW (correctness issue, not performance)

---

## Optimization Strategies

### Strategy A: Lazy Service Resolution with Caching

**Concept:** Don't register services until they're actually needed, cache results.

```typescript
class LazyServiceResolver {
  private cache = new Map<string, any>();

  constructor(
    private serviceDiscovery: ServiceDiscovery,
    private availableServices: Service<any, any>[]
  ) {}

  async get<T>(serviceName: string): Promise<T> {
    if (this.cache.has(serviceName)) {
      return this.cache.get(serviceName);
    }

    const service = this.availableServices.find(s => s.serviceName === serviceName);
    if (!service) throw new Error(`Service ${serviceName} not found`);

    const instance = await this.serviceDiscovery.register([service]);
    this.cache.set(serviceName, instance[serviceName]);
    return instance[serviceName];
  }

  // Batch resolve for known dependencies
  async preload(serviceNames: string[]): Promise<void> {
    const toLoad = serviceNames.filter(n => !this.cache.has(n));
    if (toLoad.length === 0) return;

    const services = this.availableServices.filter(s =>
      toLoad.includes(s.serviceName)
    );
    const instances = await this.serviceDiscovery.register(services);

    for (const [name, instance] of Object.entries(instances)) {
      this.cache.set(name, instance);
    }
  }
}
```

**Pros:**
- Only load what's needed
- Automatic deduplication
- Works with current ServiceDiscovery

**Cons:**
- Adds indirection layer
- Cache invalidation complexity
- May defer errors to runtime

**Estimated Improvement:** 20-40% for endpoints with unused services

---

### Strategy B: Pre-compiled Route Handlers

**Concept:** Analyze endpoint configuration at startup, generate optimized handlers.

```typescript
function compileHandler(
  endpoint: Endpoint<any, any, any, any, any, any>,
  serviceDiscovery: ServiceDiscovery
): (c: Context) => Promise<Response> {
  // Analyze endpoint features at compile time
  const features = {
    hasAuth: endpoint.authorizer !== 'none',
    hasRateLimit: !!endpoint.rateLimit,
    hasAudits: (endpoint.audits?.length ?? 0) > 0,
    hasRls: !!endpoint.rlsConfig && !endpoint.rlsBypass,
    hasDb: !!endpoint.databaseService,
    hasEvents: (endpoint.events?.length ?? 0) > 0,
    serviceNames: endpoint.services.map(s => s.serviceName),
  };

  // Pre-register all services at startup
  const servicesPromise = serviceDiscovery.register(endpoint.services);

  // Return optimized handler
  if (!features.hasAuth && !features.hasRateLimit && !features.hasAudits && !features.hasRls) {
    // Simple endpoint - minimal overhead
    return async (c) => {
      const services = await servicesPromise;
      const result = await endpoint.handler({
        body: c.req.valid('json'),
        query: c.req.valid('query'),
        params: c.req.valid('param'),
        services,
        logger: console,
      });
      return c.json(result);
    };
  }

  if (features.hasAuth && !features.hasRateLimit && !features.hasAudits) {
    // Auth-only endpoint
    return async (c) => {
      const session = await extractSession(c, endpoint);
      if (!session && endpoint.authorizer !== 'none') {
        return c.json({ error: 'Unauthorized' }, 401);
      }

      const services = await servicesPromise;
      const result = await endpoint.handler({
        body: c.req.valid('json'),
        query: c.req.valid('query'),
        params: c.req.valid('param'),
        services,
        session,
        logger: console,
      });
      return c.json(result);
    };
  }

  // Full-featured endpoint - current implementation
  return createFullHandler(endpoint, serviceDiscovery, features);
}
```

**Pros:**
- Zero runtime feature checks
- Tailored code paths per endpoint type
- Smaller closure scope for simple endpoints

**Cons:**
- Code duplication across handler variants
- More complex codebase
- Harder to add new features

**Estimated Improvement:** 30-50% for simple endpoints, 10-20% for complex

---

### Strategy C: Middleware Composition Pattern

**Concept:** Break monolithic handler into composable middleware chain.

```typescript
// Middleware factory functions
const createAuthMiddleware = (endpoint: Endpoint<...>) => {
  if (endpoint.authorizer === 'none') return null;

  return async (c: Context, next: Next) => {
    const session = await extractSession(c, endpoint);
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    c.set('session', session);
    await next();
  };
};

const createRateLimitMiddleware = (endpoint: Endpoint<...>) => {
  if (!endpoint.rateLimit) return null;

  return async (c: Context, next: Next) => {
    const identifier = c.req.header('x-forwarded-for') || 'anonymous';
    const result = await endpoint.rateLimit!.check(identifier);

    if (!result.allowed) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    // Set headers
    c.header('X-RateLimit-Limit', String(result.limit));
    c.header('X-RateLimit-Remaining', String(result.remaining));

    await next();
  };
};

const createAuditMiddleware = (endpoint: Endpoint<...>, serviceDiscovery: ServiceDiscovery) => {
  if (!endpoint.audits?.length) return null;

  return async (c: Context, next: Next) => {
    const auditContext = await createAuditContext(endpoint, serviceDiscovery, ...);
    c.set('auditContext', auditContext);
    await next();
  };
};

// Route registration
function addRoute(endpoint: Endpoint<...>, app: Hono, serviceDiscovery: ServiceDiscovery) {
  const middlewares = [
    createAuthMiddleware(endpoint),
    createRateLimitMiddleware(endpoint),
    createAuditMiddleware(endpoint, serviceDiscovery),
    createRlsMiddleware(endpoint, serviceDiscovery),
  ].filter(Boolean);

  const coreHandler = createCoreHandler(endpoint, serviceDiscovery);

  app[endpoint.method](
    endpoint.route,
    ...validators,
    ...middlewares,
    coreHandler
  );
}
```

**Pros:**
- Clean separation of concerns
- Easy to test individual middleware
- Natural early-exit on failures
- Follows Hono's native patterns

**Cons:**
- More function call overhead
- Context passing between middleware
- May need to restructure existing code significantly

**Estimated Improvement:** 15-25% overall, better maintainability

---

### Strategy D: Opt-in Event Publishing

**Concept:** Only add event middleware to routes that publish events.

```typescript
// Current: Global middleware on all requests
app.use(eventPublishMiddleware);

// Proposed: Per-route middleware only when needed
function addRoute(endpoint: Endpoint<...>, app: Hono, serviceDiscovery: ServiceDiscovery) {
  const middlewares = [...];

  // Only add event publishing if endpoint has events
  if (endpoint.events?.length) {
    middlewares.push(createEventPublishMiddleware(endpoint, serviceDiscovery));
  }

  app[endpoint.method](endpoint.route, ...middlewares, coreHandler);
}

// Event middleware only runs on routes that need it
const createEventPublishMiddleware = (endpoint: Endpoint<...>, serviceDiscovery: ServiceDiscovery) => {
  return async (c: Context, next: Next) => {
    await next();

    if (Endpoint.isSuccessStatus(c.res.status)) {
      const response = c.get('response');
      await publishConstructEvents(endpoint, response, serviceDiscovery, c.get('logger'));
    }
  };
};
```

**Pros:**
- Zero overhead for routes without events
- No global middleware
- Cleaner architecture

**Cons:**
- Requires knowing event configuration at route registration
- Slightly more complex route setup

**Estimated Improvement:** 5-15% for routes without events

---

### Strategy E: Typed Context Management

**Concept:** Replace magic strings with typed context.

```typescript
// Define typed context
interface EndpointContext {
  endpoint: Endpoint<any, any, any, any, any, any>;
  session: Session | null;
  services: Record<string, any>;
  logger: Logger;
  auditContext: AuditContext | null;
  requestId: string;
}

// Context factory
const createEndpointContext = (c: Context): EndpointContext => ({
  endpoint: null!,
  session: null,
  services: {},
  logger: null!,
  auditContext: null,
  requestId: crypto.randomUUID(),
});

// Type-safe context access
declare module 'hono' {
  interface ContextVariableMap {
    endpointContext: EndpointContext;
  }
}

// Usage
c.set('endpointContext', ctx);
const { session, services } = c.get('endpointContext');
```

**Pros:**
- Full type safety
- Single context object instead of multiple keys
- Better IDE support

**Cons:**
- Requires Hono module augmentation
- Migration effort
- May need context cloning for mutations

**Estimated Improvement:** Minimal performance impact, significant DX improvement

---

## Implementation Plan

### Phase 1: Benchmarking Infrastructure (Day 1)

1. Create benchmark test suite
2. Establish baseline metrics
3. Set up profiling tools

### Phase 2: Implement Strategies (Days 2-4)

#### Strategy A: Lazy Services
- Create `LazyServiceResolver` class
- Integrate with existing ServiceDiscovery
- Add caching layer

#### Strategy B: Pre-compiled Handlers
- Create handler compiler
- Implement feature detection
- Generate optimized variants

#### Strategy C: Middleware Composition
- Extract middleware factories
- Refactor route registration
- Maintain backward compatibility

#### Strategy D: Opt-in Events
- Refactor event middleware
- Add per-route registration
- Remove global middleware

### Phase 3: Benchmarking & Comparison (Day 5)

1. Run benchmarks for each strategy
2. Profile memory usage
3. Measure startup time impact
4. Document results

### Phase 4: Decision & Implementation (Day 6+)

1. Analyze benchmark results
2. Select winning strategy (or combination)
3. Implement production changes
4. Update documentation

---

## Benchmarking Strategy

### Test Scenarios

```typescript
// Scenario 1: Simple endpoint (no auth, no DB, no audits)
const simpleEndpoint = e
  .get('/health')
  .output(z.object({ status: z.string() }))
  .handle(async () => ({ status: 'ok' }));

// Scenario 2: Auth-only endpoint
const authEndpoint = e
  .get('/profile')
  .authorizer('jwt')
  .output(z.object({ userId: z.string() }))
  .handle(async ({ session }) => ({ userId: session.sub }));

// Scenario 3: Database endpoint
const dbEndpoint = e
  .get('/users')
  .services([databaseService])
  .output(z.array(userSchema))
  .handle(async ({ services }) => services.database.selectFrom('users').execute());

// Scenario 4: Full-featured endpoint
const complexEndpoint = e
  .post('/orders')
  .authorizer('jwt')
  .services([databaseService, auditService])
  .rateLimit(rateLimiter)
  .body(orderSchema)
  .output(orderResponseSchema)
  .audit('order.created', (ctx) => ({ orderId: ctx.response.id }))
  .handle(async ({ body, services, session }) => {
    // Complex logic
  });
```

### Metrics to Measure

| Metric | Tool | Target |
|--------|------|--------|
| Requests/second | autocannon | Higher is better |
| P50 latency | autocannon | < 5ms for simple |
| P99 latency | autocannon | < 50ms for complex |
| Memory usage | process.memoryUsage() | Lower is better |
| Startup time | performance.now() | < 100ms for 100 endpoints |
| GC pressure | --expose-gc | Fewer collections |

### Benchmark Script Structure

```typescript
// packages/constructs/src/__benchmarks__/hono-adaptor.bench.ts

import { bench, describe } from 'vitest';
import { Hono } from 'hono';
import { HonoEndpoint } from '../endpoints/HonoEndpointAdaptor';

describe('HonoEndpointAdaptor Performance', () => {
  describe('Current Implementation', () => {
    bench('simple endpoint', async () => {
      // Test current implementation
    });

    bench('auth endpoint', async () => {
      // Test current implementation
    });

    bench('database endpoint', async () => {
      // Test current implementation
    });

    bench('complex endpoint', async () => {
      // Test current implementation
    });
  });

  describe('Strategy A: Lazy Services', () => {
    // Same benchmarks with Strategy A
  });

  describe('Strategy B: Pre-compiled Handlers', () => {
    // Same benchmarks with Strategy B
  });

  describe('Strategy C: Middleware Composition', () => {
    // Same benchmarks with Strategy C
  });

  describe('Strategy D: Opt-in Events', () => {
    // Same benchmarks with Strategy D
  });
});
```

### Load Testing with autocannon

```bash
# Simple endpoint baseline
autocannon -c 100 -d 30 http://localhost:3000/health

# Auth endpoint
autocannon -c 100 -d 30 -H "Authorization=Bearer token" http://localhost:3000/profile

# Database endpoint
autocannon -c 50 -d 30 http://localhost:3000/users

# Complex endpoint (POST)
autocannon -c 50 -d 30 -m POST -H "Content-Type=application/json" \
  -b '{"items":[{"sku":"123","qty":1}]}' \
  http://localhost:3000/orders
```

---

## Decision Matrix

| Strategy | Performance | Complexity | Migration | Maintainability | Risk |
|----------|-------------|------------|-----------|-----------------|------|
| A: Lazy Services | +20-40% | Low | Easy | Good | Low |
| B: Pre-compiled | +30-50% | High | Medium | Poor | Medium |
| C: Middleware | +15-25% | Medium | Medium | Excellent | Low |
| D: Opt-in Events | +5-15% | Low | Easy | Good | Low |
| E: Typed Context | ~0% | Low | Easy | Excellent | Low |

### Recommended Combination

Based on analysis, the optimal approach may be combining strategies:

1. **Strategy A + D** (Quick Wins)
   - Lazy service resolution
   - Opt-in event publishing
   - Low risk, medium impact

2. **Strategy C + E** (Architecture Improvement)
   - Middleware composition
   - Typed context
   - Better long-term maintainability

3. **Strategy B** (Maximum Performance)
   - Pre-compiled handlers
   - Only if benchmarks show significant gains
   - Higher maintenance cost

---

## Next Steps

1. [ ] Set up benchmark infrastructure
2. [ ] Implement Strategy A (Lazy Services)
3. [ ] Implement Strategy C (Middleware Composition)
4. [ ] Implement Strategy D (Opt-in Events)
5. [ ] Run comprehensive benchmarks
6. [ ] Document findings
7. [ ] Select and implement winning approach

---

## Appendix: Current Code References

### Key Functions to Modify

| Function | File | Lines | Purpose |
|----------|------|-------|---------|
| `addRoutes` | HonoEndpointAdaptor.ts | 169-231 | Route registration |
| `addRoute` | HonoEndpointAdaptor.ts | 232-545 | Single route setup |
| `applyEventMiddleware` | HonoEndpointAdaptor.ts | 122-149 | Event publishing |
| `createAuditContext` | processAudits.ts | 249-287 | Audit setup |
| `withRlsContext` | rls.ts | 50-100 | RLS handling |

### Dependencies to Consider

- `@geekmidas/services` - ServiceDiscovery
- `@geekmidas/logger` - Logger interface
- `@geekmidas/audit` - Audit storage
- `hono` - Framework
- `hono/validator` - Validation middleware

---

## Benchmark Results

### Test Environment
- **Machine**: macOS (Darwin 25.1.0)
- **Runtime**: Node.js 22
- **Test Tool**: Vitest bench
- **Date**: 2026-01-06

### Baseline Comparison

| Implementation | Requests/sec | Relative |
|----------------|--------------|----------|
| Raw Hono | 309,292 | 1.00x (baseline) |
| HonoEndpoint adaptor | 59,789 | **5.17x slower** |

**Key Finding**: The current HonoEndpoint adaptor has ~5x overhead compared to raw Hono.

---

### Strategy Comparison: Simple Endpoint (GET /health)

| Strategy | Requests/sec | vs Current | vs Raw Hono |
|----------|--------------|------------|-------------|
| Strategy C: Minimal (no middleware) | 339,246 | **4.60x faster** | 1.09x slower |
| Strategy C: Middleware Composition | 82,735 | 1.12x faster | 3.74x slower |
| Strategy A: Lazy Services | 82,248 | 1.11x faster | 3.76x slower |
| Combined: Fully Optimized | 81,997 | 1.11x faster | 3.77x slower |
| Strategy D: Opt-in Events | 81,670 | 1.11x faster | 3.79x slower |
| Current Implementation | 73,829 | 1.00x | 4.19x slower |

**Key Insight**: The Minimal approach achieves near-raw-Hono performance (only 9% overhead vs 5.17x).

---

### Strategy Comparison: Auth Endpoint (GET /profile)

| Strategy | Requests/sec | vs Current |
|----------|--------------|------------|
| Strategy A: Lazy Services | 81,539 | **1.11x faster** |
| Strategy C: Middleware Composition | 80,703 | 1.10x faster |
| Combined: Fully Optimized | 79,896 | 1.09x faster |
| Strategy D: Opt-in Events | 77,534 | 1.06x faster |
| Current Implementation | 73,146 | 1.00x |

---

### Strategy Comparison: Database Endpoint (GET /users)

| Strategy | Requests/sec | vs Current |
|----------|--------------|------------|
| Strategy D: Opt-in Events | 82,649 | **1.14x faster** |
| Strategy C: Middleware Composition | 82,517 | 1.14x faster |
| Combined: Fully Optimized | 81,644 | 1.13x faster |
| Strategy A: Lazy Services | 81,188 | 1.12x faster |
| Current Implementation | 72,379 | 1.00x |

---

### Strategy Comparison: Complex Endpoint (POST /orders)

| Strategy | Requests/sec | vs Current |
|----------|--------------|------------|
| Strategy D: Opt-in Events | 87,014 | **1.16x faster** |
| Strategy C: Middleware Composition | 86,134 | 1.14x faster |
| Combined: Fully Optimized | 85,432 | 1.13x faster |
| Strategy A: Lazy Services | 82,598 | 1.10x faster |
| Current Implementation | 75,295 | 1.00x |

---

### Memory Pressure: 100 Sequential Requests

| Strategy | Requests/sec | vs Current |
|----------|--------------|------------|
| Strategy C: Middleware Composition | 825 | **1.14x faster** |
| Strategy A: Lazy Services | 818 | 1.13x faster |
| Strategy D: Opt-in Events | 818 | 1.13x faster |
| Combined: Fully Optimized | 785 | 1.09x faster |
| Current Implementation | 723 | 1.00x |

---

### Concurrent Requests: 100 Parallel

| Strategy | Requests/sec | vs Current |
|----------|--------------|------------|
| Strategy C: Middleware Composition | 891 | **1.15x faster** |
| Combined: Fully Optimized | 888 | 1.14x faster |
| Strategy D: Opt-in Events | 888 | 1.14x faster |
| Strategy A: Lazy Services | 887 | 1.14x faster |
| Current Implementation | 777 | 1.00x |

---

### Validation Overhead

| Implementation | Requests/sec | vs Current |
|----------------|--------------|------------|
| No validation (baseline) | 112,738 | 2.12x faster |
| Manual Zod validation | 112,058 | 2.11x faster |
| Optimized HonoEndpoint | 71,114 | **1.34x faster** |
| Current HonoEndpoint | 53,130 | 1.00x |

---

### App Setup Performance

| Strategy | Setups/sec | vs Current |
|----------|------------|------------|
| Current Implementation | 134,565 | 1.00x (fastest) |
| Strategy D: Opt-in Events | 130,078 | 1.03x slower |
| Strategy A: Lazy Services | 116,664 | 1.15x slower |
| Combined: Fully Optimized | 112,307 | 1.20x slower |
| Strategy C: Middleware Composition | 94,000 | 1.43x slower |

**Note**: Setup happens once at application startup, so slower setup time is acceptable if request handling is faster.

---

## Analysis and Recommendations

### Key Findings

1. **5x Overhead Confirmed**: The current implementation has significant overhead compared to raw Hono (~5.17x slower).

2. **All Strategies Improve Performance**: Every optimization strategy tested improves upon the current implementation by 10-16% for request handling.

3. **Minimal Approach is Dramatically Faster**: For simple endpoints without auth/services, the minimal approach achieves near-raw-Hono performance (339,246 vs 309,292 req/sec).

4. **Strategy C and D Consistently Win**: Middleware Composition and Opt-in Events perform best across most scenarios.

5. **Combined Strategy Has Diminishing Returns**: The combined approach doesn't always beat individual strategies, suggesting some overhead from layering optimizations.

6. **Validation Optimization Significant**: The optimized validation is 34% faster than current implementation.

### Performance Summary by Endpoint Type

| Endpoint Type | Best Strategy | Improvement |
|--------------|---------------|-------------|
| Simple (no features) | Minimal | **4.60x faster** |
| Auth-only | Strategy A | 1.11x faster |
| Database | Strategy D | 1.14x faster |
| Complex (auth + db + services) | Strategy D | 1.16x faster |
| POST with validation | Combined | 1.14x faster |
| Query parameters | Strategy D | 1.13x faster |

### Recommended Implementation

Based on the benchmark results, the recommended approach is a **hybrid strategy**:

#### Tier 1: Simple Endpoints (No Auth, No Services, No Audits)
Use the **Minimal** approach for maximum performance. This gives near-raw-Hono performance.

```typescript
// When endpoint has no complex features, use minimal handler
if (!hasAuth && !hasServices && !hasAudits && !hasRateLimit) {
  return createMinimalHandler(endpoint);
}
```

#### Tier 2: Standard Endpoints (Some Features)
Use **Strategy C + D** (Middleware Composition + Opt-in Events):
- Break monolithic handler into composable middleware
- Only add event publishing to routes that need it
- Early exit on auth/validation failures

```typescript
// For endpoints with features, use middleware composition
const middlewares = [
  hasAuth ? createAuthMiddleware(endpoint) : null,
  hasRateLimit ? createRateLimitMiddleware(endpoint) : null,
  hasEvents ? createEventPublishMiddleware(endpoint) : null,
].filter(Boolean);

app[method](route, ...validators, ...middlewares, handler);
```

#### Tier 3: Complex Endpoints (Full Features)
Use **Combined** approach with lazy service resolution for endpoints with many services.

### Implementation Priority

1. **Phase 1 (Quick Win)**: Implement Strategy D - Opt-in Events
   - Lowest risk, easy migration
   - 13-16% improvement for all endpoint types
   - Remove global event middleware

2. **Phase 2 (Medium Effort)**: Implement Strategy C - Middleware Composition
   - Refactor monolithic handler into composable pieces
   - Better testability and maintainability
   - 10-14% additional improvement

3. **Phase 3 (Future)**: Implement Tiered Handler Selection
   - Auto-detect endpoint complexity at registration
   - Use minimal handler for simple endpoints
   - Full middleware chain for complex endpoints

### Migration Path

1. Add feature detection at route registration time
2. Create minimal handler variant for simple endpoints
3. Extract auth/rateLimit/audit into separate middleware factories
4. Make event publishing per-route instead of global
5. Update existing tests to verify behavior unchanged
6. Benchmark in production-like environment

---

## Conclusion

The investigation confirms significant optimization opportunities in the HonoEndpoint adaptor. The recommended phased approach provides:

- **Immediate wins** (10-16% improvement) with low risk
- **Architecture improvements** for better maintainability
- **Path to near-raw-Hono performance** for simple endpoints

The benchmark infrastructure is now in place for ongoing performance monitoring and future optimization validation.

---

## Build-Time Code Generation Strategy

### Overview

The ultimate optimization is moving feature analysis from runtime to build time. Instead of checking endpoint features on every request, we generate specialized handler code during `gkm build --production`.

### Current Runtime Flow (Slow)

```
Every Request:
  ├── Global event middleware runs (even for 404s)
  ├── Check: hasAuth? hasServices? hasEvents? hasAudits?
  ├── Branch through 260-line monolithic handler
  ├── Create ResponseBuilder, parse headers/cookies
  └── Execute handler with all overhead
```

### Proposed Build-Time Flow (Fast)

```
Build Time (gkm build --production):
  ├── Analyze each endpoint's features
  ├── Generate specialized handler code per endpoint
  └── Output optimized app.generated.ts

Runtime:
  └── Execute pre-generated handlers (zero feature detection)
```

### Endpoint Analysis at Build Time

```typescript
// packages/cli/src/build/endpoint-analyzer.ts
interface EndpointAnalysis {
  route: string;
  method: string;
  features: {
    hasAuth: boolean;
    hasServices: boolean;
    hasDatabase: boolean;
    hasBodyValidation: boolean;
    hasQueryValidation: boolean;
    hasParamValidation: boolean;
    hasAudits: boolean;
    hasEvents: boolean;
    hasRateLimit: boolean;
    hasRls: boolean;
  };
  tier: 'minimal' | 'standard' | 'full';
  requiredEnvVars: string[];  // For env sniffer
}
```

### Generated Handler Tiers

#### Tier 1: Minimal (Health Checks, Public Endpoints)

Input:
```typescript
export const healthEndpoint = e
  .get('/health')
  .output(z.object({ status: z.string() }))
  .handle(async () => ({ status: 'ok' }));
```

Generated:
```typescript
// Zero overhead - nearly identical to raw Hono
app.get('/health', (c) => c.json({ status: 'ok' }, 200));
```

#### Tier 2: Standard (Auth, Services, Validation)

Input:
```typescript
export const getUsers = e
  .get('/users')
  .services([dbService])
  .output(z.array(userSchema))
  .handle(async ({ services }) => {
    return services.database.selectFrom('users').execute();
  });
```

Generated:
```typescript
app.get('/users', async (c) => {
  const { database } = await serviceDiscovery.register([dbService]);
  const result = await getUsers.handler({ services: { database }, logger });
  return c.json(result, 200);
});
```

#### Tier 3: Full (Complex Endpoints)

Input:
```typescript
export const createOrder = e
  .post('/orders')
  .authorizer('jwt')
  .services([dbService, cacheService])
  .body(orderSchema)
  .events([orderCreatedEvent])
  .audit('order.created', ctx => ({ orderId: ctx.response.id }))
  .handle(async ({ body, services, session }) => { ... });
```

Generated:
```typescript
app.post('/orders',
  // Only body validator (query/param not needed)
  validator('json', async (value, c) => {
    const parsed = await orderSchema['~standard'].validate(value);
    if (parsed.issues) return c.json(parsed.issues, 422);
    return parsed.value;
  }),
  // Auth middleware
  async (c, next) => {
    const session = await extractSession(c);
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    c.set('session', session);
    await next();
  },
  // Event middleware (only for this route)
  async (c, next) => {
    await next();
    if (c.res.status < 400) {
      await publishEvents([orderCreatedEvent], c.get('response'));
    }
  },
  // Core handler
  async (c) => {
    const services = await serviceDiscovery.register([dbService, cacheService]);
    const result = await createOrder.handler({ ... });
    c.set('response', result);
    return c.json(result, 201);
  }
);
```

---

## Service Initialization Strategy

### Design Principles

1. **No Pre-warming**: Services initialize on first use, not at startup
2. **Fault Isolation**: Service failures are scoped to endpoints using that service
3. **Env Validation at Startup**: Validate required env vars exist, but don't connect

### Why No Pre-warming?

| Approach | Startup | First Request | Fault Handling |
|----------|---------|---------------|----------------|
| Pre-warm all | Slow (all services connect) | Fast | App fails if any service fails |
| **Lazy init** | Fast (no connections) | Slower (first use) | Only affected endpoint fails |

### ServiceDiscovery Caching

The `ServiceDiscovery` already caches service instances:

```typescript
async register<T extends Service[]>(services: T): Promise<ServiceRecord<T>> {
  for (const service of services) {
    if (this.instances.has(name)) {
      // Already registered - return from cache (instant)
      registeredServices[name] = this.instances.get(name);
      continue;
    }
    // First time - actually register
    const instance = await service.register(this.envParser);
    this.instances.set(name, instance);
  }
  return registeredServices;
}
```

### Request Flow with Lazy Init

```
Startup:
  ├── Env Sniffer validates all required vars exist
  ├── Routes registered (no service connections)
  └── Server listening ✓

Request 1: GET /health
  └── No services needed → instant response

Request 2: GET /users (first)
  └── serviceDiscovery.register([dbService])
      └── Database connects (cost absorbed here)
      └── Cached for future requests

Request 3: GET /users (subsequent)
  └── serviceDiscovery.register([dbService])
      └── instances.has('database') → true
      └── Return cached instance (instant)

Request 4: POST /orders (first)
  └── serviceDiscovery.register([dbService, cacheService])
      ├── dbService → cached (instant)
      └── cacheService → connects (cost absorbed)
```

---

## Environment Validation at Startup

### Integration with Env Sniffer

The existing `@geekmidas/envkit/sniffer` can validate required env vars at startup without initializing services.

### Build-Time: Collect Required Env Vars

```typescript
// packages/cli/src/build/env-collector.ts
function collectRequiredEnvVars(endpoints: Endpoint[]): string[] {
  const envVars = new Set<string>();

  for (const endpoint of endpoints) {
    for (const service of endpoint.services) {
      // Extract env vars from service.register() implementation
      // This requires static analysis or convention
      const serviceEnvVars = analyzeServiceEnvVars(service);
      serviceEnvVars.forEach(v => envVars.add(v));
    }
  }

  return Array.from(envVars);
}
```

### Generated Validation

```typescript
// .gkm/server/env-validation.generated.ts
import { EnvironmentParser } from '@geekmidas/envkit';

export function validateEnvironment(): void {
  const envParser = new EnvironmentParser(process.env);

  // Collected from all services at build time
  const config = envParser.create((get) => ({
    DATABASE_URL: get('DATABASE_URL').string(),
    REDIS_URL: get('REDIS_URL').string(),
    JWT_SECRET: get('JWT_SECRET').string(),
    // ... all required vars
  }));

  // This throws if any are missing
  config.parse();
}
```

### Startup Sequence

```typescript
// .gkm/server/server.ts (generated)
import { validateEnvironment } from './env-validation.generated';
import { createApp } from './app.generated';

// Step 1: Validate env vars exist (fail fast, no connections)
validateEnvironment();

// Step 2: Create app (routes registered, no service init)
const { app } = await createApp();

// Step 3: Start server
serve(app, { port: process.env.PORT || 3000 });
```

---

## Complete Production Build Flow

```
gkm build --production
    │
    ├── 1. Discover endpoints (glob patterns)
    │
    ├── 2. Analyze each endpoint
    │   ├── Extract features (auth, services, events, etc.)
    │   ├── Determine handler tier (minimal/standard/full)
    │   └── Collect required env vars
    │
    ├── 3. Generate optimized code
    │   ├── app.generated.ts (tier-based handlers)
    │   ├── env-validation.generated.ts (startup validation)
    │   └── server.ts (entry point)
    │
    ├── 4. Bundle with tsdown
    │   └── dist/server.mjs
    │
    └── 5. Output
        └── .gkm/server/dist/server.mjs (production-ready)
```

---

## Expected Performance Improvements

| Endpoint Type | Current | Build-Time Generated | Improvement |
|---------------|---------|---------------------|-------------|
| Simple (health) | 73,829 req/s | ~300,000 req/s | **4x faster** |
| Standard (auth/db) | ~75,000 req/s | ~150,000 req/s | **2x faster** |
| Complex (full features) | ~75,000 req/s | ~100,000 req/s | **1.3x faster** |

### Why Simple Gets the Biggest Win

Simple endpoints currently pay for:
- Global event middleware (removed in generated code)
- Feature detection branching (eliminated at build time)
- Validator setup (skipped when no schemas)
- ResponseBuilder creation (inlined)

With build-time generation, simple endpoints become nearly identical to raw Hono.

---

## Implementation Roadmap

### Phase 1: Runtime Optimizations (Quick Wins)
- [ ] Remove global event middleware
- [ ] Conditional validator creation
- [ ] Feature detection at route registration (not per-request)

### Phase 2: Build-Time Generation
- [ ] Endpoint analyzer in CLI
- [ ] Handler template system (minimal/standard/full)
- [ ] Env var collector for sniffer integration

### Phase 3: Production Integration
- [ ] `gkm build --production` generates optimized code
- [ ] Env validation at startup
- [ ] Lazy service initialization preserved
- [ ] Benchmark validation

---

## Files Reference

### Benchmark Infrastructure
- `packages/constructs/src/__benchmarks__/fixtures.ts` - Test endpoints
- `packages/constructs/src/__benchmarks__/hono-adaptor.bench.ts` - Benchmark suite
- `packages/constructs/src/__benchmarks__/strategies/` - Strategy implementations

### Strategy Implementations
- `strategy-a-lazy-services.ts` - Lazy service resolution with caching
- `strategy-c-middleware.ts` - Middleware composition pattern
- `strategy-d-opt-in-events.ts` - Per-route event publishing
