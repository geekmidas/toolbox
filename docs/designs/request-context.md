# Request Context for Services

## Problem Statement

Currently, services in the toolbox are singletons that are registered once and cached:

```typescript
// Service is registered once
const instance = await service.register(envParser);
this.instances.set(name, instance); // Cached forever
```

This creates a problem: **services cannot access request-specific context** like:
- Request-scoped logger (with `requestId` for traceability)
- Request ID for correlation
- Other request metadata

### Current Flow (Broken Traceability)

```
Request POST /users (requestId: req-123)
    │
    ▼
HonoEndpointAdaptor
    │ Creates: logger.child({ requestId: 'req-123' })
    │
    ▼
ServiceDiscovery.register([databaseService])
    │ Returns: cached singleton (no request context)
    │
    ▼
services.database.query('INSERT...')
    │ Problem: No access to request logger!
    │ Logs have no requestId correlation
    │
    ▼
Log output: { sql: "INSERT...", msg: "Query" }  // No requestId!
```

### Desired Flow (Full Traceability)

```
Request POST /users (requestId: req-123)
    │
    ▼
All logs correlated:
  { requestId: "req-123", path: "/users", msg: "Request started" }
  { requestId: "req-123", sql: "INSERT...", msg: "Executing query" }
  { requestId: "req-123", sql: "INSERT...", duration: 15, msg: "Query completed" }
  { requestId: "req-123", status: 201, msg: "Request completed" }
```

---

## Proposed Solution

Use Node.js `AsyncLocalStorage` to provide request context that:
1. Follows async execution chains automatically
2. Is isolated between concurrent requests
3. Requires no imports in services (injected via registration)

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Context propagation | AsyncLocalStorage | Standard Node.js API, used by OpenTelemetry |
| Service access | Inject via `register()` | No imports needed in services |
| Logger access | `context.getLogger()` | Returns undefined outside request |
| Backward compatibility | Optional adoption | Existing services continue to work |

---

## API Design

### 1. ServiceContext Interface

```typescript
// packages/services/src/types.ts

import type { Logger } from '@geekmidas/logger';

/**
 * Request context available to services.
 * Methods are guaranteed to return values when called within a request context.
 * Throws if called outside a request context (catches bugs early).
 */
export interface ServiceContext {
  /**
   * Get the current request's logger.
   * @throws Error if called outside a request context
   */
  getLogger(): Logger;

  /**
   * Get the current request ID.
   * @throws Error if called outside a request context
   */
  getRequestId(): string;

  /**
   * Get the current request's start time.
   * Useful for calculating request duration.
   * @throws Error if called outside a request context
   */
  getRequestStartTime(): number;

  /**
   * Check if currently running inside a request context.
   * Use this to guard calls if you need to handle both cases.
   */
  hasContext(): boolean;
}
```

### 2. Updated Service Interface

```typescript
// packages/services/src/types.ts

import type { EnvironmentParser } from '@geekmidas/envkit';

/**
 * Options passed to service register method.
 */
export interface ServiceRegisterOptions {
  /** Environment parser for configuration */
  envParser: EnvironmentParser<{}>;
  /** Request context for logging and tracing */
  context: ServiceContext;
}

/**
 * Service interface with context support.
 */
export interface Service<TName extends string = string, TInstance = unknown> {
  serviceName: TName;
  register(options: ServiceRegisterOptions): TInstance | Promise<TInstance>;
}
```

### 3. Request Context Module

