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

- `/` - Core interfaces and types
- `/server` - Server-side token management
- `/client` - Client-side token management

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
