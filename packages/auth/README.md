# @geekmidas/auth

A comprehensive authentication library providing JWT token management, secure storage, and client-side token handling for TypeScript applications.

## Features

- **JWT Token Management**: Generate, verify, and refresh JWT access and refresh tokens
- **Multiple Storage Options**: LocalStorage, Memory, and Cache-based token storage
- **Automatic Token Refresh**: Seamless token refresh with expiration handling
- **Type-Safe**: Full TypeScript support with complete type inference
- **Framework Agnostic**: Works with any JavaScript framework or vanilla JS
- **OpenAuth Integration**: Built on top of @openauthjs/openauth for standards compliance

## Installation

```bash
pnpm add @geekmidas/auth
```

## Package Exports

The package provides multiple entry points for different use cases:

- `@geekmidas/auth` - Main client-side exports
- `@geekmidas/auth/client` - Client-side token management
- `@geekmidas/auth/server` - Server-side token management

## Client-Side Usage

### Basic Token Client

```typescript
import { TokenClient, LocalStorageTokenStorage } from '@geekmidas/auth/client';

// Create a token client with localStorage
const client = new TokenClient({
  storage: new LocalStorageTokenStorage(),
  refreshEndpoint: '/api/auth/refresh',
  onTokenRefresh: (tokens) => {
    console.log('Tokens refreshed:', tokens);
  },
  onTokenExpired: () => {
    console.log('Tokens expired, redirect to login');
    window.location.href = '/login';
  },
});

// Store tokens after login
await client.setTokens('access_token', 'refresh_token');

// Get a valid access token (automatically refreshes if expired)
const accessToken = await client.getValidAccessToken();

// Create authorization headers
const headers = await client.createValidAuthHeaders();
// Returns: { Authorization: 'Bearer access_token' }
```

### Token Storage Options

#### LocalStorage (Browser)

```typescript
import { LocalStorageTokenStorage } from '@geekmidas/auth/client';

const storage = new LocalStorageTokenStorage(
  'my_access_token',  // Custom access token key
  'my_refresh_token'  // Custom refresh token key
);
```

#### Memory Storage

```typescript
import { MemoryTokenStorage } from '@geekmidas/auth/client';

// Ideal for server-side applications or testing
const storage = new MemoryTokenStorage();
```

#### Cache Storage

```typescript
import { CacheTokenStorage } from '@geekmidas/auth/client';
import { InMemoryCache } from '@geekmidas/cache/memory';

const cache = new InMemoryCache<string>();
const storage = new CacheTokenStorage(
  cache,
  'access_token',  // Access token key
  'refresh_token'  // Refresh token key
);

// Supports TTL for automatic expiration
await storage.setAccessToken('token', 3600); // 1 hour TTL
```

### Token Validation

```typescript
// Check if a token is expired
const isExpired = client.isTokenExpired(token);

// Get token expiration date
const expiration = client.getTokenExpiration(token);
console.log('Token expires at:', expiration);

// Get a valid token (refreshes automatically if needed)
const validToken = await client.getValidAccessToken();
```

### HTTP Client Integration

```typescript
import { TokenClient } from '@geekmidas/auth/client';

class ApiClient {
  constructor(private tokenClient: TokenClient) {}

  async makeRequest(url: string, options: RequestInit = {}) {
    const headers = await this.tokenClient.createValidAuthHeaders();
    
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        ...headers,
      },
    });
  }
}

const apiClient = new ApiClient(tokenClient);
const response = await apiClient.makeRequest('/api/users');
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

// Generate token pair
const tokens = tokenManager.generateTokenPair({
  userId: 'user123',
  email: 'user@example.com',
  role: 'admin',
});

// Verify tokens
try {
  const payload = tokenManager.verifyAccessToken(accessToken);
  console.log('User ID:', payload.userId);
} catch (error) {
  console.error('Invalid token:', error.message);
}

// Refresh access token
try {
  const newAccessToken = tokenManager.refreshAccessToken(refreshToken);
} catch (error) {
  console.error('Refresh failed:', error.message);
}
```

### Token Validation Middleware

```typescript
import { TokenManager } from '@geekmidas/auth/server';

const tokenManager = new TokenManager({
  accessTokenSecret: process.env.ACCESS_TOKEN_SECRET!,
  refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET!,
});

function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const payload = tokenManager.verifyAccessToken(token);
    req.user = payload;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}
```

## API Reference

### TokenClient

The main client for managing tokens on the client-side.

#### Constructor Options