```typescript
// packages/services/src/context.ts

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from '@geekmidas/logger';
import type { ServiceContext } from './types';

/**
 * Internal storage for request context.
 * Not exported - services use ServiceContext interface.
 */
interface RequestContextData {
  logger: Logger;
  requestId: string;
  startTime: number;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContextData>();

/**
 * ServiceContext implementation.
 * Singleton that reads from AsyncLocalStorage.
 * Throws if called outside a request context (catches bugs early).
 */
export const serviceContext: ServiceContext = {
  getLogger() {
    const store = asyncLocalStorage.getStore();
    if (!store) {
      throw new Error(
        'ServiceContext.getLogger() called outside request context. ' +
        'Ensure code runs within runWithRequestContext().'
      );
    }
    return store.logger;
  },

  getRequestId() {
    const store = asyncLocalStorage.getStore();
    if (!store) {
      throw new Error(
        'ServiceContext.getRequestId() called outside request context. ' +
        'Ensure code runs within runWithRequestContext().'
      );
    }
    return store.requestId;
  },

  getRequestStartTime() {
    const store = asyncLocalStorage.getStore();
    if (!store) {
      throw new Error(
        'ServiceContext.getRequestStartTime() called outside request context. ' +
        'Ensure code runs within runWithRequestContext().'
      );
    }
    return store.startTime;
  },

  hasContext() {
    return asyncLocalStorage.getStore() !== undefined;
  },
};

/**
 * Run a function with request context.
 * Used by endpoint/function adaptors.
 *
 * @param data - Request context data
 * @param fn - Function to run with context
 * @returns Result of the function
 *
 * @example
 * ```typescript
 * const result = await runWithRequestContext(
 *   { logger, requestId, startTime: Date.now() },
 *   async () => {
 *     // Inside here, serviceContext.getLogger() returns `logger`
 *     return await handleRequest();
 *   }
 * );
 * ```
 */
export function runWithRequestContext<T>(
  data: RequestContextData,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return asyncLocalStorage.run(data, fn);
}
```

### 4. Updated ServiceDiscovery

```typescript
// packages/services/src/index.ts

import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { serviceContext } from './context';
import type { Service, ServiceContext, ServiceRecord } from './types';

export class ServiceDiscovery<
  TServices extends Record<string, unknown> = {},
  TLogger extends Logger = Logger,
> {
  private static _instance: ServiceDiscovery<any, any>;
  private services = new Map<string, Service>();
  private instances = new Map<keyof TServices, TServices[keyof TServices]>();

  static getInstance<
    T extends Record<any, unknown> = any,
    TLogger extends Logger = Logger,
  >(logger: TLogger, envParser: EnvironmentParser<{}>): ServiceDiscovery<T> {
    if (!ServiceDiscovery._instance) {
      ServiceDiscovery._instance = new ServiceDiscovery<T, TLogger>(
        logger,
        envParser,
      );
    }
    return ServiceDiscovery._instance as ServiceDiscovery<T>;
  }

  private constructor(
    readonly logger: TLogger,
    readonly envParser: EnvironmentParser<{}>,
  ) {}

  async register<T extends Service[]>(services: T): Promise<ServiceRecord<T>> {
    const registeredServices = {} as ServiceRecord<T>;

    for (const service of services) {
      const name = service.serviceName as T[number]['serviceName'];

      if (this.instances.has(name)) {
        (registeredServices as any)[name] = this.instances.get(name);
        continue;
      }

      // Pass both envParser and context
      const instance = await service.register({
        envParser: this.envParser,
        context: serviceContext,  // <-- Injected here
      });

      this.instances.set(name, instance as TServices[keyof TServices]);
      (registeredServices as any)[name] = instance;
    }

    return registeredServices;
  }

  // ... rest of methods unchanged
}
```

---

## Integration Points

### 1. HonoEndpointAdaptor

