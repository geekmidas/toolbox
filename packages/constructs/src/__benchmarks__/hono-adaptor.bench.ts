/**
 * Hono Adaptor Performance Benchmarks
 *
 * Run with: pnpm bench packages/constructs/src/__benchmarks__/hono-adaptor.bench.ts
 *
 * Compares:
 * - Current HonoEndpoint implementation
 * - Strategy A: Lazy Service Resolution
 * - Strategy C: Middleware Composition
 * - Strategy D: Opt-in Event Publishing
 * - Combined: Fully Optimized (A + C + D)
 */
import { EnvironmentParser } from '@geekmidas/envkit';
import { ServiceDiscovery } from '@geekmidas/services';
import { Hono } from 'hono';
import { bench, describe } from 'vitest';
import { HonoEndpoint } from '../endpoints/HonoEndpointAdaptor';
import { allEndpoints, mockLogger, simpleEndpoint } from './fixtures';
import { OptimizedHonoEndpoint } from './strategies/strategy-a-lazy-services';
import {
  MiddlewareHonoEndpoint,
  MinimalHonoEndpoint,
} from './strategies/strategy-c-middleware';
import {
  FullyOptimizedHonoEndpoint,
  OptInEventHonoEndpoint,
} from './strategies/strategy-d-opt-in-events';

// ============================================================================
// Test Setup
// ============================================================================

const envParser = new EnvironmentParser({});

function createTestApp(
  endpoints: typeof allEndpoints,
  adaptor: typeof HonoEndpoint = HonoEndpoint,
) {
  const app = new Hono();
  const serviceDiscovery = ServiceDiscovery.getInstance(mockLogger, envParser);
  adaptor.addRoutes(endpoints as any, serviceDiscovery as any, app);
  return app;
}

// Pre-create apps for benchmarks (measure request handling, not setup)
const currentApp = createTestApp(allEndpoints, HonoEndpoint);
const lazyServicesApp = createTestApp(allEndpoints, OptimizedHonoEndpoint);
const middlewareApp = createTestApp(allEndpoints, MiddlewareHonoEndpoint);
const minimalApp = createTestApp(allEndpoints, MinimalHonoEndpoint);
const optInEventsApp = createTestApp(allEndpoints, OptInEventHonoEndpoint);
const fullyOptimizedApp = createTestApp(
  allEndpoints,
  FullyOptimizedHonoEndpoint,
);

// Simple apps for focused comparison
const currentSimpleApp = createTestApp([simpleEndpoint] as any, HonoEndpoint);
const lazySimpleApp = createTestApp(
  [simpleEndpoint] as any,
  OptimizedHonoEndpoint,
);
const middlewareSimpleApp = createTestApp(
  [simpleEndpoint] as any,
  MiddlewareHonoEndpoint,
);
const minimalSimpleApp = createTestApp(
  [simpleEndpoint] as any,
  MinimalHonoEndpoint,
);
const optInSimpleApp = createTestApp(
  [simpleEndpoint] as any,
  OptInEventHonoEndpoint,
);
const fullyOptimizedSimpleApp = createTestApp(
  [simpleEndpoint] as any,
  FullyOptimizedHonoEndpoint,
);

// ============================================================================
// Request Factory Helpers
// ============================================================================

function createRequest(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const { method = 'GET', body, headers = {} } = options;

  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body) {
    init.body = JSON.stringify(body);
  }

  return new Request(`http://localhost${path}`, init);
}

// ============================================================================
// Baseline: Raw Hono vs Current Implementation
// ============================================================================

describe('Baseline: Raw Hono vs HonoEndpoint', () => {
  // Raw Hono baseline
  const rawHono = new Hono();
  rawHono.get('/health', (c) =>
    c.json({ status: 'ok', timestamp: Date.now() }),
  );

  bench('raw Hono (baseline)', async () => {
    const req = createRequest('/health');
    await rawHono.fetch(req);
  });

  bench('HonoEndpoint adaptor (current)', async () => {
    const req = createRequest('/health');
    await currentSimpleApp.fetch(req);
  });
});

// ============================================================================
// Strategy Comparison: Simple Endpoint
// ============================================================================

describe('Strategy Comparison: Simple Endpoint (GET /health)', () => {
  const req = createRequest('/health');

  bench('Current Implementation', async () => {
    await currentSimpleApp.fetch(req);
  });

  bench('Strategy A: Lazy Services', async () => {
    await lazySimpleApp.fetch(req);
  });

  bench('Strategy C: Middleware Composition', async () => {
    await middlewareSimpleApp.fetch(req);
  });

  bench('Strategy C: Minimal (no middleware)', async () => {
    await minimalSimpleApp.fetch(req);
  });

  bench('Strategy D: Opt-in Events', async () => {
    await optInSimpleApp.fetch(req);
  });

  bench('Combined: Fully Optimized (A+C+D)', async () => {
    await fullyOptimizedSimpleApp.fetch(req);
  });
});

// ============================================================================
// Strategy Comparison: Auth Endpoint
// ============================================================================

