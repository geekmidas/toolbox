import { Hono } from 'hono';
import * as jose from 'jose';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { OidcClaims, OidcUserInfo } from '../hono/oidc';
import { OidcMiddleware } from '../hono/oidc';

// Define context variable types for Hono
type AppVariables = {
  oidcClaims: OidcClaims;
  oidcToken: string;
  oidcUserInfo: OidcUserInfo;
  user: OidcClaims;
};

// Mock discovery document
const mockDiscovery = {
  issuer: 'https://auth.example.com',
  authorization_endpoint: 'https://auth.example.com/authorize',
  token_endpoint: 'https://auth.example.com/token',
  userinfo_endpoint: 'https://auth.example.com/userinfo',
  jwks_uri: 'https://auth.example.com/.well-known/jwks.json',
  scopes_supported: ['openid', 'profile', 'email'],
  response_types_supported: ['code', 'token'],
  claims_supported: ['sub', 'name', 'email'],
};

// Mock user info
const mockUserInfo = {
  sub: 'user-123',
  name: 'Test User',
  email: 'test@example.com',
  email_verified: true,
};

// Generate test keys and tokens - stored in object for mock access
const testKeys: {
  privateKey: jose.KeyLike | null;
  publicKey: jose.KeyLike | null;
} = {
  privateKey: null,
  publicKey: null,
};
let jwks: jose.JSONWebKeySet;

async function setupKeys() {
  const keyPair = await jose.generateKeyPair('RS256');
  testKeys.privateKey = keyPair.privateKey;
  testKeys.publicKey = keyPair.publicKey;
  const publicJwk = await jose.exportJWK(keyPair.publicKey);
  jwks = {
    keys: [{ ...publicJwk, kid: 'test-key-id', use: 'sig', alg: 'RS256' }],
  };
}

// Mock createRemoteJWKSet to return test keys directly.
// MSW intercepts jose's fetch in standalone scripts but fails in vitest for unknown reasons.
// TODO: Investigate vitest/MSW/jose interaction and remove this mock if possible.
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof jose>();
  return {
    ...actual,
    createRemoteJWKSet: () => {
      return async (protectedHeader: jose.JWSHeaderParameters) => {
        if (protectedHeader.kid === 'test-key-id' && testKeys.publicKey) {
          return testKeys.publicKey;
        }
        throw new Error(`Unknown key ID: ${protectedHeader.kid}`);
      };
    },
  };
});