```typescript
// packages/constructs/src/endpoints/HonoEndpointAdaptor.ts

import { runWithRequestContext } from '@geekmidas/services/context';

/** Header name for request ID (standard across proxies/load balancers) */
const REQUEST_ID_HEADER = 'X-Request-ID';

const handler = async (c: Context) => {
  // Reuse incoming request ID for distributed tracing, or generate new one
  const requestId = c.req.header(REQUEST_ID_HEADER) ?? crypto.randomUUID();
  const startTime = Date.now();

  const logger = endpoint.logger.child({
    requestId,
    endpoint: endpoint.fullPath,
    method: endpoint.method,
    path: c.req.path,
  }) as TLogger;

  // Wrap entire handler in request context
  return runWithRequestContext({ logger, requestId, startTime }, async () => {
    try {
      const services = await serviceDiscovery.register(endpoint.services);

      // ... existing handler logic ...

      const result = await endpoint.handler({
        services,
        logger,
        // ...
      });

      logger.info({ status: 200, duration: Date.now() - startTime }, 'Request completed');

      // Return requestId in response for client correlation
      c.header(REQUEST_ID_HEADER, requestId);
      return c.json(result);

    } catch (error) {
      logger.error({ error, duration: Date.now() - startTime }, 'Request failed');
      // Still set header on error responses
      c.header(REQUEST_ID_HEADER, requestId);
      throw error;
    }
  });
};
```

**Request ID Strategy:**
- Check `X-Request-ID` header first (supports distributed tracing from upstream proxies)
- Generate UUID only if header not present
- Always return `X-Request-ID` in response for client-side correlation

### 2. AWSLambdaEndpointAdaptor

```typescript
// packages/constructs/src/endpoints/AWSLambdaEndpointAdaptor.ts

import { runWithRequestContext } from '@geekmidas/services/context';

/** Header name for request ID */
const REQUEST_ID_HEADER = 'X-Request-ID';

export async function handler(event: APIGatewayEvent, context: LambdaContext) {
  // Reuse AWS request ID - matches CloudWatch logs
  const requestId = context.awsRequestId;
  const startTime = Date.now();

  const logger = baseLogger.child({ requestId });

  return runWithRequestContext({ logger, requestId, startTime }, async () => {
    try {
      // ... handler logic ...

      return {
        statusCode: 200,
        headers: {
          [REQUEST_ID_HEADER]: requestId,
          // ... other headers
        },
        body: JSON.stringify(result),
      };
    } catch (error) {
      return {
        statusCode: error.statusCode ?? 500,
        headers: {
          [REQUEST_ID_HEADER]: requestId,
        },
        body: JSON.stringify({ error: error.message }),
      };
    }
  });
}
```

**AWS Request ID:**
- Reuse `context.awsRequestId` from Lambda context
- Matches CloudWatch logs for easy correlation
- Returned in `X-Request-ID` response header

### 3. FunctionAdaptor (Lambda Functions)

```typescript
// packages/constructs/src/functions/AWSLambdaFunctionAdaptor.ts

import { runWithRequestContext } from '@geekmidas/services/context';

export async function handler(event: any, context: LambdaContext) {
  // Reuse AWS request ID - matches CloudWatch logs
  const requestId = context.awsRequestId;
  const startTime = Date.now();

  const logger = baseLogger.child({ requestId, functionName: context.functionName });

  return runWithRequestContext({ logger, requestId, startTime }, async () => {
    // ... function logic
  });
}
```

**Note:** Lambda functions don't return HTTP responses, so no response header needed.

### 4. SubscriberAdaptor

```typescript
// packages/constructs/src/subscribers/adaptor.ts

import { runWithRequestContext } from '@geekmidas/services/context';

export async function handleMessage(message: Message) {
  // Use message ID for traceability, or generate if not available
  const requestId = message.messageId ?? crypto.randomUUID();
  const startTime = Date.now();

  const logger = baseLogger.child({ requestId, messageType: message.type });

  return runWithRequestContext({ logger, requestId, startTime }, async () => {
    // ... subscriber logic
  });
}
```

**Subscriber Request ID:**
- Use `message.messageId` when available (SQS, SNS provide this)
- Allows tracing from publisher → subscriber

### 5. Telescope Integration

Telescope needs to use the same requestId as ServiceContext for proper log correlation.

