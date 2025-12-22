# @geekmidas/auth

A comprehensive authentication library providing JWT and OIDC token verification, Hono middleware, AWS Lambda authorizers, and client-side token management for TypeScript applications.

## Features

- **JWT Verification**: Verify tokens using secrets or JWKS endpoints
- **OIDC Support**: Auto-discovery from `.well-known/openid-configuration`
- **Hono Middleware**: Ready-to-use middleware for Hono applications
- **Lambda Authorizers**: TOKEN and REQUEST authorizers for AWS API Gateway
- **Token Management**: Client-side token storage and automatic refresh
- **Type-Safe**: Full TypeScript support with generic claims types
- **Multiple Storage Options**: LocalStorage, Memory, and Cache-based token storage

## Installation

```bash
pnpm add @geekmidas/auth
```

## Package Exports

The package provides multiple entry points for different use cases:

- `@geekmidas/auth/jwt` - JWT verification
- `@geekmidas/auth/oidc` - OIDC verification with auto-discovery
- `@geekmidas/auth/hono/jwt` - Hono JWT middleware
- `@geekmidas/auth/hono/oidc` - Hono OIDC middleware
- `@geekmidas/auth/lambda/jwt` - Lambda JWT authorizer
- `@geekmidas/auth/lambda/oidc` - Lambda OIDC authorizer
- `@geekmidas/auth/client` - Client-side token management
- `@geekmidas/auth/server` - Server-side token management

## JWT Verification

### Basic Usage

```typescript
import { JwtVerifier } from '@geekmidas/auth/jwt';
import { EnvironmentParser } from '@geekmidas/envkit';

// Parse environment configuration
const env = new EnvironmentParser(process.env)
  .create((get) => ({
    jwt: {
      secret: get('JWT_SECRET').string(),
      issuer: get('JWT_ISSUER').string().optional(),
      audience: get('JWT_AUDIENCE').string().optional(),
    },
  }))
  .parse();

// With secret (HS256)
const verifier = new JwtVerifier({
  secret: env.jwt.secret,
  issuer: env.jwt.issuer,
  audience: env.jwt.audience,
});

const claims = await verifier.verify(token);
console.log('User:', claims.sub);

// Returns null instead of throwing for invalid tokens
const claimsOrNull = await verifier.verifyOrNull(token);
```

### With JWKS (RS256, ES256, etc.)

```typescript
import { JwtVerifier } from '@geekmidas/auth/jwt';

const verifier = new JwtVerifier({
  jwksUri: 'https://auth.example.com/.well-known/jwks.json',
  issuer: 'https://auth.example.com',
  audience: 'my-api',
});

const claims = await verifier.verify(token);
```

### Custom Claims Type

```typescript
interface MyClaims {
  sub: string;
  role: string;
  permissions: string[];
}

const verifier = new JwtVerifier<MyClaims>({
  secret: env.jwt.secret, // From envkit parser
});

const claims = await verifier.verify(token);
console.log('Role:', claims.role); // Typed!
```

### Decode Without Verification

```typescript
import { decodeJwt } from '@geekmidas/auth/jwt';

// Decode token without verification (useful for debugging)
const claims = decodeJwt(token);
```

## OIDC Verification

OIDC verifier automatically discovers JWKS URI and other configuration from the issuer's `.well-known/openid-configuration` endpoint.

```typescript
import { OidcVerifier } from '@geekmidas/auth/oidc';

const verifier = new OidcVerifier({
  issuer: 'https://auth.example.com',
  audience: 'my-client-id',
});

// Verify token (auto-discovers JWKS)
const claims = await verifier.verify(token);

// Fetch user info from userinfo endpoint
const userInfo = await verifier.fetchUserInfo(token);
console.log('Email:', userInfo?.email);

// Get discovery document
const discovery = await verifier.getDiscovery();
console.log('Token endpoint:', discovery.token_endpoint);
```

## Hono Middleware

### JWT Middleware

