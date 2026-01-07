import { InMemoryCache } from '@geekmidas/cache/memory';
import { bench, describe } from 'vitest';
import {
  checkRateLimit,
  type RateLimitConfig,
  type RateLimitContext,
} from '../index';

// Helper to create a mock context
function createContext(ip: string): RateLimitContext {
  return {
    header: (key: string) => (key === 'x-forwarded-for' ? ip : undefined),
    services: {},
    logger: {
      info: () => {},
      error: () => {},
      debug: () => {},
      warn: () => {},
    } as any,
    session: {},
    path: '/test',
    method: 'GET',
  };
}

describe('Rate Limiting', () => {
  const cache = new InMemoryCache();
  const config: RateLimitConfig = {
    limit: 100,
    windowMs: 60000,
    cache,
  };

  bench('checkRateLimit - single IP', async () => {
    const ctx = createContext('127.0.0.1');
    await checkRateLimit(config, ctx);
  });

  bench('checkRateLimit - varying IPs', async () => {
    const ip = `192.168.1.${Math.floor(Math.random() * 255)}`;
    const ctx = createContext(ip);
    await checkRateLimit(config, ctx);
  });
});

describe('Rate Limiting - High Volume', () => {
  bench('100 requests same IP', async () => {
    const cache = new InMemoryCache();
    const config: RateLimitConfig = {
      limit: 1000,
      windowMs: 60000,
      cache,
    };
    const ctx = createContext('10.0.0.1');

    for (let i = 0; i < 100; i++) {
      await checkRateLimit(config, ctx);
    }
  });

  bench('100 requests different IPs', async () => {
    const cache = new InMemoryCache();
    const config: RateLimitConfig = {
      limit: 100,
      windowMs: 60000,
      cache,
    };

    for (let i = 0; i < 100; i++) {
      const ctx = createContext(`10.0.0.${i}`);
      await checkRateLimit(config, ctx);
    }
  });
});

describe('Rate Limiting - Window Sizes', () => {
  bench('1 second window', async () => {
    const cache = new InMemoryCache();
    const config: RateLimitConfig = {
      limit: 10,
      windowMs: 1000,
      cache,
    };
    const ctx = createContext('127.0.0.1');
    await checkRateLimit(config, ctx);
  });

  bench('1 minute window', async () => {
    const cache = new InMemoryCache();
    const config: RateLimitConfig = {
      limit: 100,
      windowMs: 60000,
      cache,
    };
    const ctx = createContext('127.0.0.1');
    await checkRateLimit(config, ctx);
  });

  bench('1 hour window', async () => {
    const cache = new InMemoryCache();
    const config: RateLimitConfig = {
      limit: 1000,
      windowMs: 3600000,
      cache,
    };
    const ctx = createContext('127.0.0.1');
    await checkRateLimit(config, ctx);
  });
});
