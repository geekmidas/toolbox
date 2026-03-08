# @geekmidas/auth

JWT-based authentication with token management and automatic refresh.

## Installation

```bash
pnpm add @geekmidas/auth
```

## Features

- Access/refresh token pattern with automatic refresh
- Multiple storage backends (localStorage, memory, cache)
- Type-safe token payloads with generics
- Server-side token validation and generation
- Configurable expiration and refresh behavior

## Package Exports

| Export | Description |
|--------|-------------|
| `/` | Core interfaces and types |
| `/jwt` | `JwtVerifier` - JWT verification with secret or JWKS |
| `/oidc` | `OidcVerifier` - OIDC auto-discovery and token verification |
| `/server` | Server-side token management (TokenManager) |
| `/client` | Client-side token management (TokenClient, storage backends) |
| `/hono/jwt` | `JwtMiddleware` for Hono (required and optional auth) |
| `/hono/oidc` | `OidcMiddleware` for Hono |
| `/lambda/jwt` | `JwtAuthorizer` for AWS Lambda (TOKEN and REQUEST types) |
| `/lambda/oidc` | `OidcAuthorizer` for AWS Lambda |

## JWT Verification

Verify JWTs using a shared secret or JWKS (JSON Web Key Set):

```typescript
import { JwtVerifier } from '@geekmidas/auth/jwt';

// With shared secret
const verifier = new JwtVerifier({
  secret: process.env.JWT_SECRET,
});

// With JWKS (e.g., Auth0, Cognito)
const verifier = new JwtVerifier({
  jwksUri: 'https://auth.example.com/.well-known/jwks.json',
});

const claims = await verifier.verify(token);
// claims: { sub, iss, aud, exp, iat, ... }

// Returns null instead of throwing
const claimsOrNull = await verifier.verifyOrNull(token);
```

## OIDC Verification

Auto-discovers OIDC configuration from the issuer's `.well-known/openid-configuration`:

```typescript
import { OidcVerifier } from '@geekmidas/auth/oidc';

const oidc = new OidcVerifier({
  issuer: 'https://auth.example.com',
  audience: 'my-client-id',
});

// Verify ID token (fetches JWKS automatically)
const claims = await oidc.verify(token);

// Fetch user profile from userinfo endpoint
const userInfo = await oidc.fetchUserInfo(accessToken);
// userInfo: { sub, name, email, picture, ... }
```

## Hono Middleware

```typescript
import { JwtMiddleware } from '@geekmidas/auth/hono/jwt';

const jwt = new JwtMiddleware({
  config: { secret: process.env.JWT_SECRET },
});

// Require authentication (401 if missing/invalid)
app.use('/api/*', jwt.handler());

// Optional authentication (continues without token)
app.use('/public/*', jwt.optional());
```

## Lambda Authorizer

```typescript
import { JwtAuthorizer } from '@geekmidas/auth/lambda/jwt';

const authorizer = new JwtAuthorizer({
  config: { secret: process.env.JWT_SECRET },
  getContext: (claims) => ({ userId: claims.sub }),
});

// For TOKEN authorizer (Authorization header)
export const tokenHandler = authorizer.tokenHandler();

// For REQUEST authorizer (full request context)
export const requestHandler = authorizer.requestHandler();
```

## Client-Side Usage

### Token Client

```typescript
import { TokenClient, MemoryTokenStorage } from '@geekmidas/auth/client';

const storage = new MemoryTokenStorage();
const client = new TokenClient({
  storage,
  refreshEndpoint: '/api/auth/refresh',
  onTokensRefreshed: (tokens) => {
    console.log('Tokens refreshed');
  },
  onTokenExpired: () => {
    window.location.href = '/login';
  },
});

// Get access token (automatically refreshes if needed)
const accessToken = await client.getAccessToken();

// Check authentication status
const isAuthenticated = await client.isAuthenticated();

// Clear tokens on logout
await client.clearTokens();
```

### Storage Backends

```typescript
// Memory storage (for testing or SSR)
import { MemoryTokenStorage } from '@geekmidas/auth/client';
const storage = new MemoryTokenStorage();

// Cache-based storage
import { CacheTokenStorage } from '@geekmidas/auth/client';
import { InMemoryCache } from '@geekmidas/cache/memory';

const cache = new InMemoryCache<string>();
const storage = new CacheTokenStorage(cache);
```

## Server-Side Usage

### Token Manager

```typescript
import { TokenManager } from '@geekmidas/auth/server';

const tokenManager = new TokenManager({
  accessTokenSecret: process.env.ACCESS_TOKEN_SECRET!,
  refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET!,
  accessTokenExpiresIn: '15m',
  refreshTokenExpiresIn: '7d',
});

// Create tokens for a user
const tokens = await tokenManager.createTokens({
  userId: '123',
  role: 'admin',
});

// Verify access token
const payload = await tokenManager.verifyAccessToken(tokens.accessToken);

// Refresh tokens
const newTokens = await tokenManager.refreshTokens(tokens.refreshToken);
```

## Integration with Endpoints

```typescript
import { e } from '@geekmidas/constructs/endpoints';
import { TokenManager } from '@geekmidas/auth/server';

const tokenManager = new TokenManager({...});

const protectedEndpoint = e
  .get('/protected')
  .getSession(async ({ header }) => {
    const token = header('authorization')?.replace('Bearer ', '');
    if (!token) return null;

    try {
      return await tokenManager.verifyAccessToken(token);
    } catch {
      return null;
    }
  })
  .authorize(({ session }) => session !== null)
  .handle(async ({ session }) => {
    return { userId: session.userId };
  });
```