```typescript
import { Hono } from 'hono';
import { JwtMiddleware } from '@geekmidas/auth/hono/jwt';

const app = new Hono();

const jwt = new JwtMiddleware({
  config: {
    secret: env.jwt.secret,
    issuer: env.jwt.issuer,
  },
  contextKey: 'jwtClaims', // Where to store claims in context
});

// Protected routes
app.use('/api/*', jwt.handler());

app.get('/api/profile', (c) => {
  const claims = c.get('jwtClaims');
  return c.json({ userId: claims.sub });
});

// Optional authentication (doesn't fail if no token)
app.use('/public/*', jwt.optional());

app.get('/public/posts', (c) => {
  const claims = c.get('jwtClaims'); // May be undefined
  return c.json({ authenticated: !!claims });
});
```

### OIDC Middleware

```typescript
import { OidcMiddleware } from '@geekmidas/auth/hono/oidc';

const oidc = new OidcMiddleware({
  config: {
    issuer: 'https://auth.example.com',
    audience: 'my-client-id',
  },
  fetchUserInfo: true, // Also fetch user info
});

app.use('/api/*', oidc.handler());

app.get('/api/profile', (c) => {
  const claims = c.get('oidcClaims');
  const userInfo = c.get('oidcUserInfo');
  return c.json({ sub: claims.sub, email: userInfo?.email });
});
```

### Custom Error Handling

```typescript
const jwt = new JwtMiddleware({
  config: { secret: env.jwt.secret },
  onError: (c, error) => {
    console.error('Auth error:', error.message);
    return c.json({ error: 'Authentication failed' }, 401);
  },
});
```

### Token Extraction Options

```typescript
const jwt = new JwtMiddleware({
  config: { secret: env.jwt.secret },
  extraction: {
    headerName: 'x-auth-token', // Custom header (default: 'authorization')
    tokenPrefix: 'Token ',      // Custom prefix (default: 'Bearer ')
    cookieName: 'auth_token',   // Also check cookies
  },
});
```

## Lambda Authorizers

### JWT Authorizer

```typescript
import { JwtAuthorizer } from '@geekmidas/auth/lambda/jwt';

const authorizer = new JwtAuthorizer({
  config: {
    secret: env.jwt.secret,
    issuer: env.jwt.issuer,
  },
  // Extract principal ID from claims
  getPrincipalId: (claims) => claims.sub ?? 'unknown',
  // Add claims to request context
  getContext: (claims) => ({
    userId: claims.sub!,
    role: claims.role,
  }),
  // Custom authorization logic
  authorize: async (claims) => {
    return claims.role === 'admin';
  },
});

// For TOKEN authorizers (API Gateway v1)
export const tokenHandler = authorizer.tokenHandler();

// For REQUEST authorizers (API Gateway v1/v2)
export const requestHandler = authorizer.requestHandler();
```

### OIDC Authorizer

```typescript
import { OidcAuthorizer } from '@geekmidas/auth/lambda/oidc';

const authorizer = new OidcAuthorizer({
  config: {
    issuer: 'https://auth.example.com',
    audience: 'my-api',
  },
  getContext: (claims) => ({
    userId: claims.sub!,
    email: claims.email,
  }),
});

export const handler = authorizer.requestHandler();
```

### Token Extraction for REQUEST Authorizers

```typescript
const authorizer = new JwtAuthorizer({
  config: { secret: env.jwt.secret },
  extraction: {
    headerName: 'authorization',
    tokenPrefix: 'Bearer ',
    cookieName: 'auth_token', // Also check cookies
  },
  // Use specific resource ARN vs wildcard
  wildcardResource: true, // Default: true (enables caching)
});
```

## Client-Side Token Management

### Basic Token Client

```typescript
import { TokenClient, LocalStorageTokenStorage } from '@geekmidas/auth/client';

const client = new TokenClient({
  storage: new LocalStorageTokenStorage(),
  refreshEndpoint: '/api/auth/refresh',
  onTokenRefresh: (tokens) => {
    console.log('Tokens refreshed');
  },
  onTokenExpired: () => {
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
const storage = new CacheTokenStorage(cache);

// Supports TTL for automatic expiration
await storage.setAccessToken('token', 3600); // 1 hour TTL
```

## Server-Side Token Management

### Token Manager

