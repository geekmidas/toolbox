import { Redis } from '@upstash/redis';
import type { Cache } from './';

export class UpstashCache<T> implements Cache<T> {
  private client: Redis;

  constructor(url: string, token: string) {
    this.client = new Redis({
      url,
      token,
    });
  }

  async ttl(key: string): Promise<number> {
    const ttl = await this.client.ttl(key);

    if (ttl === -2) {
      return 0; // Key does not exist
    }

    return ttl; // Returns TTL in seconds
  }

  async get(key: string): Promise<T | undefined> {
    const v = await this.client.get(key);

    if (v === null) {
      return undefined;
    }

    return v as T; // Assuming the value is stored as a string, you may need to parse it if it's JSON
  }

  async set(key: string, value: T, ttl = 3600): Promise<void> {
    await this.client.set(key, value, { ex: ttl });
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }
}