async function createTestToken(
  claims: Record<string, unknown> = {},
  options: { expiresIn?: string } = {},
) {
  if (!testKeys.privateKey) {
    throw new Error('Keys not initialized');
  }
  return await new jose.SignJWT({ sub: 'user-123', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-id' })
    .setIssuedAt()
    .setIssuer('https://auth.example.com')
    .setAudience('my-api')
    .setExpirationTime(options.expiresIn ?? '1h')
    .sign(testKeys.privateKey);
}

// MSW server setup
const server = setupServer(
  http.get('https://auth.example.com/.well-known/openid-configuration', () => {
    return HttpResponse.json(mockDiscovery);
  }),
  http.get('https://auth.example.com/.well-known/jwks.json', () => {
    return HttpResponse.json(jwks);
  }),
  http.get('https://auth.example.com/userinfo', () => {
    return HttpResponse.json(mockUserInfo);
  }),
);

describe('OidcMiddleware', () => {
  beforeAll(async () => {
    await setupKeys();
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  describe('handler()', () => {
    it('should allow request with valid token', async () => {
      const middleware = new OidcMiddleware({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
      });

      const app = new Hono<{ Variables: AppVariables }>();
      app.use('/*', middleware.handler());
      app.get('/protected', (c) => {
        const claims = c.get('oidcClaims');
        return c.json({ userId: claims.sub });
      });

      const token = await createTestToken();
      const res = await app.request('/protected', {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toBe('user-123');
    });

    it('should return 401 when no token is provided', async () => {
      const middleware = new OidcMiddleware({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
      });

      const app = new Hono<{ Variables: AppVariables }>();
      app.use('/*', middleware.handler());
      app.get('/protected', (c) => c.json({ success: true }));

      const res = await app.request('/protected');

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 401 for invalid token', async () => {
      const middleware = new OidcMiddleware({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
      });

      const app = new Hono<{ Variables: AppVariables }>();
      app.use('/*', middleware.handler());
      app.get('/protected', (c) => c.json({ success: true }));

      const res = await app.request('/protected', {
        headers: {
          authorization: 'Bearer invalid-token',
        },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Invalid token');
    });

    it('should set token in context', async () => {
      const middleware = new OidcMiddleware({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
      });

      const app = new Hono<{ Variables: AppVariables }>();
      app.use('/*', middleware.handler());
      app.get('/protected', (c) => {
        const token = c.get('oidcToken');
        return c.json({ hasToken: !!token });
      });

      const token = await createTestToken();
      const res = await app.request('/protected', {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.hasToken).toBe(true);
    });

    it('should use custom context key', async () => {
      const middleware = new OidcMiddleware({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
        contextKey: 'user',
      });

      const app = new Hono<{ Variables: AppVariables }>();
      app.use('/*', middleware.handler());
      app.get('/protected', (c) => {
        const user = c.get('user');
        return c.json({ userId: user.sub });
      });

      const token = await createTestToken();
      const res = await app.request('/protected', {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toBe('user-123');
    });

    it('should extract token from cookie', async () => {
      const middleware = new OidcMiddleware({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
        extraction: {
          cookieName: 'auth_token',
        },
      });

      const app = new Hono<{ Variables: AppVariables }>();
      app.use('/*', middleware.handler());
      app.get('/protected', (c) => {
        const claims = c.get('oidcClaims');
        return c.json({ userId: claims.sub });
      });

      const token = await createTestToken();
      const res = await app.request('/protected', {
        headers: {
          cookie: `auth_token=${token}; other=value`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toBe('user-123');
    });

    it('should use custom header name', async () => {
      const middleware = new OidcMiddleware({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
        extraction: {
          headerName: 'x-auth-token',
          tokenPrefix: '',
        },
      });

      const app = new Hono<{ Variables: AppVariables }>();
      app.use('/*', middleware.handler());
      app.get('/protected', (c) => {
        const claims = c.get('oidcClaims');
        return c.json({ userId: claims.sub });
      });

      const token = await createTestToken();
      const res = await app.request('/protected', {
        headers: {
          'x-auth-token': token,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toBe('user-123');
    });

    it('should call custom onError handler', async () => {
      const middleware = new OidcMiddleware({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
        onError: (c, error) => {
          return c.json({ customError: error.message }, 403);
        },
      });

      const app = new Hono<{ Variables: AppVariables }>();
      app.use('/*', middleware.handler());
      app.get('/protected', (c) => c.json({ success: true }));

      const res = await app.request('/protected');

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.customError).toBe('No token provided');
    });

    it('should call onError for invalid token', async () => {
      const middleware = new OidcMiddleware({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
        onError: (c, error) => {
          return c.json({ customError: 'Token verification failed' }, 401);
        },
      });

      const app = new Hono<{ Variables: AppVariables }>();
      app.use('/*', middleware.handler());
      app.get('/protected', (c) => c.json({ success: true }));

      const res = await app.request('/protected', {
        headers: {
          authorization: 'Bearer invalid-token',
        },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.customError).toBe('Token verification failed');
    });

    it('should fetch user info when configured', async () => {
      const middleware = new OidcMiddleware({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
        fetchUserInfo: true,
      });

      const app = new Hono<{ Variables: AppVariables }>();
      app.use('/*', middleware.handler());
      app.get('/protected', (c) => {
        const userInfo = c.get('oidcUserInfo');
        return c.json({ name: userInfo?.name, email: userInfo?.email });
      });

      const token = await createTestToken();
      const res = await app.request('/protected', {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('Test User');
      expect(body.email).toBe('test@example.com');
    });

    it('should transform claims when configured', async () => {
      interface CustomClaims {
        sub?: string;
        userId: string;
        displayName: string;
      }

      const middleware = new OidcMiddleware<CustomClaims>({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
        fetchUserInfo: true,
        transformClaims: (claims, userInfo) => ({
          ...claims,
          userId: claims.sub!,
          displayName: userInfo?.name ?? 'Unknown',
        }),
      });

      const app = new Hono<{ Variables: AppVariables }>();
      app.use('/*', middleware.handler());
      app.get('/protected', (c) => {
        const claims = c.get('oidcClaims') as CustomClaims;
        return c.json({
          userId: claims.userId,
          displayName: claims.displayName,
        });
      });

      const token = await createTestToken();
      const res = await app.request('/protected', {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toBe('user-123');
      expect(body.displayName).toBe('Test User');
    });
  });

  describe('optional()', () => {
    it('should allow request without token', async () => {
      const middleware = new OidcMiddleware({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
      });

      const app = new Hono<{ Variables: AppVariables }>();
      app.use('/*', middleware.optional());
      app.get('/public', (c) => {
        const claims = c.get('oidcClaims');
        return c.json({ authenticated: !!claims });
      });

      const res = await app.request('/public');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.authenticated).toBe(false);
    });

    it('should set claims when valid token is provided', async () => {
      const middleware = new OidcMiddleware({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
      });

      const app = new Hono<{ Variables: AppVariables }>();
      app.use('/*', middleware.optional());
      app.get('/public', (c) => {
        const claims = c.get('oidcClaims');
        return c.json({
          authenticated: !!claims,
          userId: claims?.sub,
        });
      });

      const token = await createTestToken();
      const res = await app.request('/public', {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.authenticated).toBe(true);
      expect(body.userId).toBe('user-123');
    });

    it('should ignore invalid token and continue', async () => {
      const middleware = new OidcMiddleware({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
      });

      const app = new Hono<{ Variables: AppVariables }>();
      app.use('/*', middleware.optional());
      app.get('/public', (c) => {
        const claims = c.get('oidcClaims');
        return c.json({ authenticated: !!claims });
      });

      const res = await app.request('/public', {
        headers: {
          authorization: 'Bearer invalid-token',
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.authenticated).toBe(false);
    });

    it('should fetch user info when configured', async () => {
      const middleware = new OidcMiddleware({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
        fetchUserInfo: true,
      });

      const app = new Hono<{ Variables: AppVariables }>();
      app.use('/*', middleware.optional());
      app.get('/public', (c) => {
        const userInfo = c.get('oidcUserInfo');
        return c.json({
          hasUserInfo: !!userInfo,
          name: userInfo?.name,
        });
      });

      const token = await createTestToken();
      const res = await app.request('/public', {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.hasUserInfo).toBe(true);
      expect(body.name).toBe('Test User');
    });

    it('should transform claims when configured', async () => {
      const middleware = new OidcMiddleware({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
        transformClaims: (claims) => ({
          ...claims,
          customField: 'custom-value',
        }),
      });

      const app = new Hono<{ Variables: AppVariables }>();
      app.use('/*', middleware.optional());
      app.get('/public', (c) => {
        const claims = c.get('oidcClaims');
        return c.json({
          hasCustomField: !!(claims as any)?.customField,
        });
      });

      const token = await createTestToken();
      const res = await app.request('/public', {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.hasCustomField).toBe(true);
    });

    it('should set token in context', async () => {
      const middleware = new OidcMiddleware({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
      });

      const app = new Hono<{ Variables: AppVariables }>();
      app.use('/*', middleware.optional());
      app.get('/public', (c) => {
        const token = c.get('oidcToken');
        return c.json({ hasToken: !!token });
      });

      const token = await createTestToken();
      const res = await app.request('/public', {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.hasToken).toBe(true);
    });
  });
});
