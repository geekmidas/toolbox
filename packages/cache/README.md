# @geekmidas/cache

A type-safe, flexible caching library for TypeScript applications with support for multiple cache implementations and a unified interface.

## Features

- **Type-safe**: Full TypeScript support with generics for strongly-typed cache values
- **Unified interface**: Common `Cache<T>` interface for all implementations
- **Multiple backends**: In-memory and Redis (Upstash) implementations included
- **Async API**: Promise-based interface for consistency across implementations
- **Flexible TTL**: Support for time-to-live where applicable
- **Easy testing**: Simple interface makes mocking and testing straightforward
- **Modular exports**: Import only what you need

## Installation

```bash
npm install @geekmidas/cache
```

### Optional Dependencies

For Redis support via Upstash:
```bash
npm install @upstash/redis
```

## Quick Start

### In-Memory Cache

Perfect for development, testing, or simple applications:

```typescript
import { InMemoryCache } from '@geekmidas/cache/memory';

const cache = new InMemoryCache<string>();

// Set a value
await cache.set('user:123', 'John Doe');

// Get a value
const userName = await cache.get('user:123'); // 'John Doe'

// Delete a value
await cache.delete('user:123');

// Check if value exists
const exists = await cache.get('user:123'); // undefined
```

### Redis Cache (Upstash)

For production applications needing distributed caching:

```typescript
import { UpstashCache } from '@geekmidas/cache/upstash';

const cache = new UpstashCache<User>(
  process.env.UPSTASH_REDIS_URL!,
  process.env.UPSTASH_REDIS_TOKEN!
);

// Set with TTL (1 hour)
await cache.set('user:123', { id: 123, name: 'John Doe' }, 3600);

// Get typed object
const user = await cache.get('user:123'); // User | undefined

// Delete
await cache.delete('user:123');
```

## API Reference

### Cache Interface

All cache implementations follow this interface:

```typescript
interface Cache<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
}
```

#### Methods

##### `get(key: string): Promise<T | undefined>`

Retrieves a value from the cache.

- **Parameters**: `key` - The cache key
- **Returns**: Promise resolving to the cached value or `undefined` if not found
- **Example**:
  ```typescript
  const value = await cache.get('my-key');
  if (value !== undefined) {
    // Use the value
  }
  ```

##### `set(key: string, value: T, ttl?: number): Promise<void>`

Stores a value in the cache.

- **Parameters**: 
  - `key` - The cache key
  - `value` - The value to store
  - `ttl` - Optional time-to-live in seconds
- **Returns**: Promise resolving when the operation completes
- **Example**:
  ```typescript
  // Set without TTL
  await cache.set('key', 'value');
  
  // Set with 1 hour TTL
  await cache.set('key', 'value', 3600);
  ```

##### `delete(key: string): Promise<void>`

Removes a value from the cache.

- **Parameters**: `key` - The cache key to delete
- **Returns**: Promise resolving when the operation completes
- **Example**:
  ```typescript
  await cache.delete('my-key');
  ```

### InMemoryCache

Simple in-memory cache implementation.

```typescript
import { InMemoryCache } from '@geekmidas/cache/memory';

class InMemoryCache<T> implements Cache<T>
```

#### Features

- ✅ Fast access (no network latency)
- ✅ Reference equality for objects
- ✅ No external dependencies
- ❌ No TTL support (TTL parameter is ignored)
- ❌ Data lost on process restart
- ❌ Not suitable for multi-instance applications

#### Example

```typescript
const cache = new InMemoryCache<number>();
await cache.set('counter', 42);
const count = await cache.get('counter'); // 42
```

### UpstashCache

Redis-based cache using Upstash Redis client.

```typescript
import { UpstashCache } from '@geekmidas/cache/upstash';

class UpstashCache<T> implements Cache<T>
```

#### Constructor

```typescript
new UpstashCache<T>(url: string, token: string)
```

- `url`: Upstash Redis URL
- `token`: Upstash Redis token

#### Features

- ✅ Persistent storage
- ✅ TTL support (defaults to 3600 seconds)
- ✅ Distributed caching
- ✅ JSON serialization/deserialization
- ❌ Requires external Redis service
- ❌ Network latency for operations

#### Example

```typescript
interface User {
  id: number;
  name: string;
  email: string;
}

const cache = new UpstashCache<User>(
  'https://your-redis-url.upstash.io',
  'your-token'
);

await cache.set('user:1', {
  id: 1,
  name: 'John Doe',
  email: 'john@example.com'
}, 7200); // 2 hours TTL

const user = await cache.get('user:1');
```

## Advanced Usage

### Type Safety

The cache is fully type-safe with TypeScript generics:

```typescript
// String cache
const stringCache = new InMemoryCache<string>();
await stringCache.set('key', 'value');
const str: string | undefined = await stringCache.get('key');

// Object cache
interface Product {
  id: number;
  name: string;
  price: number;
}

const productCache = new InMemoryCache<Product>();
await productCache.set('product:1', { id: 1, name: 'Widget', price: 9.99 });
const product: Product | undefined = await productCache.get('product:1');
```

### Cache Abstraction

Create cache-agnostic services:

