import { differenceInSeconds } from 'date-fns';
import * as SecureStore from 'expo-secure-store';
import type { Cache } from './index';

export class ExpoSecureCache<T> implements Cache<T> {
  static getExpiryKey(key: string): string {
    return `${key}:expiresAt`;
  }

  private async getExpiration(key: string): Promise<number> {
    const result = await SecureStore.getItemAsync(
      ExpoSecureCache.getExpiryKey(key),
    );
    if (!result) {
      return 0;
    }

    const date = new Date(JSON.parse(result));

    const secondsLeft = differenceInSeconds(date, new Date());

    return Math.max(secondsLeft, 0);
  }

  // Implementation details
  async get(key: string): Promise<T | undefined> {
    const result = await SecureStore.getItemAsync(key);
    if (!result) {
      return undefined;
    }

    const expiresAt = await this.getExpiration(key);
    if (expiresAt === 0) {
      return undefined;
    }

    return JSON.parse(result) as T;
  }

  async set(key: string, value: T, ttl?: number): Promise<void> {
    const expiresAt = ttl ? Date.now() + ttl * 1000 : 0;
    await SecureStore.setItemAsync(key, JSON.stringify(value));
    await SecureStore.setItemAsync(
      ExpoSecureCache.getExpiryKey(key),
      JSON.stringify(expiresAt),
    );
  }

  async delete(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
    await SecureStore.deleteItemAsync(ExpoSecureCache.getExpiryKey(key));
  }
}
