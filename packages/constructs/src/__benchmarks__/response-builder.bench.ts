/**
 * Benchmarks for ResponseBuilder and context creation overhead
 *
 * Run with: pnpm bench packages/constructs/src/__benchmarks__/response-builder.bench.ts
 */
import { bench, describe } from 'vitest';
import { z } from 'zod';
import { Endpoint, ResponseBuilder } from '../endpoints/Endpoint';
import { createHonoCookies, createHonoHeaders } from '../endpoints/lazyAccessors';

// =============================================================================
// ResponseBuilder Overhead
// =============================================================================

describe('ResponseBuilder Creation', () => {
  bench('new ResponseBuilder()', () => {
    const rb = new ResponseBuilder();
    rb.getMetadata();
  });

  bench('stub object (current minimal approach)', () => {
    const stub = { getMetadata: () => ({}) };
    stub.getMetadata();
  });

  // Shared constant stub - zero allocation
  const SHARED_STUB = { getMetadata: () => ({}) };
  bench('shared constant stub', () => {
    SHARED_STUB.getMetadata();
  });
});

describe('ResponseBuilder Usage', () => {
  bench('unused - just create and get metadata', () => {
    const rb = new ResponseBuilder();
    rb.getMetadata();
  });

  bench('set 1 header', () => {
    const rb = new ResponseBuilder();
    rb.header('X-Request-Id', '123');
    rb.getMetadata();
  });

  bench('set 3 headers', () => {
    const rb = new ResponseBuilder();
    rb.header('X-Request-Id', '123')
      .header('X-Correlation-Id', 'abc')
      .header('Cache-Control', 'no-cache');
    rb.getMetadata();
  });

  bench('set 1 cookie', () => {
    const rb = new ResponseBuilder();
    rb.cookie('session', 'abc123', { httpOnly: true, secure: true });
    rb.getMetadata();
  });

  bench('full usage (status + 2 headers + 2 cookies)', () => {
    const rb = new ResponseBuilder();
    rb.status(201)
      .header('Location', '/users/123')
      .header('X-Request-Id', 'req-123')
      .cookie('session', 'abc', { httpOnly: true })
      .cookie('csrf', 'xyz');
    rb.getMetadata();
  });

  bench('send() with data', () => {
    const rb = new ResponseBuilder();
    rb.send({ id: '123', name: 'Test' });
  });
});

// =============================================================================
// Header/Cookie Parsing Overhead
// =============================================================================

const SAMPLE_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  'authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  'accept-encoding': 'gzip, deflate, br',
  'cache-control': 'no-cache',
  'x-request-id': 'req-123-abc-456',
  'x-forwarded-for': '192.168.1.1',
  'x-forwarded-proto': 'https',
};

const SAMPLE_COOKIE =
  'session=abc123; csrf=xyz789; theme=dark; lang=en; _ga=GA1.2.123456789; _gid=GA1.2.987654321';

describe('Header Parsing (Endpoint.createHeaders)', () => {
  bench('parse 10 headers (typical request)', () => {
    const headerFn = Endpoint.createHeaders(SAMPLE_HEADERS);
    headerFn('authorization');
  });

  bench('parse 10 headers + access 3 headers', () => {
    const headerFn = Endpoint.createHeaders(SAMPLE_HEADERS);
    headerFn('authorization');
    headerFn('content-type');
    headerFn('x-request-id');
  });

  bench('parse empty headers', () => {
    const headerFn = Endpoint.createHeaders({});
    headerFn('authorization');
  });

  // Lazy parsing alternative
  bench('lazy header access (no upfront parsing)', () => {
    const headers = SAMPLE_HEADERS;
    const lazyHeaderFn = (key?: string) => {
      if (!key) return headers;
      return headers[key.toLowerCase()];
    };
    lazyHeaderFn('authorization');
  });
});

