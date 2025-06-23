import {
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
} from '@geekmidas/api/errors';
import { e } from '@geekmidas/api/server';
import { HermodService } from '@geekmidas/api/services';
import { z } from 'zod';

// Example 1: Database Service
interface Database {
  users: {
    findById(id: string): Promise<User | null>;
    findByEmail(email: string): Promise<User | null>;
    create(data: CreateUserData): Promise<User>;
    update(id: string, data: UpdateUserData): Promise<User>;
    delete(id: string): Promise<boolean>;
  };
  products: {
    list(filters?: ProductFilters): Promise<Product[]>;
    findById(id: string): Promise<Product | null>;
  };
}

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  hashedPassword: string;
}

interface Product {
  id: string;
  name: string;
  price: number;
}

interface CreateUserData {
  email: string;
  name: string;
  password: string;
  role?: 'admin' | 'user';
}

interface UpdateUserData {
  name?: string;
  email?: string;
}

interface ProductFilters {
  category?: string;
  minPrice?: number;
  maxPrice?: number;
}

class DatabaseService extends HermodService<Database> {
  static readonly serviceName = 'Database';

  async register() {
    // In real app, initialize your database connection
    const db: Database = {
      users: {
        async findById(id) {
          // Simulate DB query
          return {
            id,
            email: 'user@example.com',
            name: 'Test User',
            role: 'user',
            hashedPassword: 'hashed',
          };
        },
        async findByEmail(email) {
          return {
            id: '123',
            email,
            name: 'Test User',
            role: 'user',
            hashedPassword: 'hashed',
          };
        },
        async create(data) {
          return {
            id: crypto.randomUUID(),
            email: data.email,
            name: data.name,
            role: data.role || 'user',
            hashedPassword: 'hashed',
          };
        },
        async update(id, data) {
          return {
            id,
            email: data.email || 'user@example.com',
            name: data.name || 'Updated User',
            role: 'user',
            hashedPassword: 'hashed',
          };
        },
        async delete(id) {
          return true;
        },
      },
      products: {
        async list(filters) {
          return [
            { id: '1', name: 'Product 1', price: 99.99 },
            { id: '2', name: 'Product 2', price: 149.99 },
          ];
        },
        async findById(id) {
          return { id, name: 'Product', price: 99.99 };
        },
      },
    };

    return db;
  }

  async cleanup(db: Database) {}
}

// Example 2: Cache Service
interface CacheClient {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

class CacheService extends HermodService<CacheClient> {
  static readonly serviceName = 'Cache';

  async register() {
    // In-memory cache for example
    const cache = new Map<string, { value: any; expires?: number }>();

    return {
      async get<T>(key: string): Promise<T | null> {
        const item = cache.get(key);
        if (!item) return null;

        if (item.expires && item.expires < Date.now()) {
          cache.delete(key);
          return null;
        }

        return item.value as T;
      },
      async set<T>(key: string, value: T, ttl?: number): Promise<void> {
        const expires = ttl ? Date.now() + ttl * 1000 : undefined;
        cache.set(key, { value, expires });
      },
      async delete(key: string): Promise<void> {
        cache.delete(key);
      },
      async clear(): Promise<void> {
        cache.clear();
      },
    };
  }
}

// Example 3: Email Service
interface EmailClient {
  send(options: {
    to: string;
    subject: string;
    html?: string;
    text?: string;
  }): Promise<void>;
}

class EmailService extends HermodService<EmailClient> {
  static readonly serviceName = 'Email';

