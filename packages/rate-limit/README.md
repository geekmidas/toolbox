# @geekmidas/rate-limit

Flexible rate limiting library with support for multiple cache backends, customizable key generation, and full TypeScript support.

## Features

- **Multiple Cache Backends**: Works with any cache implementation (Redis, In-Memory, etc.)
- **Flexible Key Generation**: Customize how clients are identified
- **Skip Logic**: Conditionally skip rate limiting for certain requests
- **Standard Headers**: Automatic rate limit header generation
- **Type-Safe**: Full TypeScript support with generic types
- **Customizable**: Configure limits, windows, messages, and handlers
- **IP Detection**: Automatic client IP detection from various headers

## Installation

```bash
pnpm add @geekmidas/rate-limit
```

## Quick Start

### Basic Usage

```typescript
import { checkRateLimit } from '@geekmidas/rate-limit';
import { InMemoryCache } from '@geekmidas/cache/memory';

const config = {
  limit: 10,                           // 10 requests
  windowMs: 60000,                     // per 1 minute
  cache: new InMemoryCache(),          // storage backend
};

// In your handler
try {
  const info = await checkRateLimit(config, {
    header: (key) => request.headers.get(key),
    services: {},
    logger,
    session: null,
    path: '/api/users',
    method: 'GET'
  });

  // Request allowed
  console.log(`${info.remaining} requests remaining`);
} catch (error) {
  if (error instanceof TooManyRequestsError) {
    // Rate limit exceeded
    console.log(`Try again in ${error.retryAfter} seconds`);
  }
}
```

### With Endpoints

Rate limiting is built into the constructs package:

```typescript
import { e } from '@geekmidas/constructs/endpoints';
import { InMemoryCache } from '@geekmidas/cache/memory';
import { z } from 'zod';

export const sendMessage = e
  .post('/api/messages')
  .rateLimit({
    limit: 10,                    // 10 requests
    windowMs: 60000,             // per minute
    cache: new InMemoryCache(),
    message: 'Too many messages sent. Please try again later.'
  })
  .body(z.object({
    content: z.string()
  }))
  .handle(async ({ body }) => {
    // Rate limited to 10 requests per minute
    return { success: true };
  });
```

## Configuration

### RateLimitConfig

```typescript
interface RateLimitConfig {
  limit: number;           // Max requests in window
  windowMs: number;        // Time window in milliseconds
  cache: Cache;            // Cache backend
  keyGenerator?: RateLimitKeyGenerator; // Custom key generation
  skip?: RateLimitSkipFn;  // Skip certain requests
  message?: string;        // Custom error message
  handler?: RateLimitExceededHandler; // Custom exceeded handler
  standardHeaders?: boolean; // Include standard headers (default: true)
  legacyHeaders?: boolean;   // Include legacy headers (default: false)
}
```

## Cache Backends

### In-Memory Cache

Best for development and single-instance deployments:

```typescript
import { InMemoryCache } from '@geekmidas/cache/memory';

const config = {
  limit: 100,
  windowMs: 60000,
  cache: new InMemoryCache()
};
```

### Redis (Upstash)

Best for production and distributed systems:

```typescript
import { UpstashCache } from '@geekmidas/cache/upstash';

const config = {
  limit: 100,
  windowMs: 60000,
  cache: new UpstashCache({
    url: process.env.UPSTASH_REDIS_URL,
    token: process.env.UPSTASH_REDIS_TOKEN
  })
};
```

## Custom Key Generation

### By User ID

```typescript
const config = {
  limit: 100,
  windowMs: 60000,
  cache: new InMemoryCache(),
  keyGenerator: (ctx) => {
    const userId = ctx.session?.userId || 'anonymous';
    return `rate-limit:${ctx.method}:${ctx.path}:${userId}`;
  }
};
```

### By API Key

```typescript
const config = {
  limit: 1000,
  windowMs: 3600000, // 1 hour
  cache: new InMemoryCache(),
  keyGenerator: (ctx) => {
    const apiKey = ctx.header('x-api-key') || 'unknown';
    return `rate-limit:${ctx.path}:${apiKey}`;
  }
};
```

