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
import { rateLimit } from '@geekmidas/rate-limit';
import { InMemoryCache } from '@geekmidas/cache/memory';

const limiter = rateLimit({
  limit: 100,          // Max requests
  windowMs: 60000,     // Time window in ms (1 minute)
  cache: new InMemoryCache(),
});
```

## Usage with Endpoints

```typescript
import { e } from '@geekmidas/constructs/endpoints';
import { rateLimit } from '@geekmidas/rate-limit';
import { InMemoryCache } from '@geekmidas/cache/memory';

const rateLimited = e
  .post('/api/messages')
  .rateLimit(rateLimit({
    limit: 10,
    windowMs: 60000,
    cache: new InMemoryCache(),
  }))
  .body(z.object({ content: z.string() }))
  .handle(async ({ body }) => ({ success: true }));
```

## Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `limit` | `number` | Maximum number of requests in the window |
| `windowMs` | `number` | Time window in milliseconds |
| `cache` | `Cache` | Cache implementation for storing rate limit data |
| `keyGenerator` | `(ctx) => string` | Custom function to generate rate limit keys |

## Custom Key Generator

```typescript
const limiter = rateLimit({
  limit: 100,
  windowMs: 60000,
  cache: new InMemoryCache(),
  keyGenerator: (ctx) => {
    // Rate limit by user ID instead of IP
    return ctx.session?.userId ?? ctx.ip;
  },
});
```

## Production Usage

For production with distributed systems, use a shared cache:

```typescript
import { UpstashCache } from '@geekmidas/cache/upstash';

const limiter = rateLimit({
  limit: 100,
  windowMs: 60000,
  cache: new UpstashCache({
    url: process.env.UPSTASH_REDIS_URL!,
    token: process.env.UPSTASH_REDIS_TOKEN!,
  }),
});
```
