import { InMemoryCache } from '@geekmidas/cache/memory';
import { describe, expect, it, vi } from 'vitest';
import {
  checkRateLimit,
  defaultKeyGenerator,
  getRateLimitHeaders,
  type RateLimitConfig,
  type RateLimitContext,
  type RateLimitData,
  TooManyRequestsError,
} from '../index';

describe('Rate Limiting', () => {
  const createContext = (
    overrides?: Partial<RateLimitContext>,
  ): RateLimitContext => ({
    header: vi.fn((key: string) => {
      if (key === 'x-forwarded-for') return '192.168.1.1';
      return undefined;
    }),
    services: [],
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as any,
    session: {},
    path: '/api/test',
    method: 'GET',
    ...overrides,
  });

  describe('defaultKeyGenerator', () => {
    it('should generate key with IP from x-forwarded-for', () => {
      const ctx = createContext();
      const key = defaultKeyGenerator(ctx);
      expect(key).toBe('rate-limit:GET:/api/test:192.168.1.1');
    });

    it('should use x-real-ip when x-forwarded-for is not available', () => {
      const ctx = createContext({
        header: vi.fn((key: string) => {
          if (key === 'x-real-ip') return '10.0.0.1';
          return undefined;
        }),
      });
      const key = defaultKeyGenerator(ctx);
      expect(key).toBe('rate-limit:GET:/api/test:10.0.0.1');
    });

    it('should use unknown when no IP header is available', () => {
      const ctx = createContext({
        header: vi.fn(() => undefined),
      });
      const key = defaultKeyGenerator(ctx);
      expect(key).toBe('rate-limit:GET:/api/test:unknown');
    });

    it('should handle comma-separated IPs in x-forwarded-for', () => {
      const ctx = createContext({
        header: vi.fn((key: string) => {
          if (key === 'x-forwarded-for')
            return '192.168.1.1, 10.0.0.1, 172.16.0.1';
          return undefined;
        }),
      });
      const key = defaultKeyGenerator(ctx);
      expect(key).toBe('rate-limit:GET:/api/test:192.168.1.1');
    });
  });

  describe('checkRateLimit', () => {
    it('should allow requests within the limit', async () => {
      const cache = new InMemoryCache<RateLimitData>();
      const config: RateLimitConfig<RateLimitData> = {
        limit: 5,
        windowMs: 60000, // 1 minute
        cache,
      };
      const ctx = createContext();

      const info = await checkRateLimit(config, ctx);
      expect(info.count).toBe(1);
      expect(info.remaining).toBe(4);
      expect(info.limit).toBe(5);
    });

    it('should increment count on subsequent requests', async () => {
      const cache = new InMemoryCache<RateLimitData>();
      const config: RateLimitConfig<RateLimitData> = {
        limit: 5,
        windowMs: 60000,
        cache,
      };
      const ctx = createContext();

      // First request
      await checkRateLimit(config, ctx);

      // Second request
      const info = await checkRateLimit(config, ctx);
      expect(info.count).toBe(2);
      expect(info.remaining).toBe(3);
    });

    it('should throw TooManyRequestsError when limit is exceeded', async () => {
      const cache = new InMemoryCache<RateLimitData>();
      const config: RateLimitConfig<RateLimitData> = {
        limit: 2,
        windowMs: 60000,
        cache,
      };
      const ctx = createContext();

      // Use up the limit
      await checkRateLimit(config, ctx);
      await checkRateLimit(config, ctx);

      // Exceed the limit
      await expect(checkRateLimit(config, ctx)).rejects.toThrow(
        TooManyRequestsError,
      );
    });

    it('should use custom message when rate limit is exceeded', async () => {
      const cache = new InMemoryCache<RateLimitData>();
      const config: RateLimitConfig<RateLimitData> = {
        limit: 1,
        windowMs: 60000,
        cache,
        message: 'Custom rate limit message',
      };
      const ctx = createContext();

      await checkRateLimit(config, ctx);

      try {
        await checkRateLimit(config, ctx);
      } catch (error) {
        expect(error).toBeInstanceOf(TooManyRequestsError);
        expect((error as TooManyRequestsError).message).toBe(
          'Custom rate limit message',
        );
      }
    });

    it('should skip rate limiting when skip function returns true', async () => {
      const cache = new InMemoryCache<RateLimitData>();
      const config: RateLimitConfig<RateLimitData> = {
        limit: 1,
        windowMs: 60000,
        cache,
        skip: vi.fn().mockResolvedValue(true),
      };
      const ctx = createContext();

      // Should not throw even though limit would be exceeded
      await checkRateLimit(config, ctx);
      const info = await checkRateLimit(config, ctx);

      expect(info.count).toBe(0);
      expect(info.remaining).toBe(1);
      expect(config.skip).toHaveBeenCalledWith(ctx);
    });

    it('should call custom handler when rate limit is exceeded', async () => {
      const cache = new InMemoryCache<RateLimitData>();
      const handler = vi.fn();
      const config: RateLimitConfig<RateLimitData> = {
        limit: 1,
        windowMs: 60000,
        cache,
        handler,
      };
      const ctx = createContext();

      await checkRateLimit(config, ctx);

      try {
        await checkRateLimit(config, ctx);
      } catch {
        // Expected to throw
      }

      expect(handler).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({
          count: 2,
          limit: 1,
          remaining: 0,
        }),
      );
    });

    it('should use custom key generator', async () => {
      const cache = new InMemoryCache<RateLimitData>();
      const keyGenerator = vi.fn().mockReturnValue('custom-key');
      const config: RateLimitConfig<RateLimitData> = {
        limit: 5,
        windowMs: 60000,
        cache,
        keyGenerator,
      };
      const ctx = createContext();

      await checkRateLimit(config, ctx);

      expect(keyGenerator).toHaveBeenCalledWith(ctx);
    });

    it('should reset count after window expires', async () => {
      const cache = new InMemoryCache<RateLimitData>();
      const config: RateLimitConfig<RateLimitData> = {
        limit: 2,
        windowMs: 100, // 100ms window
        cache,
      };
      const ctx = createContext();

      // Use up the limit
      await checkRateLimit(config, ctx);
      await checkRateLimit(config, ctx);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should be allowed again
      const info = await checkRateLimit(config, ctx);
      expect(info.count).toBe(1);
      expect(info.remaining).toBe(1);
    });
  });

  describe('getRateLimitHeaders', () => {
    it('should generate standard headers by default', () => {
      const info = {
        count: 3,
        limit: 10,
        remaining: 7,
        resetTime: Date.now() + 60000,
        retryAfter: 60000,
      };
      const config: RateLimitConfig = {
        limit: 10,
        windowMs: 60000,
        cache: new InMemoryCache(),
      };

      const headers = getRateLimitHeaders(info, config);

      expect(headers['X-RateLimit-Limit']).toBe('10');
      expect(headers['X-RateLimit-Remaining']).toBe('7');
      expect(headers['X-RateLimit-Reset']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(headers['Retry-After']).toBeUndefined();
    });

    it('should include Retry-After when limit is exceeded', () => {
      const info = {
        count: 11,
        limit: 10,
        remaining: 0,
        resetTime: Date.now() + 60000,
        retryAfter: 60000,
      };
      const config: RateLimitConfig = {
        limit: 10,
        windowMs: 60000,
        cache: new InMemoryCache(),
      };

      const headers = getRateLimitHeaders(info, config);

      expect(headers['Retry-After']).toBe('60');
    });

    it('should not include standard headers when disabled', () => {
      const info = {
        count: 3,
        limit: 10,
        remaining: 7,
        resetTime: Date.now() + 60000,
        retryAfter: 60000,
      };
      const config: RateLimitConfig = {
        limit: 10,
        windowMs: 60000,
        cache: new InMemoryCache(),
        standardHeaders: false,
      };

      const headers = getRateLimitHeaders(info, config);

      expect(headers['X-RateLimit-Limit']).toBeUndefined();
      expect(headers['X-RateLimit-Remaining']).toBeUndefined();
      expect(headers['X-RateLimit-Reset']).toBeUndefined();
    });

    it('should include legacy headers when enabled', () => {
      const info = {
        count: 3,
        limit: 10,
        remaining: 7,
        resetTime: Date.now() + 60000,
        retryAfter: 60000,
      };
      const config: RateLimitConfig = {
        limit: 10,
        windowMs: 60000,
        cache: new InMemoryCache(),
        legacyHeaders: true,
      };

      const headers = getRateLimitHeaders(info, config);

      expect(headers['X-RateLimit-Retry-After']).toBe('60000');
      expect(headers['X-RateLimit-Reset-After']).toBe('60');
    });
  });
});