  async register() {
    return {
      async send(options) {},
    };
  }
}

// Example 4: Using services in endpoints
const getUserWithCache = e
  .services([DatabaseService, CacheService])
  .get('/users/:id')
  .params(z.object({ id: z.string().uuid() }))
  .handle(async ({ params, services, logger }) => {
    const { Database, Cache } = services;
    const cacheKey = `user:${params.id}`;

    // Check cache first
    const cached = await Cache.get<User>(cacheKey);
    if (cached) {
      logger.debug({ userId: params.id }, 'User found in cache');
      return cached;
    }

    // Get from database
    const user = await Database.users.findById(params.id);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Cache for 5 minutes
    await Cache.set(cacheKey, user, 300);

    return user;
  });

// Example 5: Basic authorization
const protectedEndpoint = e
  .session(async ({ req, logger }) => {
    const token = req.headers.get('authorization');

    if (!token || !token.startsWith('Bearer ')) {
      throw new ForbiddenError();
    }

    const jwt = token.slice(7); // Remove 'Bearer '

    return { userId: '123', role: 'user' };
  })
  .get('/protected')
  .handle(({ session }) => {
    // auth is guaranteed to exist here
    return {
      message: 'Access granted',
      userId: session.userId,
      role: session.role,
    };
  });

// Example 6: Role-based authorization
const adminOnly = e
  .session(async ({ req }) => {
    const token = req.headers.get('authorization');
    if (!token) {
      throw new ForbiddenError();
    }

    // Decode token (simplified)
    const user = { id: '123', role: 'admin' };

    if (user.role !== 'admin') {
      throw new ForbiddenError('Admin access required');
    }

    return user;
  })
  .get('/admin/users')
  .handle(({ session }) => {
    return {
      message: 'Admin panel',
      adminId: session.id,
    };
  });

// Example 7: Session management
interface SessionData {
  userId: string;
  email: string;
  permissions: string[];
}

const sessionApi = e.session(async ({ req, logger }) => {
  const sessionId = req.headers.get('x-session-id');

  if (!sessionId) {
    return null;
  }

  // In real app, fetch from session store
  logger.debug({ sessionId }, 'Loading session');

  return {
    userId: '123',
    email: 'user@example.com',
    permissions: ['read', 'write'],
  };
});

const profileEndpoint = sessionApi.get('/profile').handle(({ session }) => {
  if (!session) {
    throw new UnauthorizedError('Please log in');
  }

  return {
    userId: session.userId,
    email: session.email,
    permissions: session.permissions,
  };
});

// Example 8: Combining services, auth, and session
const complexEndpoint = e
  .services([DatabaseService, CacheService, EmailService])
  .session<SessionData>(async ({ req }) => {
    // Load session...
    return { userId: '123', email: 'user@example.com', permissions: ['write'] };
  })
  .authorize(async ({ session }) => {
    if (!session) return false;
    if (!session.permissions.includes('write')) {
      throw new ForbiddenError('Write permission required');
    }
    return true;
  })
  .post('/articles')
  .body(
    z.object({
      title: z.string().min(1).max(200),
      content: z.string().min(10),
      tags: z.array(z.string()).default([]),
    }),
  )
  .handle(async ({ body, session, services, logger }) => {
    const { Database, Cache, Email } = services;

    logger.info({ userId: session!.userId }, 'Creating article');

    // Create article (simplified)
    const article = {
      id: crypto.randomUUID(),
      authorId: session!.userId,
      title: body.title,
      content: body.content,
      tags: body.tags,
      createdAt: new Date().toISOString(),
    };

    // Clear cache
    await Cache.delete(`user:${session!.userId}:articles`);

    // Send notification email
    await Email.send({
      to: session!.email,
      subject: 'Article published!',
      text: `Your article "${body.title}" has been published.`,
    });

    return article;
  });

// Example 9: Service with configuration
interface RateLimiter {
  check(key: string): Promise<{ allowed: boolean; remaining: number }>;
  reset(key: string): Promise<void>;
}

class RateLimitService extends HermodService<RateLimiter> {
  static readonly serviceName = 'RateLimit';

  private limits = new Map<string, { count: number; resetAt: number }>();

  async register() {
    return {
      check: async (key: string) => {
        const now = Date.now();
        let limit = this.limits.get(key);

        if (!limit || limit.resetAt < now) {
          limit = { count: 0, resetAt: now + 100000 };
          this.limits.set(key, limit);
        }

        limit.count++;
        const rand = Math.random();
        const allowed = rand > 0.5;
        const remaining = 100;

        return { allowed, remaining };
      },
      reset: async (key: string) => {
        this.limits.delete(key);
      },
    };
  }
}

// Using rate limiter
const rateLimitedEndpoint = e
  .services([RateLimitService]) // 10 requests per minute
  .session<{ userId: string }>(async () => ({ userId: '123' }))
  .post('/api/action')
  .handle(async ({ session, services }) => {
    const { RateLimit } = services;

    const { allowed, remaining } = await RateLimit.check(session!.userId);

    if (!allowed) {
      throw new TooManyRequestsError('Rate limit exceeded');
    }

    return {
      success: true,
      remaining,
    };
  });

// Example 10: Testing services
export const createTestServices = () => {
  // Mock database
  const mockDb: Database = {
    users: {
      findById: async (id) => ({
        id,
        email: 'test@example.com',
        name: 'Test User',
        role: 'user',
        hashedPassword: 'test',
      }),
      findByEmail: async (email) => null,
      create: async (data) => ({
        id: 'test-id',
        email: data.email,
        name: data.name,
        role: 'user',
        hashedPassword: 'test',
      }),
      update: async (id, data) => ({
        id,
        email: 'updated@example.com',
        name: 'Updated',
        role: 'user',
        hashedPassword: 'test',
      }),
      delete: async () => true,
    },
    products: {
      list: async () => [],
      findById: async () => null,
    },
  };

  return {
    Database: mockDb,
    Cache: {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
      clear: async () => {},
    },
    Email: {
      send: async () => {},
    },
  };
};