describe('Cookie Parsing (Endpoint.createCookies)', () => {
  bench('parse 6 cookies (typical request)', () => {
    const cookieFn = Endpoint.createCookies(SAMPLE_COOKIE);
    cookieFn('session');
  });

  bench('parse 6 cookies + access 2 cookies', () => {
    const cookieFn = Endpoint.createCookies(SAMPLE_COOKIE);
    cookieFn('session');
    cookieFn('csrf');
  });

  bench('parse empty/undefined cookies', () => {
    const cookieFn = Endpoint.createCookies(undefined);
    cookieFn('session');
  });

  // Lazy parsing alternative
  bench('lazy cookie access (parse on demand)', () => {
    let parsed: Map<string, string> | null = null;
    const lazyCookieFn = (name?: string) => {
      if (!parsed) {
        parsed = new Map();
        for (const part of SAMPLE_COOKIE.split(';')) {
          const [k, v] = part.trim().split('=');
          if (k && v) parsed.set(k, v);
        }
      }
      if (!name) {
        const obj: Record<string, string> = {};
        for (const [k, v] of parsed) obj[k] = v;
        return obj;
      }
      return parsed.get(name);
    };
    lazyCookieFn('session');
  });
});

// =============================================================================
// Zod Validation Overhead
// =============================================================================

const simpleSchema = z.object({ message: z.literal('pong') });
const mediumSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  createdAt: z.string(),
});
const complexSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
    profile: z.object({
      bio: z.string().optional(),
      avatar: z.string().url().optional(),
    }),
  }),
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      quantity: z.number().int().positive(),
    }),
  ),
  metadata: z.record(z.string(), z.string()),
});

const simpleData = { message: 'pong' as const };
const mediumData = {
  id: '123',
  name: 'Test User',
  email: 'test@example.com',
  createdAt: '2024-01-01T00:00:00Z',
};
const complexData = {
  user: {
    id: '123',
    name: 'Test',
    email: 'test@example.com',
    profile: { bio: 'Hello', avatar: 'https://example.com/avatar.jpg' },
  },
  items: [
    { id: '1', name: 'Item 1', quantity: 2 },
    { id: '2', name: 'Item 2', quantity: 5 },
  ],
  metadata: { source: 'api', version: '1.0' },
};

describe('Zod Output Validation', () => {
  bench('simple schema (literal)', () => {
    simpleSchema.parse(simpleData);
  });

  bench('medium schema (4 fields)', () => {
    mediumSchema.parse(mediumData);
  });

  bench('complex schema (nested + array)', () => {
    complexSchema.parse(complexData);
  });

  bench('no validation (return as-is)', () => {
    const _result = simpleData;
  });
});

// =============================================================================
// Full Context Creation
// =============================================================================

describe('Full Minimal Handler Context', () => {
  const logger = { info: () => {}, error: () => {}, debug: () => {}, warn: () => {} };

  bench('current approach (eager parsing)', () => {
    const context = {
      services: {},
      logger,
      body: undefined,
      query: undefined,
      params: undefined,
      session: undefined,
      header: Endpoint.createHeaders(SAMPLE_HEADERS),
      cookie: Endpoint.createCookies(SAMPLE_COOKIE),
      auditor: undefined,
      db: undefined,
    };
    const rb = new ResponseBuilder();
    // Simulate handler access
    context.header('authorization');
    rb.getMetadata();
  });

  bench('optimized (lazy parsing, shared stub)', () => {
    const headers = SAMPLE_HEADERS;
    const cookieHeader = SAMPLE_COOKIE;
    let parsedCookies: Map<string, string> | null = null;

    const context = {
      services: {},
      logger,
      body: undefined,
      query: undefined,
      params: undefined,
      session: undefined,
      header: (key?: string) => {
        if (!key) return headers;
        return headers[key.toLowerCase()];
      },
      cookie: (name?: string) => {
        if (!parsedCookies && cookieHeader) {
          parsedCookies = new Map();
          for (const part of cookieHeader.split(';')) {
            const [k, v] = part.trim().split('=');
            if (k && v) parsedCookies.set(k, v);
          }
        }
        if (!name) {
          const obj: Record<string, string> = {};
          if (parsedCookies) for (const [k, v] of parsedCookies) obj[k] = v;
          return obj;
        }
        return parsedCookies?.get(name);
      },
      auditor: undefined,
      db: undefined,
    };
    // Simulate handler access
    context.header('authorization');
  });

  bench('minimal (no header/cookie parsing at all)', () => {
    const context = {
      services: {},
      logger,
      body: undefined,
      query: undefined,
      params: undefined,
      session: undefined,
      header: () => undefined,
      cookie: () => undefined,
      auditor: undefined,
      db: undefined,
    };
    // Handler doesn't use headers
  });
});

