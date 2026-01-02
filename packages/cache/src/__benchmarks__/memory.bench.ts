import { bench, describe } from 'vitest';
import { InMemoryCache } from '../memory';

describe('InMemoryCache', () => {
  const cache = new InMemoryCache();

  bench('set with TTL', async () => {
    await cache.set('key', 'value', 3600);
  });

  bench('get (cache hit)', async () => {
    await cache.set('hit-key', 'value', 3600);
    await cache.get('hit-key');
  });

  bench('get (cache miss)', async () => {
    await cache.get('nonexistent-key');
  });

  bench('delete', async () => {
    await cache.set('delete-key', 'value', 3600);
    await cache.delete('delete-key');
  });

  bench('set + get cycle', async () => {
    const key = `cycle-${Math.random()}`;
    await cache.set(key, 'value', 3600);
    await cache.get(key);
  });
});

describe('InMemoryCache - Large Scale', () => {
  bench('1000 sequential sets', async () => {
    const cache = new InMemoryCache();
    for (let i = 0; i < 1000; i++) {
      await cache.set(`key-${i}`, `value-${i}`, 3600);
    }
  });

  bench('1000 sequential gets', async () => {
    const cache = new InMemoryCache();
    // Pre-populate
    for (let i = 0; i < 1000; i++) {
      await cache.set(`key-${i}`, `value-${i}`, 3600);
    }
    // Benchmark gets
    for (let i = 0; i < 1000; i++) {
      await cache.get(`key-${i}`);
    }
  });
});
