import type { Cache } from '@geekmidas/cache';
import type { TokenStorage } from './client.js';

export class CacheTokenStorage implements TokenStorage {
  private cache: Cache;
  private accessTokenKey: string;
  private refreshTokenKey: string;

  constructor(
    cache: Cache,
    accessTokenKey: string = 'access_token',
    refreshTokenKey: string = 'refresh_token',
  ) {
    this.cache = cache;
    this.accessTokenKey = accessTokenKey;
    this.refreshTokenKey = refreshTokenKey;
  }

  async getAccessToken(): Promise<string | null> {
    const token = await this.cache.get<string>(this.accessTokenKey);
    return token ?? null;
  }

  async setAccessToken(token: string, ttl?: number): Promise<void> {
    await this.cache.set(this.accessTokenKey, token, ttl);
  }

  async getRefreshToken(): Promise<string | null> {
    const token = await this.cache.get<string>(this.refreshTokenKey);
    return token ?? null;
  }

  async setRefreshToken(token: string, ttl?: number): Promise<void> {
    await this.cache.set(this.refreshTokenKey, token, ttl);
  }

  async clearTokens(): Promise<void> {
    await Promise.all([
      this.cache.delete(this.accessTokenKey),
      this.cache.delete(this.refreshTokenKey),
    ]);
  }
}
