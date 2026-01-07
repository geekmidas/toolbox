/**
 * Lazy header and cookie accessors for different adaptors.
 *
 * Instead of parsing all headers/cookies upfront, these accessors
 * use native adaptor methods for single lookups and only parse
 * everything when `header()` or `cookie()` is called without arguments.
 */
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { CookieFn, HeaderFn } from './Endpoint';

/**
 * Create a lazy header accessor for Hono.
 * Uses `c.req.header(name)` for single lookups (native, case-insensitive).
 * Only calls `c.req.header()` to get all headers when needed.
 */
export function createHonoHeaders(c: Context): HeaderFn {
  let allHeaders: Record<string, string> | null = null;

  return ((key?: string) => {
    if (key !== undefined) {
      // Single header lookup - use native Hono method (case-insensitive)
      return c.req.header(key);
    }
    // Get all headers - cache the result
    if (!allHeaders) {
      allHeaders = c.req.header();
    }
    return allHeaders;
  }) as HeaderFn;
}

/**
 * Create a lazy cookie accessor for Hono.
 * Uses `getCookie(c, name)` for single lookups (native).
 * Only parses the cookie header when all cookies are requested.
 */
export function createHonoCookies(c: Context): CookieFn {
  let allCookies: Record<string, string> | null = null;

  return ((name?: string) => {
    if (name !== undefined) {
      // Single cookie lookup - use native Hono method
      return getCookie(c, name);
    }
    // Get all cookies - parse and cache
    if (!allCookies) {
      allCookies = {};
      const cookieHeader = c.req.header('cookie');
      if (cookieHeader) {
        for (const part of cookieHeader.split(';')) {
          const trimmed = part.trim();
          const eqIndex = trimmed.indexOf('=');
          if (eqIndex > 0) {
            const key = trimmed.slice(0, eqIndex);
            const value = trimmed.slice(eqIndex + 1);
            allCookies[key] = value;
          }
        }
      }
    }
    return allCookies;
  }) as CookieFn;
}

/**
 * Create a lazy header accessor for API Gateway events.
 * Handles case-insensitive lookups.
 */
export function createApiGatewayHeaders(
  headers: Record<string, string | undefined> | null | undefined,
): HeaderFn {
  let normalizedHeaders: Record<string, string> | null = null;

  const normalize = () => {
    if (!normalizedHeaders) {
      normalizedHeaders = {};
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          if (v !== undefined) {
            normalizedHeaders[k.toLowerCase()] = v;
          }
        }
      }
    }
    return normalizedHeaders;
  };

  return ((key?: string) => {
    if (key !== undefined) {
      // Try direct lookup first (common case: headers already lowercase)
      if (headers) {
        const direct = headers[key] ?? headers[key.toLowerCase()];
        if (direct !== undefined) return direct;
        // Fall back to normalized lookup
        return normalize()[key.toLowerCase()];
      }
      return undefined;
    }
    return normalize();
  }) as HeaderFn;
}

/**
 * Create a lazy cookie accessor for API Gateway events.
 */
export function createApiGatewayCookies(
  cookies: string[] | undefined,
  cookieHeader: string | undefined,
): CookieFn {
  let parsed: Record<string, string> | null = null;

  const parse = () => {
    if (!parsed) {
      parsed = {};
      // API Gateway v2 provides cookies as array
      if (cookies) {
        for (const cookie of cookies) {
          const eqIndex = cookie.indexOf('=');
          if (eqIndex > 0) {
            const key = cookie.slice(0, eqIndex);
            const value = cookie.slice(eqIndex + 1);
            parsed[key] = value;
          }
        }
      } else if (cookieHeader) {
        // Fall back to parsing cookie header
        for (const part of cookieHeader.split(';')) {
          const trimmed = part.trim();
          const eqIndex = trimmed.indexOf('=');
          if (eqIndex > 0) {
            const key = trimmed.slice(0, eqIndex);
            const value = trimmed.slice(eqIndex + 1);
            parsed[key] = value;
          }
        }
      }
    }
    return parsed;
  };

  return ((name?: string) => {
    if (name !== undefined) {
      return parse()[name];
    }
    return parse();
  }) as CookieFn;
}

/**
 * Create a no-op header accessor (for minimal endpoints that don't use headers).
 */
export function createNoopHeaders(): HeaderFn {
  return ((key?: string) => {
    if (key !== undefined) return undefined;
    return {};
  }) as HeaderFn;
}

/**
 * Create a no-op cookie accessor (for minimal endpoints that don't use cookies).
 */
export function createNoopCookies(): CookieFn {
  return ((name?: string) => {
    if (name !== undefined) return undefined;
    return {};
  }) as CookieFn;
}