describe('Strategy Comparison: Auth Endpoint (GET /profile)', () => {
  const req = createRequest('/profile', {
    headers: { Authorization: 'Bearer test-token' },
  });

  bench('Current Implementation', async () => {
    await currentApp.fetch(req);
  });

  bench('Strategy A: Lazy Services', async () => {
    await lazyServicesApp.fetch(req);
  });

  bench('Strategy C: Middleware Composition', async () => {
    await middlewareApp.fetch(req);
  });

  bench('Strategy D: Opt-in Events', async () => {
    await optInEventsApp.fetch(req);
  });

  bench('Combined: Fully Optimized (A+C+D)', async () => {
    await fullyOptimizedApp.fetch(req);
  });
});

// ============================================================================
// Strategy Comparison: Database Endpoint
// ============================================================================

describe('Strategy Comparison: Database Endpoint (GET /users)', () => {
  const req = createRequest('/users');

  bench('Current Implementation', async () => {
    await currentApp.fetch(req);
  });

  bench('Strategy A: Lazy Services', async () => {
    await lazyServicesApp.fetch(req);
  });

  bench('Strategy C: Middleware Composition', async () => {
    await middlewareApp.fetch(req);
  });

  bench('Strategy D: Opt-in Events', async () => {
    await optInEventsApp.fetch(req);
  });

  bench('Combined: Fully Optimized (A+C+D)', async () => {
    await fullyOptimizedApp.fetch(req);
  });
});

// ============================================================================
// Strategy Comparison: Complex Endpoint
// ============================================================================

describe('Strategy Comparison: Complex Endpoint (POST /orders)', () => {
  const req = createRequest('/orders', {
    method: 'POST',
    body: { items: [{ sku: 'SKU001', qty: 2 }] },
    headers: { Authorization: 'Bearer test-token' },
  });

  bench('Current Implementation', async () => {
    await currentApp.fetch(req);
  });

  bench('Strategy A: Lazy Services', async () => {
    await lazyServicesApp.fetch(req);
  });

  bench('Strategy C: Middleware Composition', async () => {
    await middlewareApp.fetch(req);
  });

  bench('Strategy D: Opt-in Events', async () => {
    await optInEventsApp.fetch(req);
  });

  bench('Combined: Fully Optimized (A+C+D)', async () => {
    await fullyOptimizedApp.fetch(req);
  });
});

// ============================================================================
// Strategy Comparison: POST with Validation
// ============================================================================

describe('Strategy Comparison: POST with Body Validation (POST /users)', () => {
  const req = createRequest('/users', {
    method: 'POST',
    body: { name: 'Test User', email: 'test@example.com' },
  });

  bench('Current Implementation', async () => {
    await currentApp.fetch(req);
  });

  bench('Strategy A: Lazy Services', async () => {
    await lazyServicesApp.fetch(req);
  });

  bench('Strategy C: Middleware Composition', async () => {
    await middlewareApp.fetch(req);
  });

  bench('Strategy D: Opt-in Events', async () => {
    await optInEventsApp.fetch(req);
  });

  bench('Combined: Fully Optimized (A+C+D)', async () => {
    await fullyOptimizedApp.fetch(req);
  });
});

// ============================================================================
// Strategy Comparison: Query Parameters
// ============================================================================

describe('Strategy Comparison: Query Params (GET /search)', () => {
  const req = createRequest('/search?q=test&page=1&limit=10');

  bench('Current Implementation', async () => {
    await currentApp.fetch(req);
  });

  bench('Strategy A: Lazy Services', async () => {
    await lazyServicesApp.fetch(req);
  });

  bench('Strategy C: Middleware Composition', async () => {
    await middlewareApp.fetch(req);
  });

  bench('Strategy D: Opt-in Events', async () => {
    await optInEventsApp.fetch(req);
  });

  bench('Combined: Fully Optimized (A+C+D)', async () => {
    await fullyOptimizedApp.fetch(req);
  });
});

// ============================================================================
// App Setup Performance
// ============================================================================

describe('App Setup Performance', () => {
  bench('Current: setup with 8 endpoints', () => {
    const app = new Hono();
    const sd = ServiceDiscovery.getInstance(mockLogger, envParser);
    HonoEndpoint.addRoutes(allEndpoints as any, sd as any, app);
  });

  bench('Strategy A: setup with 8 endpoints', () => {
    const app = new Hono();
    const sd = ServiceDiscovery.getInstance(mockLogger, envParser);
    OptimizedHonoEndpoint.addRoutes(allEndpoints as any, sd as any, app);
  });

  bench('Strategy C: setup with 8 endpoints', () => {
    const app = new Hono();
    const sd = ServiceDiscovery.getInstance(mockLogger, envParser);
    MiddlewareHonoEndpoint.addRoutes(allEndpoints as any, sd as any, app);
  });

  bench('Strategy D: setup with 8 endpoints', () => {
    const app = new Hono();
    const sd = ServiceDiscovery.getInstance(mockLogger, envParser);
    OptInEventHonoEndpoint.addRoutes(allEndpoints as any, sd as any, app);
  });

  bench('Combined: setup with 8 endpoints', () => {
    const app = new Hono();
    const sd = ServiceDiscovery.getInstance(mockLogger, envParser);
    FullyOptimizedHonoEndpoint.addRoutes(allEndpoints as any, sd as any, app);
  });
});

