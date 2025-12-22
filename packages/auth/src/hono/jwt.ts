import type { Context, MiddlewareHandler, Next } from 'hono';
import {
  type JwtClaims,
  type JwtConfig,
  JwtVerifier,
  type TokenExtractionOptions,
} from '../jwt';

export {
  JwtVerifier,
  type JwtClaims,
  type JwtConfig,
  type TokenExtractionOptions,
};

function extractToken(
  c: Context,
  options: TokenExtractionOptions = {},
): string | null {
  const {
    headerName = 'authorization',
    cookieName,
    tokenPrefix = 'Bearer ',
  } = options;

  const headerValue = c.req.header(headerName);
  if (headerValue) {
    if (tokenPrefix && headerValue.startsWith(tokenPrefix)) {
      return headerValue.slice(tokenPrefix.length);
    }
    return headerValue;
  }

  if (cookieName) {
    const cookieHeader = c.req.header('cookie');
    if (cookieHeader) {
      const match = cookieHeader.match(new RegExp(`${cookieName}=([^;]+)`));
      if (match) {
        return match[1];
      }
    }
  }

  return null;
}

export interface JwtMiddlewareOptions<TClaims extends JwtClaims = JwtClaims> {
  config: JwtConfig;
  extraction?: TokenExtractionOptions;
  contextKey?: string;
  onError?: (c: Context, error: Error) => Response | Promise<Response>;
  transformClaims?: (claims: JwtClaims) => TClaims;
}

/**
 * JWT Middleware for Hono
 *
 * @example
 * ```typescript
 * const jwt = new JwtMiddleware({
 *   config: { secret: process.env.JWT_SECRET! },
 * });
 *
 * app.use('/api/*', jwt.handler());
 *
 * // Or for optional auth
 * app.use('/public/*', jwt.optional());
 * ```
 */
export class JwtMiddleware<TClaims extends JwtClaims = JwtClaims> {
  private readonly verifier: JwtVerifier<TClaims>;
  private readonly extraction: TokenExtractionOptions;
  private readonly contextKey: string;
  private readonly onError?: (
    c: Context,
    error: Error,
  ) => Response | Promise<Response>;
  private readonly transformClaims?: (claims: JwtClaims) => TClaims;

  constructor(options: JwtMiddlewareOptions<TClaims>) {
    this.verifier = new JwtVerifier(options.config);
    this.extraction = options.extraction ?? {};
    this.contextKey = options.contextKey ?? 'jwtClaims';
    this.onError = options.onError;
    this.transformClaims = options.transformClaims;
  }

  /**
   * Returns middleware that requires valid JWT
   */
  handler(): MiddlewareHandler {
    return async (c: Context, next: Next) => {
      const token = extractToken(c, this.extraction);

      if (!token) {
        if (this.onError) {
          return this.onError(c, new Error('No token provided'));
        }
        return c.json({ error: 'Unauthorized' }, 401);
      }

      try {
        const payload = await this.verifier.verify(token);
        const claims = this.transformClaims
          ? this.transformClaims(payload)
          : payload;

        c.set(this.contextKey, claims);
        c.set('jwtToken', token);

        await next();
      } catch (error) {
        if (this.onError) {
          return this.onError(c, error as Error);
        }
        return c.json({ error: 'Invalid token' }, 401);
      }
    };
  }

  /**
   * Returns middleware that allows unauthenticated requests
   */
  optional(): MiddlewareHandler {
    return async (c: Context, next: Next) => {
      const token = extractToken(c, this.extraction);

      if (token) {
        const claims = await this.verifier.verifyOrNull(token);
        if (claims) {
          const transformed = this.transformClaims
            ? this.transformClaims(claims)
            : claims;
          c.set(this.contextKey, transformed);
          c.set('jwtToken', token);
        }
      }

      await next();
    };
  }
}