**Approach: Inject `getRequestId` function (no coupling)**

Telescope should NOT import from `@geekmidas/services`. Instead, inject a getter function:

```typescript
// packages/telescope/src/types.ts

export interface TelescopeOptions {
  storage: TelescopeStorage;
  enabled?: boolean;
  // ... existing options

  /**
   * Function to get the current request ID from context.
   * If provided, Telescope uses this instead of generating its own ID.
   * Returns undefined when outside a request context.
   */
  getRequestId?: () => string | undefined;
}
```

```typescript
// packages/telescope/src/Telescope.ts

async recordRequest(
  entry: Omit<RequestEntry, 'id' | 'timestamp'>,
): Promise<string> {
  if (!this.options.enabled) return '';

  // Use injected getRequestId if available, otherwise generate
  const id = this.options.getRequestId?.() ?? nanoid();

  const fullEntry: RequestEntry = {
    ...entry,
    id,
    timestamp: new Date(),
  };

  // ... rest of method
}
```

**Usage in gkm dev server:**

```typescript
// packages/cli/src/dev/index.ts

import { serviceContext } from '@geekmidas/services/context';

const telescope = new Telescope({
  storage: new InMemoryStorage(),
  getRequestId: () => serviceContext.hasContext()
    ? serviceContext.getRequestId()
    : undefined,
});
```

**Pino/Console transports - same pattern:**

```typescript
// Pino transport options
const transport = createPinoTransport({
  telescope,
  requestId: () => serviceContext.hasContext()
    ? serviceContext.getRequestId()
    : undefined,
});
```

**Middleware Order (Important)**

The context must be established BEFORE Telescope middleware records:

```typescript
// Correct order in gkm dev server:
app.use('*', async (c, next) => {
  const requestId = c.req.header('X-Request-ID') ?? crypto.randomUUID();
  const startTime = Date.now();
  const logger = baseLogger.child({ requestId });

  // Establish context FIRST
  return runWithRequestContext({ logger, requestId, startTime }, async () => {
    // Now Telescope can read from context via injected getRequestId
    return next();
  });
});

app.use('*', createTelescopeMiddleware(telescope));
```

**Benefits:**
- Telescope remains decoupled from @geekmidas/services
- Single source of truth for requestId
- All logs automatically correlated
- Telescope dashboard shows same ID as response header
- Works with any context provider (not just ServiceContext)

### 6. TestEndpointAdaptor

**Important:** The test adaptor must also wrap execution with request context so services work correctly in tests.

```typescript
// packages/constructs/src/endpoints/TestEndpointAdaptor.ts

import { runWithRequestContext } from '@geekmidas/services/context';

async fullRequest(ctx: TestRequestAdaptor<...>): Promise<TestHttpResponse<...>> {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  const logger = this.endpoint.logger.child({
    requestId,
    route: this.endpoint.route,
    method: this.endpoint.method,
    test: true,
  }) as TLogger;

  // Wrap entire test execution in request context
  return runWithRequestContext({ logger, requestId, startTime }, async () => {
    const body = await this.endpoint.parseInput((ctx as any).body, 'body');
    const query = await this.endpoint.parseInput((ctx as any).query, 'query');
    // ... rest of handler logic
  });
}
```

This ensures:
- Services called during tests have access to request context
- Test logs are correlated with a test-specific requestId
- `context.getLogger()` works without throwing in tests

---

## Service Implementation Examples

### Example 1: Database Service