// ============================================================================
// Memory Pressure Tests
// ============================================================================

describe('Memory Pressure: 100 Sequential Requests', () => {
  const req = createRequest('/health');

  bench('Current Implementation', async () => {
    for (let i = 0; i < 100; i++) {
      await currentApp.fetch(req);
    }
  });

  bench('Strategy A: Lazy Services', async () => {
    for (let i = 0; i < 100; i++) {
      await lazyServicesApp.fetch(req);
    }
  });

  bench('Strategy C: Middleware Composition', async () => {
    for (let i = 0; i < 100; i++) {
      await middlewareApp.fetch(req);
    }
  });

  bench('Strategy D: Opt-in Events', async () => {
    for (let i = 0; i < 100; i++) {
      await optInEventsApp.fetch(req);
    }
  });

  bench('Combined: Fully Optimized', async () => {
    for (let i = 0; i < 100; i++) {
      await fullyOptimizedApp.fetch(req);
    }
  });
});

// ============================================================================
// Concurrent Requests
// ============================================================================

describe('Concurrent Requests: 100 Parallel', () => {
  const req = createRequest('/health');

  bench('Current Implementation', async () => {
    await Promise.all(
      Array(100)
        .fill(null)
        .map(() => currentApp.fetch(req)),
    );
  });

  bench('Strategy A: Lazy Services', async () => {
    await Promise.all(
      Array(100)
        .fill(null)
        .map(() => lazyServicesApp.fetch(req)),
    );
  });

  bench('Strategy C: Middleware Composition', async () => {
    await Promise.all(
      Array(100)
        .fill(null)
        .map(() => middlewareApp.fetch(req)),
    );
  });

  bench('Strategy D: Opt-in Events', async () => {
    await Promise.all(
      Array(100)
        .fill(null)
        .map(() => optInEventsApp.fetch(req)),
    );
  });

  bench('Combined: Fully Optimized', async () => {
    await Promise.all(
      Array(100)
        .fill(null)
        .map(() => fullyOptimizedApp.fetch(req)),
    );
  });
});

// ============================================================================
// Validation Overhead Comparison
// ============================================================================

describe('Validation Overhead', () => {
  // Without validation
  const noValidationApp = new Hono();
  noValidationApp.post('/test', async (c) => {
    const body = await c.req.json();
    return c.json({ received: body });
  });

  // With manual Zod validation
  const { z } = require('zod');
  const schema = z.object({ name: z.string(), email: z.string().email() });

  const manualValidationApp = new Hono();
  manualValidationApp.post('/test', async (c) => {
    const body = await c.req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error }, 400);
    }
    return c.json({ received: parsed.data });
  });

  const testBody = { name: 'Test', email: 'test@example.com' };

  bench('no validation (baseline)', async () => {
    await noValidationApp.fetch(
      createRequest('/test', { method: 'POST', body: testBody }),
    );
  });

  bench('manual Zod validation', async () => {
    await manualValidationApp.fetch(
      createRequest('/test', { method: 'POST', body: testBody }),
    );
  });

  bench('Current HonoEndpoint validation', async () => {
    await currentApp.fetch(
      createRequest('/users', { method: 'POST', body: testBody }),
    );
  });

  bench('Optimized HonoEndpoint validation', async () => {
    await fullyOptimizedApp.fetch(
      createRequest('/users', { method: 'POST', body: testBody }),
    );
  });
});

// ============================================================================
// Middleware Overhead Analysis
// ============================================================================

describe('Middleware Overhead Analysis', () => {
  // App with no middleware
  const noMiddlewareApp = new Hono();
  noMiddlewareApp.get('/test', (c) => c.json({ ok: true }));

  // App with timing middleware
  const { timing } = require('hono/timing');
  const timingApp = new Hono();
  timingApp.use('*', timing());
  timingApp.get('/test', (c) => c.json({ ok: true }));

  // App with multiple middleware
  const multiMiddlewareApp = new Hono();
  multiMiddlewareApp.use('*', async (c, next) => {
    c.set('startTime' as any, Date.now());
    await next();
  });
  multiMiddlewareApp.use('*', async (c, next) => {
    await next();
    // Post-processing
  });
  multiMiddlewareApp.get('/test', (c) => c.json({ ok: true }));

  bench('no middleware (baseline)', async () => {
    await noMiddlewareApp.fetch(createRequest('/test'));
  });

  bench('timing middleware only', async () => {
    await timingApp.fetch(createRequest('/test'));
  });

  bench('multiple custom middleware', async () => {
    await multiMiddlewareApp.fetch(createRequest('/test'));
  });

  bench('HonoEndpoint (all features)', async () => {
    await currentApp.fetch(createRequest('/health'));
  });

  bench('Fully Optimized (minimal middleware)', async () => {
    await fullyOptimizedApp.fetch(createRequest('/health'));
  });
});
