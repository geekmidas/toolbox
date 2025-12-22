import type { Context, MiddlewareHandler, Next } from 'hono';
import {
  type OidcClaims,
  type OidcConfig,
  type OidcUserInfo,
  OidcVerifier,
  type TokenExtractionOptions,
} from '../oidc';

export {
  OidcVerifier,
  type OidcClaims,
  type OidcConfig,
  type OidcUserInfo,
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

export interface OidcMiddlewareOptions<
  TClaims extends OidcClaims = OidcClaims,
  TUserInfo extends OidcUserInfo = OidcUserInfo,
> {
  config: OidcConfig;
  extraction?: TokenExtractionOptions;
  contextKey?: string;
  fetchUserInfo?: boolean;
  onError?: (c: Context, error: Error) => Response | Promise<Response>;
  transformClaims?: (claims: OidcClaims, userInfo?: TUserInfo) => TClaims;
}

/**
 * OIDC Middleware for Hono
 *
 * @example
 * ```typescript
 * const oidc = new OidcMiddleware({
 *   config: {
 *     issuer: 'https://auth.example.com',
 *     audience: 'my-client-id',
 *   },
 * });
 *
 * app.use('/api/*', oidc.handler());
 *
 * // With user info
 * const oidcWithUserInfo = new OidcMiddleware({
 *   config: { issuer: '...', audience: '...' },
 *   fetchUserInfo: true,
 * });
 * ```
 */
export class OidcMiddleware<
  TClaims extends OidcClaims = OidcClaims,
  TUserInfo extends OidcUserInfo = OidcUserInfo,
> {
  private readonly verifier: OidcVerifier<TClaims, TUserInfo>;
  private readonly extraction: TokenExtractionOptions;
  private readonly contextKey: string;
  private readonly fetchUserInfo: boolean;
  private readonly onError?: (
    c: Context,
    error: Error,
  ) => Response | Promise<Response>;
  private readonly transformClaims?: (
    claims: OidcClaims,
    userInfo?: TUserInfo,
  ) => TClaims;

  constructor(options: OidcMiddlewareOptions<TClaims, TUserInfo>) {
    this.verifier = new OidcVerifier(options.config);
    this.extraction = options.extraction ?? {};
    this.contextKey = options.contextKey ?? 'oidcClaims';
    this.fetchUserInfo = options.fetchUserInfo ?? false;
    this.onError = options.onError;
    this.transformClaims = options.transformClaims;
  }

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

        let userInfo: TUserInfo | undefined;
        if (this.fetchUserInfo) {
          userInfo = (await this.verifier.fetchUserInfo(token)) ?? undefined;
          c.set('oidcUserInfo', userInfo);
        }

        const claims = this.transformClaims
          ? this.transformClaims(payload, userInfo)
          : payload;

        c.set(this.contextKey, claims);
        c.set('oidcToken', token);

        await next();
      } catch (error) {
        if (this.onError) {
          return this.onError(c, error as Error);
        }
        return c.json({ error: 'Invalid token' }, 401);
      }
    };
  }

  optional(): MiddlewareHandler {
    return async (c: Context, next: Next) => {
      const token = extractToken(c, this.extraction);

      if (token) {
        const payload = await this.verifier.verifyOrNull(token);
        if (payload) {
          let userInfo: TUserInfo | undefined;
          if (this.fetchUserInfo) {
            userInfo = (await this.verifier.fetchUserInfo(token)) ?? undefined;
            c.set('oidcUserInfo', userInfo);
          }

          const claims = this.transformClaims
            ? this.transformClaims(payload, userInfo)
            : payload;

          c.set(this.contextKey, claims);
          c.set('oidcToken', token);
        }
      }

      await next();
    };
  }
}