```typescript
// services/database.ts

import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import { Pool } from 'pg';

interface DatabaseInstance {
  query<T>(sql: string, params?: any[]): Promise<T[]>;
  transaction<T>(fn: (trx: Transaction) => Promise<T>): Promise<T>;
}

export const databaseService = {
  serviceName: 'database' as const,

  register({ envParser, context }: ServiceRegisterOptions): DatabaseInstance {
    const config = envParser.create((get) => ({
      url: get('DATABASE_URL').string(),
      poolSize: get('DB_POOL_SIZE').coerce.number().default(10),
    })).parse();

    const pool = new Pool({
      connectionString: config.url,
      max: config.poolSize,
    });

    return {
      async query<T>(sql: string, params?: any[]): Promise<T[]> {
        const logger = context.getLogger();
        const requestId = context.getRequestId();
        const start = Date.now();

        logger.debug({ sql, params, requestId }, 'Executing query');

        try {
          const result = await pool.query(sql, params);

          logger.debug({
            sql,
            requestId,
            duration: Date.now() - start,
            rowCount: result.rowCount,
          }, 'Query completed');

          return result.rows;
        } catch (error) {
          logger.error({ sql, requestId, error }, 'Query failed');
          throw error;
        }
      },

      async transaction<T>(fn: (trx: Transaction) => Promise<T>): Promise<T> {
        const logger = context.getLogger();
        const requestId = context.getRequestId();

        logger.debug({ requestId }, 'Starting transaction');

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn(client as Transaction);
          await client.query('COMMIT');

          logger.debug({ requestId }, 'Transaction committed');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          logger.error({ requestId, error }, 'Transaction rolled back');
          throw error;
        } finally {
          client.release();
        }
      },
    };
  },
} satisfies Service<'database', DatabaseInstance>;
```

### Example 2: Cache Service

```typescript
// services/cache.ts

import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import { Redis } from 'ioredis';

interface CacheInstance {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export const cacheService = {
  serviceName: 'cache' as const,

  register({ envParser, context }: ServiceRegisterOptions): CacheInstance {
    const config = envParser.create((get) => ({
      url: get('REDIS_URL').string(),
      defaultTtl: get('CACHE_TTL').coerce.number().default(3600),
    })).parse();

    const redis = new Redis(config.url);

    return {
      async get<T>(key: string): Promise<T | null> {
        const logger = context.getLogger();
        const start = Date.now();

        const value = await redis.get(key);

        logger.debug({
          key,
          hit: value !== null,
          duration: Date.now() - start,
        }, 'Cache lookup');

        return value ? JSON.parse(value) : null;
      },

      async set<T>(key: string, value: T, ttl = config.defaultTtl): Promise<void> {
        const logger = context.getLogger();

        await redis.setex(key, ttl, JSON.stringify(value));

        logger.debug({ key, ttl }, 'Cache set');
      },

      async delete(key: string): Promise<void> {
        const logger = context.getLogger();

        await redis.del(key);

        logger.debug({ key }, 'Cache delete');
      },
    };
  },
} satisfies Service<'cache', CacheInstance>;
```

### Example 3: External API Service

```typescript
// services/paymentGateway.ts

import type { Service, ServiceRegisterOptions } from '@geekmidas/services';

interface PaymentGatewayInstance {
  charge(amount: number, currency: string, token: string): Promise<ChargeResult>;
  refund(chargeId: string, amount?: number): Promise<RefundResult>;
}

export const paymentGatewayService = {
  serviceName: 'paymentGateway' as const,

  register({ envParser, context }: ServiceRegisterOptions): PaymentGatewayInstance {
    const config = envParser.create((get) => ({
      apiKey: get('STRIPE_API_KEY').string(),
      webhookSecret: get('STRIPE_WEBHOOK_SECRET').string(),
    })).parse();

    const stripe = new Stripe(config.apiKey);

    return {
      async charge(amount: number, currency: string, token: string) {
        const logger = context.getLogger();
        const requestId = context.getRequestId();
        const start = Date.now();

        logger.info({ amount, currency, requestId }, 'Processing payment');

        try {
          const charge = await stripe.charges.create({
            amount,
            currency,
            source: token,
            metadata: { requestId },
          });

          logger.info({
            chargeId: charge.id,
            amount,
            requestId,
            duration: Date.now() - start,
          }, 'Payment successful');

          return { success: true, chargeId: charge.id };
        } catch (error) {
          logger.error({ error, amount, requestId }, 'Payment failed');
          throw error;
        }
      },

      async refund(chargeId: string, amount?: number) {
        const logger = context.getLogger();
        const requestId = context.getRequestId();

        logger.info({ chargeId, amount, requestId }, 'Processing refund');

        const refund = await stripe.refunds.create({
          charge: chargeId,
          amount,
        });

        logger.info({ refundId: refund.id, requestId }, 'Refund successful');

        return { success: true, refundId: refund.id };
      },
    };
  },
} satisfies Service<'paymentGateway', PaymentGatewayInstance>;
```