### By IP and User Agent

```typescript
const config = {
  limit: 50,
  windowMs: 60000,
  cache: new InMemoryCache(),
  keyGenerator: (ctx) => {
    const ip = ctx.header('x-forwarded-for')?.split(',')[0] || 'unknown';
    const userAgent = ctx.header('user-agent') || 'unknown';
    return `rate-limit:${ip}:${userAgent}`;
  }
};
```

## Skip Logic

### Skip Authenticated Users

```typescript
const config = {
  limit: 10,
  windowMs: 60000,
  cache: new InMemoryCache(),
  skip: (ctx) => {
    // Skip rate limiting for authenticated users
    return !!ctx.session?.userId;
  }
};
```

### Skip Admin Routes

```typescript
const config = {
  limit: 100,
  windowMs: 60000,
  cache: new InMemoryCache(),
  skip: (ctx) => {
    // Skip rate limiting for admin routes
    return ctx.path.startsWith('/admin/');
  }
};
```

### Skip Internal IPs

```typescript
const config = {
  limit: 10,
  windowMs: 60000,
  cache: new InMemoryCache(),
  skip: (ctx) => {
    const ip = ctx.header('x-forwarded-for')?.split(',')[0];
    // Skip rate limiting for internal IPs
    return ip?.startsWith('10.') || ip?.startsWith('192.168.');
  }
};
```

## Custom Handlers

### Log Rate Limit Violations

```typescript
const config = {
  limit: 100,
  windowMs: 60000,
  cache: new InMemoryCache(),
  handler: async (ctx, info) => {
    ctx.logger.warn({
      path: ctx.path,
      method: ctx.method,
      count: info.count,
      limit: info.limit,
      ip: ctx.header('x-forwarded-for')
    }, 'Rate limit exceeded');
  }
};
```

### Alert on Abuse

```typescript
const config = {
  limit: 100,
  windowMs: 60000,
  cache: new InMemoryCache(),
  handler: async (ctx, info) => {
    // Alert if significantly over limit
    if (info.count > info.limit * 2) {
      await alertService.send({
        type: 'rate_limit_abuse',
        ip: ctx.header('x-forwarded-for'),
        count: info.count,
        path: ctx.path
      });
    }
  }
};
```

## Response Headers

The library automatically sets standard rate limit headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 2024-01-15T12:34:56.789Z
Retry-After: 45
```

### Disable Headers

```typescript
const config = {
  limit: 100,
  windowMs: 60000,
  cache: new InMemoryCache(),
  standardHeaders: false  // Disable standard headers
};
```

### Enable Legacy Headers

```typescript
const config = {
  limit: 100,
  windowMs: 60000,
  cache: new InMemoryCache(),
  legacyHeaders: true  // Enable legacy headers
};
```

## Rate Limit Info

The `checkRateLimit` function returns information about the current rate limit status:

```typescript
interface RateLimitInfo {
  count: number;        // Current request count
  limit: number;        // Max allowed requests
  remaining: number;    // Remaining requests
  resetTime: number;    // Unix timestamp when window resets
  retryAfter: number;   // Milliseconds until reset
}

const info = await checkRateLimit(config, ctx);
console.log(`You have ${info.remaining} requests remaining`);
console.log(`Rate limit resets at ${new Date(info.resetTime)}`);
```

## Error Handling

### TooManyRequestsError

Thrown when rate limit is exceeded:

```typescript
import { TooManyRequestsError } from '@geekmidas/rate-limit';

