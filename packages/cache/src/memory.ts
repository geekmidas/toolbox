import { addSeconds } from 'date-fns';
import { type Cache, getExpirationInSeconds } from './';

export class InMemoryCache implements Cache {
  private store: Map<string, unknown> = new Map();
  private expirations: Map<string, Date> = new Map();

  async get<T>(key: string): Promise<T | undefined> {
    const expiration = await this.ttl(key);
    if (!expiration) {
      await this.delete(key);
      return undefined;
    }

    return this.store.get(key) as T | undefined;
  }

  async ttl(key: string): Promise<number> {
    const expiration = this.expirations.get(key);
    if (!expiration) {
      return 0;
    }

    return getExpirationInSeconds(expiration);
  }

  async set<T>(key: string, value: T, ttl: number = 600): Promise<void> {
    this.store.set(key, value);
    const now = new Date();
    const expiresAt = addSeconds(now, ttl);
    this.expirations.set(key, expiresAt);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
    this.expirations.delete(key);
  }
}
