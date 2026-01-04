/**
 * OpenTelemetry instrumentation middleware for Hono
 *
 * This middleware automatically creates spans for HTTP requests,
 * extracts trace context from incoming headers, and records
 * request/response metadata as span attributes.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { context, trace, type Span } from '@opentelemetry/api';
import {
  createHttpServerSpan,
  endHttpSpan,
  extractTraceContext,
  type HttpSpanAttributes,
} from './http';

/**
 * Options for the Hono telemetry middleware
 */
export interface HonoTelemetryMiddlewareOptions {
  /**
   * Whether to record request body as span attribute
   * @default false
   */
  recordBody?: boolean;

  /**
   * Whether to record response body as span attribute
   * @default false
   */
  recordResponseBody?: boolean;

  /**
   * Custom function to extract user ID from context
   */
  getUserId?: (c: Context) => string | undefined;

  /**
   * Paths to skip tracing (supports wildcards)
   */
  ignorePaths?: string[];

  /**
   * Whether to skip tracing for this request
   */
  shouldSkip?: (c: Context) => boolean;
}

// Key for storing span on context
const SPAN_KEY = 'telemetry.span';
const CONTEXT_KEY = 'telemetry.context';

/**
 * Get the current span from Hono context
 */
export function getSpanFromContext(c: Context): Span | undefined {
  return c.get(SPAN_KEY);
}

/**
 * Get the current trace context from Hono context
 */
export function getTraceContextFromHono(c: Context): any {
  return c.get(CONTEXT_KEY);
}

/**
 * Create a telemetry middleware for Hono applications
 *
 * @example
 * ```typescript
 * import { honoTelemetryMiddleware } from '@geekmidas/telescope/instrumentation';
 *
 * const app = new Hono();
 * app.use('*', honoTelemetryMiddleware());
 * ```
 */
export function honoTelemetryMiddleware(
  options: HonoTelemetryMiddlewareOptions = {},
): MiddlewareHandler {
  return async (c, next) => {
    // Check if path should be ignored
    if (options.ignorePaths && shouldIgnorePath(c.req.path, options.ignorePaths)) {
      return next();
    }

    // Skip if custom skip function returns true
    if (options.shouldSkip?.(c)) {
      return next();
    }

    // Extract trace context from headers
    const headers: Record<string, string | string[] | undefined> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const parentContext = extractTraceContext(headers);

    // Build span attributes from request
    const attrs = buildHonoSpanAttributes(c, options);

    // Create the span
    const span = createHttpServerSpan(attrs, parentContext);
    const spanContext = trace.setSpan(parentContext, span);

    // Store span and context on Hono context
    c.set(SPAN_KEY, span);
    c.set(CONTEXT_KEY, spanContext);

    // Record body if requested
    if (options.recordBody) {
      try {
        const body = await c.req.text();
        if (body) {
          span.setAttribute(
            'http.request.body',
            body.length > 4096 ? `${body.slice(0, 4096)}...` : body,
          );
        }
      } catch {
        // Body may have already been consumed
      }
    }

    try {
      // Execute the rest of the middleware chain within span context
      await context.with(spanContext, async () => {
        await next();
      });

      // Record response
      const statusCode = c.res.status;

      if (options.recordResponseBody) {
        try {
          const body = await c.res.clone().text();
          if (body) {
            span.setAttribute(
              'http.response.body',
              body.length > 4096 ? `${body.slice(0, 4096)}...` : body,
            );
          }
        } catch {
          // Response body may not be available
        }
      }

      endHttpSpan(span, { statusCode });
    } catch (error) {
      endHttpSpan(
        span,
        { statusCode: 500 },
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  };
}

/**
 * Build span attributes from Hono context
 */
function buildHonoSpanAttributes(
  c: Context,
  options: HonoTelemetryMiddlewareOptions,
): HttpSpanAttributes {
  const req = c.req;
  const url = new URL(req.url);

  // Use actual path for route unless it's a specific route pattern
  const routePath = c.req.routePath;
  const route = routePath && routePath !== '*' && !routePath.includes('/*')
    ? routePath
    : url.pathname;

  const attrs: HttpSpanAttributes = {
    method: req.method,
    url: req.url,
    path: url.pathname,
    route,
    host: url.host,
    scheme: url.protocol.replace(':', '') as 'http' | 'https',
    userAgent: req.header('user-agent'),
    clientIp: getClientIp(c),
    requestId: req.header('x-request-id') || req.header('x-amzn-requestid'),
  };

  // Add user metadata if extractor provided
  if (options.getUserId) {
    const userId = options.getUserId(c);
    if (userId) {
      attrs.user = { userId };
    }
  }

  return attrs;
}

/**
 * Extract client IP from Hono context
 */
function getClientIp(c: Context): string | undefined {
  // Try various headers in order of preference
  const xForwardedFor = c.req.header('x-forwarded-for');
  if (xForwardedFor) {
    const first = xForwardedFor.split(',')[0];
    return first?.trim();
  }

  const xRealIp = c.req.header('x-real-ip');
  if (xRealIp) {
    return xRealIp;
  }

  // Try CF-Connecting-IP (Cloudflare)
  const cfConnectingIp = c.req.header('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  return undefined;
}

/**
 * Check if path should be ignored
 */
function shouldIgnorePath(path: string, ignorePaths: string[]): boolean {
  for (const pattern of ignorePaths) {
    if (pattern.endsWith('*')) {
      // Wildcard match
      const prefix = pattern.slice(0, -1);
      if (path.startsWith(prefix)) {
        return true;
      }
    } else if (path === pattern) {
      // Exact match
      return true;
    }
  }
  return false;
}

/**
 * Run a function within the span context from Hono context
 *
 * @example
 * ```typescript
 * app.get('/api/users', async (c) => {
 *   return withHonoSpanContext(c, async () => {
 *     // Any spans created here will be children of the request span
 *     const users = await fetchUsers();
 *     return c.json(users);
 *   });
 * });
 * ```
 */
export async function withHonoSpanContext<T>(
  c: Context,
  fn: () => Promise<T>,
): Promise<T> {
  const ctx = getTraceContextFromHono(c);
  if (!ctx) {
    return fn();
  }
  return context.with(ctx, fn);
}