```typescript
import { TokenManager } from '@geekmidas/auth/server';
import { EnvironmentParser } from '@geekmidas/envkit';

const env = new EnvironmentParser(process.env)
  .create((get) => ({
    auth: {
      accessTokenSecret: get('ACCESS_TOKEN_SECRET').string(),
      refreshTokenSecret: get('REFRESH_TOKEN_SECRET').string(),
    },
  }))
  .parse();

const tokenManager = new TokenManager({
  accessTokenSecret: env.auth.accessTokenSecret,
  refreshTokenSecret: env.auth.refreshTokenSecret,
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
const payload = tokenManager.verifyAccessToken(accessToken);

// Refresh access token
const newAccessToken = tokenManager.refreshAccessToken(refreshToken);
```

## API Reference

### JwtVerifier

```typescript
class JwtVerifier<TClaims extends JwtClaims = JwtClaims> {
  constructor(config: JwtConfig);
  verify(token: string): Promise<TClaims>;
  verifyOrNull(token: string): Promise<TClaims | null>;
  clearCache(): void;
}

interface JwtConfig {
  secret?: string;           // For HS256
  jwksUri?: string;          // For RS256, ES256, etc.
  issuer?: string;           // Expected issuer
  audience?: string;         // Expected audience
  algorithms?: string[];     // Allowed algorithms
}
```

### OidcVerifier

```typescript
class OidcVerifier<TClaims, TUserInfo> {
  constructor(config: OidcConfig);
  verify(token: string): Promise<TClaims>;
  verifyOrNull(token: string): Promise<TClaims | null>;
  fetchUserInfo(token: string): Promise<TUserInfo | null>;
  getDiscovery(): Promise<OidcDiscovery>;
  clearCache(): void;
}

interface OidcConfig {
  issuer: string;            // OIDC issuer URL
  audience?: string;         // Expected audience
  algorithms?: string[];     // Allowed algorithms
}
```

### JwtMiddleware / OidcMiddleware

```typescript
class JwtMiddleware<TClaims> {
  constructor(options: JwtMiddlewareOptions<TClaims>);
  handler(): MiddlewareHandler;   // Required auth
  optional(): MiddlewareHandler;  // Optional auth
}

interface JwtMiddlewareOptions<TClaims> {
  config: JwtConfig;
  extraction?: TokenExtractionOptions;
  contextKey?: string;
  onError?: (c: Context, error: Error) => Response;
  transformClaims?: (claims: JwtClaims) => TClaims;
}
```

### JwtAuthorizer / OidcAuthorizer

```typescript
class JwtAuthorizer<TClaims> {
  constructor(options: JwtAuthorizerOptions<TClaims>);
  tokenHandler(): Handler;    // TOKEN authorizer
  requestHandler(): Handler;  // REQUEST authorizer
}

interface JwtAuthorizerOptions<TClaims> {
  config: JwtConfig;
  extraction?: TokenExtractionOptions;
  wildcardResource?: boolean;
  getPrincipalId?: (claims: TClaims) => string;
  getContext?: (claims: TClaims) => Record<string, string | number | boolean>;
  authorize?: (claims: TClaims) => boolean | Promise<boolean>;
}
```

### TokenExtractionOptions

```typescript
interface TokenExtractionOptions {
  headerName?: string;   // Default: 'authorization'
  tokenPrefix?: string;  // Default: 'Bearer '
  cookieName?: string;   // Optional cookie fallback
}
```

## Security Best Practices

1. **Use Strong Secrets**: Ensure your JWT secrets are cryptographically secure.

2. **Short Access Token Expiration**: Keep access tokens short-lived (15 minutes recommended).

3. **Use JWKS for Production**: Prefer JWKS over shared secrets for better key rotation.

4. **Validate Claims**: Always validate issuer and audience claims.

5. **HTTPS Only**: Always use HTTPS in production to prevent token interception.

6. **Token Rotation**: Implement refresh token rotation for enhanced security.

## Dependencies

- `jose` - JWT/JWS/JWE operations
- `@geekmidas/cache` - Cache storage support (optional)
- `hono` - Hono framework (peer dependency for middleware)
- `@types/aws-lambda` - AWS Lambda types (peer dependency for authorizers)

## License

MIT License - see the LICENSE file for details.