```typescript
interface UserService {
  getUser(id: number): Promise<User | undefined>;
  setUser(user: User): Promise<void>;
  deleteUser(id: number): Promise<void>;
}

class CachedUserService implements UserService {
  constructor(
    private cache: Cache<User>,
    private userRepository: UserRepository
  ) {}

  async getUser(id: number): Promise<User | undefined> {
    const cacheKey = `user:${id}`;
    
    // Try cache first
    let user = await this.cache.get(cacheKey);
    if (user) return user;
    
    // Fallback to repository
    user = await this.userRepository.findById(id);
    if (user) {
      await this.cache.set(cacheKey, user, 3600); // 1 hour
    }
    
    return user;
  }

  async setUser(user: User): Promise<void> {
    await this.userRepository.save(user);
    await this.cache.set(`user:${user.id}`, user, 3600);
  }

  async deleteUser(id: number): Promise<void> {
    await this.userRepository.delete(id);
    await this.cache.delete(`user:${id}`);
  }
}

// Use with any cache implementation
const service = new CachedUserService(
  new InMemoryCache<User>(), // or new UpstashCache<User>(url, token)
  new UserRepository()
);
```

### Factory Pattern

Create cache instances based on configuration:

```typescript
interface CacheConfig {
  type: 'memory' | 'redis';
  redis?: {
    url: string;
    token: string;
  };
}

function createCache<T>(config: CacheConfig): Cache<T> {
  switch (config.type) {
    case 'memory':
      return new InMemoryCache<T>();
    case 'redis':
      if (!config.redis) throw new Error('Redis config required');
      return new UpstashCache<T>(config.redis.url, config.redis.token);
    default:
      throw new Error(`Unsupported cache type: ${config.type}`);
  }
}

const cache = createCache<User>({
  type: process.env.NODE_ENV === 'production' ? 'redis' : 'memory',
  redis: {
    url: process.env.UPSTASH_REDIS_URL!,
    token: process.env.UPSTASH_REDIS_TOKEN!,
  },
});
```

### Wrapper Pattern

Add functionality like logging or metrics:

```typescript
class LoggingCache<T> implements Cache<T> {
  constructor(
    private cache: Cache<T>,
    private logger: Logger
  ) {}

  async get(key: string): Promise<T | undefined> {
    this.logger.debug(`Cache GET: ${key}`);
    const value = await this.cache.get(key);
    this.logger.debug(`Cache GET result: ${value ? 'HIT' : 'MISS'}`);
    return value;
  }

  async set(key: string, value: T, ttl?: number): Promise<void> {
    this.logger.debug(`Cache SET: ${key} (TTL: ${ttl})`);
    await this.cache.set(key, value, ttl);
  }

  async delete(key: string): Promise<void> {
    this.logger.debug(`Cache DELETE: ${key}`);
    await this.cache.delete(key);
  }
}

const cache = new LoggingCache(
  new UpstashCache<User>(url, token),
  logger
);
```

## Testing

### Mocking

The interface makes testing easy:

```typescript
import { Cache } from '@geekmidas/cache';

class MockCache<T> implements Cache<T> {
  private store = new Map<string, T>();

  async get(key: string): Promise<T | undefined> {
    return this.store.get(key);
  }

  async set(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// Use in tests
const mockCache = new MockCache<User>();
const service = new CachedUserService(mockCache, mockRepository);
```

### Testing with Real Implementations

```typescript
import { InMemoryCache } from '@geekmidas/cache/memory';

describe('UserService', () => {
  let cache: Cache<User>;
  let service: CachedUserService;

  beforeEach(() => {
    cache = new InMemoryCache<User>();
    service = new CachedUserService(cache, mockRepository);
  });

  it('should cache user data', async () => {
    const user = { id: 1, name: 'John' };
    await service.setUser(user);
    
    const cachedUser = await cache.get('user:1');
    expect(cachedUser).toEqual(user);
  });
});
```

## Performance Considerations

### InMemoryCache
- **Pros**: Very fast, no network latency
- **Cons**: Limited by available memory, not persistent
- **Best for**: Development, testing, single-instance apps

### UpstashCache
- **Pros**: Persistent, distributed, scalable
- **Cons**: Network latency, external dependency
- **Best for**: Production, multi-instance apps, shared cache

### Key Strategies

1. **Use appropriate TTL**: Balance between cache freshness and performance
2. **Consider cache size**: Monitor memory usage for in-memory cache
3. **Implement fallback**: Always have a fallback when cache is unavailable
4. **Use compression**: For large objects, consider compression before caching

## Error Handling

Cache operations can fail, so implement proper error handling:

```typescript
async function getUserSafely(id: number): Promise<User | undefined> {
  try {
    const cached = await cache.get(`user:${id}`);
    if (cached) return cached;
  } catch (error) {
    console.warn('Cache get failed, falling back to database:', error);
  }

  try {
    const user = await database.getUser(id);
    if (user) {
      try {
        await cache.set(`user:${id}`, user, 3600);
      } catch (error) {
        console.warn('Cache set failed:', error);
      }
    }
    return user;
  } catch (error) {
    console.error('Database query failed:', error);
    throw error;
  }
}
```

## Migration Guide

### From Map to Cache

```typescript
// Old way
const cache = new Map<string, User>();
cache.set('user:1', user);
const user = cache.get('user:1');

// New way
const cache = new InMemoryCache<User>();
await cache.set('user:1', user);
const user = await cache.get('user:1');
```

### From Other Cache Libraries

Most cache libraries can be adapted to implement the `Cache<T>` interface:

```typescript
class RedisCache<T> implements Cache<T> {
  constructor(private redis: RedisClient) {}

  async get(key: string): Promise<T | undefined> {
    const value = await this.redis.get(key);
    return value ? JSON.parse(value) : undefined;
  }

  async set(key: string, value: T, ttl?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttl) {
      await this.redis.setex(key, ttl, serialized);
    } else {
      await this.redis.set(key, serialized);
    }
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
```

## Contributing

1. Follow the existing code style (2 spaces, single quotes, semicolons)
2. Add comprehensive tests for new features
3. Ensure all implementations follow the `Cache<T>` interface
4. Update documentation for API changes
5. Use the "Integration over Unit" testing philosophy

## License

MIT License - see the LICENSE file for details.