try {
  await checkRateLimit(config, ctx);
} catch (error) {
  if (error instanceof TooManyRequestsError) {
    console.log(`Status: ${error.statusCode}`); // 429
    console.log(`Message: ${error.message}`);
    console.log(`Retry after: ${error.retryAfter} seconds`);

    // Send appropriate response
    return new Response(error.message, {
      status: error.statusCode,
      headers: {
        'Retry-After': error.retryAfter?.toString() || '60'
      }
    });
  }
}
```

## Common Patterns

### Different Limits for Different Endpoints

```typescript
// Strict limit for auth endpoints
export const login = e
  .post('/auth/login')
  .rateLimit({
    limit: 5,
    windowMs: 300000, // 5 minutes
    cache: new InMemoryCache(),
    message: 'Too many login attempts. Please try again later.'
  })
  .handle(async () => {
    // Login logic
  });

// Generous limit for read endpoints
export const getUsers = e
  .get('/users')
  .rateLimit({
    limit: 1000,
    windowMs: 60000, // 1 minute
    cache: new InMemoryCache()
  })
  .handle(async () => {
    // Get users logic
  });
```

### Tiered Rate Limits

```typescript
const config = {
  limit: 100,
  windowMs: 60000,
  cache: new InMemoryCache(),
  keyGenerator: (ctx) => {
    // Different limits based on user tier
    const tier = ctx.session?.tier || 'free';
    const limit = tier === 'premium' ? 1000 : 100;

    return `rate-limit:${tier}:${ctx.path}:${ctx.session?.userId}`;
  }
};
```

### Per-API-Key Limits

```typescript
const config = {
  limit: 10000,
  windowMs: 3600000, // 1 hour
  cache: new UpstashCache({ /* config */ }),
  keyGenerator: (ctx) => {
    const apiKey = ctx.header('x-api-key');
    if (!apiKey) {
      throw new Error('API key required');
    }
    return `rate-limit:api-key:${apiKey}`;
  },
  message: 'API rate limit exceeded. Upgrade your plan for higher limits.'
};
```

## Testing

Mock the cache for testing:

```typescript
import { checkRateLimit, type RateLimitData } from '@geekmidas/rate-limit';
import { vi } from 'vitest';

const mockCache = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn()
};

const config = {
  limit: 10,
  windowMs: 60000,
  cache: mockCache as any
};

// Test rate limit not exceeded
mockCache.get.mockResolvedValue({ count: 5, resetTime: Date.now() + 30000 });

const info = await checkRateLimit(config, ctx);
expect(info.remaining).toBe(5);

// Test rate limit exceeded
mockCache.get.mockResolvedValue({ count: 11, resetTime: Date.now() + 30000 });

await expect(checkRateLimit(config, ctx)).rejects.toThrow(TooManyRequestsError);
```

## Best Practices

### 1. Use Redis in Production

```typescript
// ✅ Use Redis for distributed systems
import { UpstashCache } from '@geekmidas/cache/upstash';

const cache = new UpstashCache({ /* config */ });

// ❌ Don't use in-memory cache in production
const cache = new InMemoryCache(); // Only for dev/testing
```

### 2. Set Appropriate Limits

```typescript
// ✅ Different limits for different operations
const authConfig = { limit: 5, windowMs: 300000 }; // 5 per 5 min
const readConfig = { limit: 1000, windowMs: 60000 }; // 1000 per min

// ❌ Don't use same limit for everything
const config = { limit: 100, windowMs: 60000 }; // Too generic
```

### 3. Include Helpful Error Messages

```typescript
// ✅ Clear, actionable messages
message: 'Rate limit exceeded. You can make 100 requests per minute. Please try again in 45 seconds.'

// ❌ Generic messages
message: 'Too many requests'
```

### 4. Log Rate Limit Events

```typescript
const config = {
  limit: 100,
  windowMs: 60000,
  cache,
  handler: async (ctx, info) => {
    ctx.logger.warn({
      event: 'rate_limit_exceeded',
      path: ctx.path,
      count: info.count,
      limit: info.limit
    }, 'Rate limit exceeded');
  }
};
```

## Related Packages

- [@geekmidas/cache](../cache) - Cache implementations for rate limiting
- [@geekmidas/constructs](../constructs) - Built-in rate limiting for endpoints
- [@geekmidas/errors](../errors) - HTTP error classes
- [@geekmidas/logger](../logger) - Structured logging

## License

MIT