// =============================================================================
// Comparison: Raw Hono vs Framework Overhead
// =============================================================================

describe('Handler Execution Comparison', () => {
  // Simulates what a raw Hono handler would do
  bench('raw handler (no framework)', async () => {
    const handler = async () => ({ message: 'pong' as const });
    const result = await handler();
    JSON.stringify(result);
  });

  // Current minimal approach
  bench('minimal handler (current)', async () => {
    const handler = async () => ({ message: 'pong' as const });
    const rb = { getMetadata: () => ({}) };
    const result = await handler();
    simpleSchema.parse(result); // output validation
    JSON.stringify(result);
  });

  // With header parsing
  bench('minimal handler + header parsing', async () => {
    const handler = async () => ({ message: 'pong' as const });
    Endpoint.createHeaders(SAMPLE_HEADERS);
    Endpoint.createCookies(SAMPLE_COOKIE);
    const result = await handler();
    simpleSchema.parse(result);
    JSON.stringify(result);
  });
});

// =============================================================================
// Hono Lazy Accessors vs Eager Parsing
// =============================================================================

describe('Hono Lazy Accessors', () => {
  // We'll create a real request context for accurate benchmarking
  const createMockContext = () => {
    const req = new Request('http://localhost/test', {
      headers: {
        ...SAMPLE_HEADERS,
        cookie: SAMPLE_COOKIE,
      },
    });
    // Create a minimal context-like object
    return {
      req: {
        header: (name?: string) => {
          if (name) return req.headers.get(name) ?? undefined;
          const all: Record<string, string> = {};
          req.headers.forEach((v, k) => { all[k] = v; });
          return all;
        },
      },
    };
  };

  bench('OLD: Endpoint.createHeaders + createCookies (eager)', () => {
    const c = createMockContext();
    const headerValues = c.req.header() as Record<string, string>;
    const header = Endpoint.createHeaders(headerValues);
    const cookie = Endpoint.createCookies(headerValues.cookie);
    // Simulate typical access pattern
    header('authorization');
    cookie('session');
  });

  bench('NEW: createHonoHeaders + createHonoCookies (lazy)', () => {
    const c = createMockContext();
    const header = createHonoHeaders(c as any);
    const cookie = createHonoCookies(c as any);
    // Simulate typical access pattern - uses native methods
    header('authorization');
    cookie('session');
  });

  bench('OLD: eager - access all headers', () => {
    const c = createMockContext();
    const headerValues = c.req.header() as Record<string, string>;
    const header = Endpoint.createHeaders(headerValues);
    header(); // get all
  });

  bench('NEW: lazy - access all headers', () => {
    const c = createMockContext();
    const header = createHonoHeaders(c as any);
    header(); // get all - triggers parsing
  });

  bench('OLD: eager - no access (still parses)', () => {
    const c = createMockContext();
    const headerValues = c.req.header() as Record<string, string>;
    Endpoint.createHeaders(headerValues);
    Endpoint.createCookies(headerValues.cookie);
    // Don't access anything - but parsing already happened
  });

  bench('NEW: lazy - no access (no parsing)', () => {
    const c = createMockContext();
    createHonoHeaders(c as any);
    createHonoCookies(c as any);
    // Don't access anything - no parsing happens
  });
});