```typescript
interface TokenClientOptions {
  storage?: TokenStorage;           // Token storage implementation
  refreshEndpoint?: string;         // API endpoint for token refresh
  onTokenRefresh?: (tokens: {       // Callback on successful refresh
    accessToken: string;
    refreshToken?: string;
  }) => void;
  onTokenExpired?: () => void;      // Callback when tokens expire
}
```

#### Methods

- `getAccessToken(): Promise<string | null>` - Get stored access token
- `getRefreshToken(): Promise<string | null>` - Get stored refresh token
- `setTokens(accessToken, refreshToken?, accessTtl?, refreshTtl?): Promise<void>` - Store tokens
- `clearTokens(): Promise<void>` - Clear all stored tokens
- `isTokenExpired(token: string): boolean` - Check if token is expired
- `getTokenExpiration(token: string): Date | null` - Get token expiration date
- `refreshTokens(): Promise<boolean>` - Refresh tokens via API
- `getValidAccessToken(): Promise<string | null>` - Get valid token (auto-refresh)
- `createAuthHeaders(): Promise<Record<string, string>>` - Create auth headers
- `createValidAuthHeaders(): Promise<Record<string, string>>` - Create auth headers with valid token

### TokenStorage Interface

```typescript
interface TokenStorage {
  getAccessToken(): Promise<string | null> | string | null;
  setAccessToken(token: string, ttl?: number): Promise<void> | void;
  getRefreshToken(): Promise<string | null> | string | null;
  setRefreshToken(token: string, ttl?: number): Promise<void> | void;
  clearTokens(): Promise<void> | void;
}
```

### TokenManager

Server-side JWT token management.

#### Constructor Options

```typescript
interface TokenManagerOptions {
  accessTokenSecret: string;        // Secret for signing access tokens
  refreshTokenSecret: string;       // Secret for signing refresh tokens
  accessTokenExpiresIn?: string;    // Access token expiration (default: '15m')
  refreshTokenExpiresIn?: string;   // Refresh token expiration (default: '7d')
}
```

#### Methods

- `generateTokenPair(payload: TokenPayload): TokenPair` - Generate access and refresh tokens
- `verifyAccessToken(token: string): DecodedToken` - Verify and decode access token
- `verifyRefreshToken(token: string): DecodedToken` - Verify and decode refresh token
- `refreshAccessToken(refreshToken: string): string` - Generate new access token from refresh token
- `decodeToken(token: string): DecodedToken | null` - Decode token without verification
- `isTokenExpired(token: string): boolean` - Check if token is expired
- `getTokenExpiration(token: string): Date | null` - Get token expiration date

### Types

```typescript
interface TokenPayload {
  userId: string;
  email?: string;
  [key: string]: any;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface DecodedToken extends TokenPayload {
  iat: number;  // Issued at
  exp: number;  // Expiration time
}
```

## Error Handling

The library provides descriptive error messages for common scenarios:

```typescript
try {
  const payload = tokenManager.verifyAccessToken(token);
} catch (error) {
  if (error.message.includes('Invalid access token')) {
    // Handle invalid token
  } else if (error.message.includes('expired')) {
    // Handle expired token
  }
}
```

## Security Best Practices

1. **Use Strong Secrets**: Ensure your JWT secrets are cryptographically secure and different for access and refresh tokens.

2. **Short Access Token Expiration**: Keep access tokens short-lived (15 minutes recommended).

3. **Secure Token Storage**: Use appropriate storage based on your environment:
   - Browser: LocalStorage or secure cookies
   - Server: Memory or secure cache
   - Mobile: Secure keychain/keystore

4. **HTTPS Only**: Always use HTTPS in production to prevent token interception.

5. **Token Rotation**: Implement refresh token rotation for enhanced security.

## Testing

The package includes comprehensive test utilities:

```typescript
import { MemoryTokenStorage, TokenClient } from '@geekmidas/auth/client';

// Use memory storage for tests
const storage = new MemoryTokenStorage();
const client = new TokenClient({ storage });

// Mock refresh endpoint with MSW
import { http, HttpResponse } from 'msw';

const server = setupServer(
  http.post('/auth/refresh', () => {
    return HttpResponse.json({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    });
  }),
);
```

## Migration Guide

### From v0.0.x

The auth package is currently in initial development. Breaking changes may occur between minor versions until v1.0.0.

## Dependencies

- `@openauthjs/openauth` - OpenAuth integration
- `@geekmidas/cache` - Cache storage support  
- `jsonwebtoken` - JWT token operations
- `@types/ms` - Time duration types

## License

MIT License - see the LICENSE file for details.