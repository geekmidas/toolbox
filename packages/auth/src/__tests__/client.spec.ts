import { InMemoryCache } from '@geekmidas/cache/memory';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  CacheTokenStorage,
  LocalStorageTokenStorage,
  MemoryTokenStorage,
  TokenClient,
  type TokenStorage,
} from '../client.ts';

// Mock localStorage for browser environment simulation
const mockLocalStorage = {
  getItem: (key: string) => {
    return mockLocalStorage._storage[key] || null;
  },
  setItem: (key: string, value: string) => {
    mockLocalStorage._storage[key] = value;
  },
  removeItem: (key: string) => {
    delete mockLocalStorage._storage[key];
  },
  _storage: {} as Record<string, string>,
  _reset: () => {
    mockLocalStorage._storage = {};
  },
};

Object.defineProperty(global, 'localStorage', {
  value: mockLocalStorage,
});

// Setup MSW server for API testing
const server = setupServer(
  http.post('https://auth.toolbox.dev/auth/refresh', () => {
    return HttpResponse.json({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    });
  }),
);

describe('LocalStorageTokenStorage', () => {
  let storage: LocalStorageTokenStorage;

  beforeEach(() => {
    mockLocalStorage._reset();
    storage = new LocalStorageTokenStorage();
  });

  describe('token lifecycle', () => {
    it('should return null when tokens do not exist', () => {
      expect(storage.getAccessToken()).toBeNull();
      expect(storage.getRefreshToken()).toBeNull();
    });

    it('should clear both tokens', () => {
      storage.setAccessToken('access-token');
      storage.setRefreshToken('refresh-token');

      storage.clearTokens();

      expect(storage.getAccessToken()).toBeNull();
      expect(storage.getRefreshToken()).toBeNull();
    });
  });
});

describe('MemoryTokenStorage', () => {
  let storage: MemoryTokenStorage;

  beforeEach(() => {
    storage = new MemoryTokenStorage();
  });

  describe('token lifecycle', () => {
    it('should store and retrieve tokens in memory', () => {
      storage.setAccessToken('memory-access-token');
      storage.setRefreshToken('memory-refresh-token');

      expect(storage.getAccessToken()).toBe('memory-access-token');
      expect(storage.getRefreshToken()).toBe('memory-refresh-token');
    });

    it('should return null for unset tokens', () => {
      expect(storage.getAccessToken()).toBeNull();
      expect(storage.getRefreshToken()).toBeNull();
    });

    it('should clear all tokens', () => {
      storage.setAccessToken('access-token');
      storage.setRefreshToken('refresh-token');

      storage.clearTokens();

      expect(storage.getAccessToken()).toBeNull();
      expect(storage.getRefreshToken()).toBeNull();
    });

    it('should maintain separate instances', () => {
      const storage1 = new MemoryTokenStorage();
      const storage2 = new MemoryTokenStorage();

      storage1.setAccessToken('token1');
      storage2.setAccessToken('token2');

      expect(storage1.getAccessToken()).toBe('token1');
      expect(storage2.getAccessToken()).toBe('token2');
    });
  });
});

describe('CacheTokenStorage', () => {
  let storage: CacheTokenStorage;
  let cache: InMemoryCache<string>;

  beforeEach(() => {
    cache = new InMemoryCache<string>();
    storage = new CacheTokenStorage(cache);
  });

  describe('token lifecycle with cache', () => {
    it('should store and retrieve tokens via cache', async () => {
      await storage.setAccessToken('cache-access-token');
      await storage.setRefreshToken('cache-refresh-token');

      const accessToken = await storage.getAccessToken();
      const refreshToken = await storage.getRefreshToken();

      expect(accessToken).toBe('cache-access-token');
      expect(refreshToken).toBe('cache-refresh-token');
    });

    it('should handle TTL for tokens', async () => {
      await storage.setAccessToken('ttl-access-token', 3600);
      await storage.setRefreshToken('ttl-refresh-token', 7200);

      const accessToken = await storage.getAccessToken();
      const refreshToken = await storage.getRefreshToken();

      expect(accessToken).toBe('ttl-access-token');
      expect(refreshToken).toBe('ttl-refresh-token');
    });

    it('should clear both tokens from cache', async () => {
      await storage.setAccessToken('access-token');
      await storage.setRefreshToken('refresh-token');

      await storage.clearTokens();

      const accessToken = await storage.getAccessToken();
      const refreshToken = await storage.getRefreshToken();

      expect(accessToken).toBeNull();
      expect(refreshToken).toBeNull();
    });
  });
});

