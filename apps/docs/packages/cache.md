# @geekmidas/cache

Unified caching interface with multiple backend implementations.

## Installation

```bash
pnpm add @geekmidas/cache
```

## Features

- Type-safe cache with TypeScript generics
- Consistent async API across all backends
- TTL (time-to-live) support
- Multiple implementations: InMemoryCache, UpstashCache, FileCache, ExpoSecureCache
- Easy testing with swappable backends

## Package Exports

- `/` - Core cache interface
- `/memory` - In-memory cache implementation
- `/upstash` - Upstash Redis cache
- `/file` - File-based cache (JSON on disk)
- `/expo` - Expo Secure Store cache (React Native)

## Basic Usage

### In-Memory Cache

```typescript
import { InMemoryCache } from '@geekmidas/cache/memory';

interface User {
  id: string;
  name: string;
  email: string;
}

const cache = new InMemoryCache<User>();

// Set with TTL (in seconds)
await cache.set('user:123', { id: '123', name: 'John', email: 'john@example.com' }, { ttl: 3600 });

// Get value
const user = await cache.get('user:123');

// Delete value
await cache.delete('user:123');
```

### Upstash Redis Cache

```typescript
import { UpstashCache } from '@geekmidas/cache/upstash';

const cache = new UpstashCache<User>({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});

// Same API as InMemoryCache
await cache.set('user:123', userData, { ttl: 3600 });
const user = await cache.get('user:123');
```

### File Cache

Persistent file-based cache for CLI tools and build systems:

```typescript
import { FileCache } from '@geekmidas/cache/file';

// Default path: process.cwd()/.gkm/cache.json
const cache = new FileCache();

// Custom path and TTL
const cache = new FileCache({
  path: '/tmp/my-app/cache.json',
  ttl: 3600, // 1 hour default TTL
});

// Same API as other implementations
await cache.set('build:hash', 'abc123', 300);
const hash = await cache.get('build:hash');
const remaining = await cache.ttl('build:hash');
```

File locking ensures safe concurrent and cross-process writes. Parent directories are created automatically.

### Expo Secure Store Cache (React Native)

```typescript
import { ExpoSecureCache } from '@geekmidas/cache/expo';

const cache = new ExpoSecureCache<string>();

// Store sensitive data securely
await cache.set('auth_token', 'secret-token');
const token = await cache.get('auth_token');
```

## Usage with Rate Limiting

```typescript
import { InMemoryCache } from '@geekmidas/cache/memory';
import { rateLimit } from '@geekmidas/rate-limit';

const limiter = rateLimit({
  limit: 100,
  windowMs: 60000,
  cache: new InMemoryCache(),
});
```

## Cache Interface

All cache implementations follow this interface:

```typescript
interface Cache<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, options?: { ttl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}
```
