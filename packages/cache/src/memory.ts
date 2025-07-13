import type { Cache } from './cache';

export class InMemoryCache<T> implements Cache<T> {
  private store: Map<string, T> = new Map();

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