describe('TokenClient', () => {
  let client: TokenClient;
  let storage: TokenStorage;

  beforeAll(() => server.listen());
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  beforeEach(() => {
    storage = new MemoryTokenStorage();
    client = new TokenClient({
      storage,
      refreshEndpoint: 'https://auth.toolbox.dev/auth/refresh',
    });
  });

  describe('token management', () => {
    it('should store and retrieve tokens', async () => {
      await client.setTokens('access-token', 'refresh-token');

      const accessToken = await client.getAccessToken();
      const refreshToken = await client.getRefreshToken();

      expect(accessToken).toBe('access-token');
      expect(refreshToken).toBe('refresh-token');
    });

    it('should store tokens with TTL', async () => {
      await client.setTokens('access-token', 'refresh-token', 900, 7200);

      const accessToken = await client.getAccessToken();
      const refreshToken = await client.getRefreshToken();

      expect(accessToken).toBe('access-token');
      expect(refreshToken).toBe('refresh-token');
    });

    it('should store only access token when refresh not provided', async () => {
      await client.setTokens('access-only-token');

      const accessToken = await client.getAccessToken();
      const refreshToken = await client.getRefreshToken();

      expect(accessToken).toBe('access-only-token');
      expect(refreshToken).toBeNull();
    });

    it('should clear all tokens', async () => {
      await client.setTokens('access-token', 'refresh-token');
      await client.clearTokens();

      const accessToken = await client.getAccessToken();
      const refreshToken = await client.getRefreshToken();

      expect(accessToken).toBeNull();
      expect(refreshToken).toBeNull();
    });
  });

  describe('token validation', () => {
    it('should identify valid tokens correctly', () => {
      const validPayload = { exp: Math.floor(Date.now() / 1000) + 3600 };
      const validToken = `header.${btoa(JSON.stringify(validPayload))}.signature`;

      expect(client.isTokenExpired(validToken)).toBe(false);

      const expiration = client.getTokenExpiration(validToken);
      expect(expiration).toBeInstanceOf(Date);
      expect(expiration!.getTime()).toBe(validPayload.exp * 1000);
    });

    it('should identify expired tokens correctly', () => {
      const expiredPayload = { exp: Math.floor(Date.now() / 1000) - 3600 };
      const expiredToken = `header.${btoa(JSON.stringify(expiredPayload))}.signature`;

      expect(client.isTokenExpired(expiredToken)).toBe(true);

      const expiration = client.getTokenExpiration(expiredToken);
      expect(expiration).toBeInstanceOf(Date);
      expect(expiration!.getTime()).toBe(expiredPayload.exp * 1000);
    });

    it('should handle malformed tokens gracefully', () => {
      expect(client.isTokenExpired('malformed-token')).toBe(true);
      expect(client.isTokenExpired('')).toBe(true);
      expect(client.isTokenExpired('not.a.token')).toBe(true);

      expect(client.getTokenExpiration('malformed-token')).toBeNull();
      expect(client.getTokenExpiration('')).toBeNull();
      expect(client.getTokenExpiration('not.a.token')).toBeNull();
    });
  });

  describe('API integration with MSW', () => {
    it('should refresh tokens via API successfully', async () => {
      await storage.setRefreshToken('valid-refresh-token');

      const success = await client.refreshTokens();

      expect(success).toBe(true);
      expect(await storage.getAccessToken()).toBe('new-access-token');
      expect(await storage.getRefreshToken()).toBe('new-refresh-token');
    });

    it('should handle API errors gracefully', async () => {
      server.use(
        http.post('https://auth.toolbox.dev/auth/refresh', () => {
          return new HttpResponse(null, { status: 401 });
        }),
      );

      await storage.setRefreshToken('invalid-refresh-token');

      const success = await client.refreshTokens();

      expect(success).toBe(false);
      expect(await storage.getAccessToken()).toBeNull();
      expect(await storage.getRefreshToken()).toBeNull();
    });

    it('should handle network errors gracefully', async () => {
      server.use(
        http.post('https://auth.toolbox.dev/auth/refresh', () => {
          return HttpResponse.error();
        }),
      );

      await storage.setRefreshToken('valid-refresh-token');

      const success = await client.refreshTokens();

      expect(success).toBe(false);
      expect(await storage.getAccessToken()).toBeNull();
      expect(await storage.getRefreshToken()).toBeNull();
    });

    it('should fail when no refresh token available', async () => {
      const success = await client.refreshTokens();

      expect(success).toBe(false);
    });

    it('should fail when refresh endpoint not configured', async () => {
      const clientWithoutEndpoint = new TokenClient({ storage });
      await storage.setRefreshToken('valid-refresh-token');

      const success = await clientWithoutEndpoint.refreshTokens();

      expect(success).toBe(false);
    });
  });

  describe('callback handling', () => {
    it('should call onTokenRefresh callback on success', async () => {
      let callbackData: any = null;
      const clientWithCallback = new TokenClient({
        storage,
        refreshEndpoint: 'https://auth.toolbox.dev/auth/refresh',
        onTokenRefresh: (data) => {
          callbackData = data;
        },
      });

      await storage.setRefreshToken('valid-refresh-token');

      await clientWithCallback.refreshTokens();

      expect(callbackData).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
    });

    it('should call onTokenExpired callback on failure', async () => {
      let callbackCalled = false;
      const clientWithCallback = new TokenClient({
        storage,
        refreshEndpoint: 'https://auth.toolbox.dev/auth/refresh',
        onTokenExpired: () => {
          callbackCalled = true;
        },
      });

      server.use(
        http.post('https://auth.toolbox.dev/auth/refresh', () => {
          return new HttpResponse(null, { status: 401 });
        }),
      );

      await storage.setRefreshToken('invalid-refresh-token');

      await clientWithCallback.refreshTokens();

      expect(callbackCalled).toBe(true);
    });
  });

  describe('getValidAccessToken workflow', () => {
    it('should return valid token without refresh', async () => {
      const validPayload = { exp: Math.floor(Date.now() / 1000) + 3600 };
      const validToken = `header.${btoa(JSON.stringify(validPayload))}.signature`;

      await storage.setAccessToken(validToken);

      const token = await client.getValidAccessToken();

      expect(token).toBe(validToken);
    });

    it('should return null when no token available', async () => {
      const token = await client.getValidAccessToken();

      expect(token).toBeNull();
    });

    it('should refresh expired token automatically', async () => {
      const expiredPayload = { exp: Math.floor(Date.now() / 1000) - 3600 };
      const expiredToken = `header.${btoa(JSON.stringify(expiredPayload))}.signature`;

      await storage.setAccessToken(expiredToken);
      await storage.setRefreshToken('valid-refresh-token');

      const token = await client.getValidAccessToken();

      expect(token).toBe('new-access-token');
    });

    it('should return null when refresh fails', async () => {
      server.use(
        http.post('https://auth.toolbox.dev/auth/refresh', () => {
          return new HttpResponse(null, { status: 401 });
        }),
      );

      const expiredPayload = { exp: Math.floor(Date.now() / 1000) - 3600 };
      const expiredToken = `header.${btoa(JSON.stringify(expiredPayload))}.signature`;

      await storage.setAccessToken(expiredToken);
      await storage.setRefreshToken('invalid-refresh-token');

      const token = await client.getValidAccessToken();

      expect(token).toBeNull();
    });
  });

  describe('authorization headers', () => {
    it('should create headers with current token', async () => {
      await storage.setAccessToken('current-token');

      const headers = await client.createAuthHeaders();

      expect(headers).toEqual({
        Authorization: 'Bearer current-token',
      });
    });

    it('should return empty headers when no token', async () => {
      const headers = await client.createAuthHeaders();

      expect(headers).toEqual({});
    });

    it('should create headers with valid token', async () => {
      const validPayload = { exp: Math.floor(Date.now() / 1000) + 3600 };
      const validToken = `header.${btoa(JSON.stringify(validPayload))}.signature`;

      await storage.setAccessToken(validToken);

      const headers = await client.createValidAuthHeaders();

      expect(headers).toEqual({
        Authorization: `Bearer ${validToken}`,
      });
    });

    it('should create headers with refreshed token', async () => {
      const expiredPayload = { exp: Math.floor(Date.now() / 1000) - 3600 };
      const expiredToken = `header.${btoa(JSON.stringify(expiredPayload))}.signature`;

      await storage.setAccessToken(expiredToken);
      await storage.setRefreshToken('valid-refresh-token');

      const headers = await client.createValidAuthHeaders();

      expect(headers).toEqual({
        Authorization: 'Bearer new-access-token',
      });
    });

    it('should return empty headers when no valid token available', async () => {
      const headers = await client.createValidAuthHeaders();

      expect(headers).toEqual({});
    });
  });
});