---

## Migration Path

### Phase 1: Add Context Support (Non-Breaking)

1. Add `ServiceContext` interface
2. Add `runWithRequestContext` function
3. Update `ServiceDiscovery` to pass context
4. Update Service interface (backward compatible with overloads)

```typescript
// Backward compatible - both signatures work
interface Service<TName extends string = string, TInstance = unknown> {
  serviceName: TName;
  register(
    options: ServiceRegisterOptions | EnvironmentParser<{}>
  ): TInstance | Promise<TInstance>;
}
```

### Phase 2: Update Adaptors

1. Wrap HonoEndpointAdaptor handler with `runWithRequestContext`
2. Wrap AWS Lambda adaptors
3. Wrap Subscriber adaptors
4. Update dev server

### Phase 3: Update Construct.getEnvironment()

Update the sniffer to pass a mock context:

```typescript
const sniffer = new SnifferEnvironmentParser();
const mockContext: ServiceContext = {
  getLogger: () => undefined,
  getRequestId: () => undefined,
  getRequestStartTime: () => undefined,
};

const result = service.register({
  envParser: sniffer as any,
  context: mockContext,
});
```

### Phase 4: Documentation & Examples

1. Update CLAUDE.md with new service pattern
2. Update CLI templates
3. Add migration guide

---

## Performance Considerations

### Benchmarks (Node.js 22)

| Operation | Time | Notes |
|-----------|------|-------|
| `run()` call | ~0.3μs | Once per request |
| `getStore()` call | ~0.1μs | Per service method call |
| Child logger creation | ~1-5μs | Once per request |
| Typical DB query | 1-100ms | 10,000x slower than context |

### Memory Overhead

```
Per active request:
  - Context object: ~100 bytes
  - Logger child bindings: ~200 bytes
  - Total: ~300 bytes per request

10,000 concurrent requests = ~3MB
```

### Best Practices

```typescript
// ✅ Good: Get logger once per method
async query(sql: string) {
  const logger = context.getLogger();
  logger.debug('start');
  // ... work
  logger.debug('end');
}

// ❌ Bad: Get logger in hot loop
async processMany(items: Item[]) {
  for (const item of items) {
    const logger = context.getLogger(); // Don't do this - overhead per iteration
    logger.debug('processing');
  }
}

// ✅ Better: Get once, use many
async processMany(items: Item[]) {
  const logger = context.getLogger();
  for (const item of items) {
    logger.debug('processing');
  }
}
```

---

## Testing

### Unit Testing Services

```typescript
import { describe, it, expect, vi } from 'vitest';
import { databaseService } from './database';

describe('DatabaseService', () => {
  it('should log queries with request context', async () => {
    const mockLogger = {
      debug: vi.fn(),
      error: vi.fn(),
    };

    const mockContext = {
      getLogger: () => mockLogger,
      getRequestId: () => 'test-request-123',
      getRequestStartTime: () => Date.now(),
    };

    const mockEnvParser = {
      create: () => ({
        parse: () => ({ url: 'postgres://localhost/test', poolSize: 5 }),
      }),
    };

    const db = await databaseService.register({
      envParser: mockEnvParser as any,
      context: mockContext,
    });

    await db.query('SELECT 1');

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: 'SELECT 1',
        requestId: 'test-request-123',
      }),
      expect.any(String),
    );
  });
});
```

