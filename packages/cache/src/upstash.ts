import { Redis } from '@upstash/redis';
import type { Cache } from './cache';

export class UpstashCache<T> implements Cache<T> {
  private client: Redis;

  constructor(url: string, token: string) {
    this.client = new Redis({
      url,
      token,
    });
  }

  async get(key: string): Promise<T | undefined> {
    const value = await this.client.get(key);
    // @ts-ignore
    return value ? JSON.parse(value) : undefined;
  }

  async set(key: string, value: T): Promise<void> {
    await this.client.set(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }
}
