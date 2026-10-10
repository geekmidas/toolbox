# @geekmidas/rate-limit

Rate limiting utilities with configurable windows and storage backends.

## Installation

```bash
pnpm add @geekmidas/rate-limit
```

## Features

- Configurable rate limiting with time windows
- Multiple storage backends (memory, cache)
- IP-based and custom identifier support
- Sliding window algorithm
- Integration with @geekmidas/constructs endpoints

## Basic Usage

```typescript
import type { RateLimitConfig } from '@geekmidas/rate-limit';
import { InMemoryCache } from '@geekmidas/cache/memory';

const limiter: RateLimitConfig = {
  limit: 100,          // Max requests
  windowMs: 60000,     // Time window in ms (1 minute)
  cache: new InMemoryCache(),
};
```

## Usage with Endpoints

```typescript
import { api } from '../constructs/api';
import { InMemoryCache } from '@geekmidas/cache/memory';

const rateLimited = api
  .post('/api/messages')
  .rateLimit({
    limit: 10,
    windowMs: 60000,
    cache: new InMemoryCache(),
  })
  .body(z.object({ content: z.string() }))
  .handle(async ({ body }) => ({ success: true }));
```

Every adaptor that serves the endpoint — Hono (`gkm dev`, a server build, a
feature test), API Gateway Lambdas and the `TestEndpointAdaptor` — checks the
limit after the request is authorized.

### Under the limit

The response carries where the client stands:

| Header | Value |
|--------|-------|
| `X-RateLimit-Limit` | `limit` |
| `X-RateLimit-Remaining` | requests left in this window |
| `X-RateLimit-Reset` | when the window resets, as an ISO date |

`standardHeaders: false` leaves them out; `legacyHeaders: true` adds
`X-RateLimit-Retry-After` (ms) and `X-RateLimit-Reset-After` (seconds).

### Over the limit: 429

The request is refused with **429 Too Many Requests**. The limiter throws
`TooManyRequestsError` — `@geekmidas/errors`' 429, re-exported here — so every
adaptor answers it like any other `HttpError`, with the headers it carries:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 42
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 2026-10-10T12:00:42.000Z

{"name":"TooManyRequestsError","message":"Too many requests, please try again later.","statusCode":429,"statusMessage":"Too Many Requests","details":{"retryAfter":42}}
```

`Retry-After` is the seconds until the window resets, and `message` replaces
the message. `handler` runs before the 429 is thrown, to log or alert on it.

## Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `limit` | `number` | Maximum number of requests in the window |
| `windowMs` | `number` | Time window in milliseconds |
| `cache` | `Cache` | Cache implementation for storing rate limit data |
| `keyGenerator` | `(ctx) => string` | Custom function to generate rate limit keys |
| `skip` | `(ctx) => boolean` | Skip the limit for a request |
| `message` | `string` | The 429's message |
| `handler` | `(ctx, info) => void` | Runs when a request is over the limit, before the 429 |
| `standardHeaders` | `boolean` | `X-RateLimit-*` on every response (default `true`) |
| `legacyHeaders` | `boolean` | The legacy `X-RateLimit-Retry-After`/`-Reset-After` headers (default `false`) |

## Custom Key Generator

```typescript
import type { RateLimitConfig } from '@geekmidas/rate-limit';

const limiter: RateLimitConfig = {
  limit: 100,
  windowMs: 60000,
  cache: new InMemoryCache(),
  keyGenerator: (ctx) => {
    // Rate limit by user ID instead of IP
    return `rate-limit:${ctx.session?.userId ?? ctx.header('x-forwarded-for')}`;
  },
};
```

## Production Usage

For production with distributed systems, use a shared cache:

```typescript
import type { RateLimitConfig } from '@geekmidas/rate-limit';
import { UpstashCache } from '@geekmidas/cache/upstash';

const limiter: RateLimitConfig = {
  limit: 100,
  windowMs: 60000,
  cache: new UpstashCache({
    url: process.env.UPSTASH_REDIS_URL!,
    token: process.env.UPSTASH_REDIS_TOKEN!,
  }),
};
```