### Integration Testing with Context

```typescript
import { describe, it, expect } from 'vitest';
import { runWithRequestContext, serviceContext } from '@geekmidas/services/context';

describe('Request Context', () => {
  it('should isolate concurrent requests', async () => {
    const results: string[] = [];

    const request = async (id: string) => {
      const logger = { info: (msg: string) => results.push(`${id}: ${msg}`) };

      return runWithRequestContext(
        { logger, requestId: id, startTime: Date.now() },
        async () => {
          await delay(Math.random() * 10);
          const ctx = serviceContext.getRequestId();
          results.push(`${id} sees: ${ctx}`);
          return ctx;
        },
      );
    };

    const [r1, r2, r3] = await Promise.all([
      request('req-1'),
      request('req-2'),
      request('req-3'),
    ]);

    expect(r1).toBe('req-1');
    expect(r2).toBe('req-2');
    expect(r3).toBe('req-3');
  });
});
```

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/services/src/types.ts` | Add `ServiceContext`, `ServiceRegisterOptions` |
| `packages/services/src/context.ts` | New file - AsyncLocalStorage implementation |
| `packages/services/src/index.ts` | Update `ServiceDiscovery.register()` |
| `packages/constructs/src/Construct.ts` | Update `getEnvironment()` for new signature |
| `packages/constructs/src/endpoints/HonoEndpointAdaptor.ts` | Wrap with `runWithRequestContext` |
| `packages/constructs/src/endpoints/AWSLambdaEndpointAdaptor.ts` | Wrap with `runWithRequestContext` |
| `packages/constructs/src/endpoints/TestEndpointAdaptor.ts` | Wrap with `runWithRequestContext` |
| `packages/constructs/src/functions/*.ts` | Wrap adaptors |
| `packages/constructs/src/subscribers/*.ts` | Wrap adaptors |
| `packages/telescope/src/Telescope.ts` | Add `getRequestId` option, use in `recordRequest()` |
| `packages/telescope/src/types.ts` | Add `getRequestId?: () => string \| undefined` to options |
| `packages/cli/src/dev/index.ts` | Wire up context middleware + inject `getRequestId` to Telescope |
| `packages/cli/src/init/templates/*.ts` | Update service templates |
| `CLAUDE.md` | Update documentation |

---

## Design Decisions

1. **ServiceContext methods are guaranteed (throw if outside context)**
   - Decision: Methods throw if called outside request context
   - Rationale: Catches bugs early, cleaner service code (no `?.` everywhere)
   - Use `context.hasContext()` to guard if needed

2. **Keep context minimal (logger + requestId + startTime)**
   - Decision: Only include what all services need
   - Rationale: Additional data (headers, session) available via handler params

3. **Naming: `ServiceContext`**
   - Decision: Use `ServiceContext` not `RequestContext`
   - Rationale: Emphasizes it's the context interface for services

## Open Questions

1. **Should `context` be optional in `ServiceRegisterOptions`?**
   - Pro: Easier migration, backward compatible
   - Con: Services might forget to use it

---

## Appendix: AsyncLocalStorage Internals

```
┌─────────────────────────────────────────────────────────────────┐
│                     Node.js Event Loop                          │
│                                                                 │
│  Each async operation has an "async ID"                         │
│  AsyncLocalStorage tracks: asyncId → store mapping              │
│                                                                 │
│  run({ data }, fn):                                             │
│    1. Creates new store                                         │
│    2. Associates store with current async context               │
│    3. Executes fn                                               │
│    4. All child async operations inherit the association        │
│                                                                 │
│  getStore():                                                    │
│    1. Gets current async ID                                     │
│    2. Looks up store for that ID                                │
│    3. Returns store (or undefined if outside run())             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```
