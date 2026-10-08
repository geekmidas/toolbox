import { context, type Span, trace } from '@opentelemetry/api';
/**
 * OpenTelemetry instrumentation middleware for Hono
 *
 * This middleware automatically creates spans for HTTP requests,
 * extracts trace context from incoming headers, and records
 * request/response metadata as span attributes.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import {
	createHttpServerSpan,
	endHttpSpan,
	type HttpSpanAttributes,
	incomingTraceContext,
} from './http';
import { isInternalCaller, isTrustedOrigin } from './trust';

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

	/**
	 * The origins whose `traceparent` is continued: the API's own sites, the
	 * same list its CORS allows. A request from any other origin starts a new
	 * trace linked to the one it claimed.
	 *
	 * A function is read on each request, for a server that learns its origins
	 * only once the app has loaded its configuration.
	 */
	trustedOrigins?: readonly string[] | (() => readonly string[] | undefined);

	/**
	 * Whether a request with no `Origin` from an internal caller continues its
	 * `traceparent` — another service on the private network (see `./trust`):
	 * no `Origin`, no proxy's forwarding header, and a loopback or private
	 * peer address, read from `@hono/node-server`'s socket.
	 *
	 * `false` trusts no caller without an origin; a function decides itself.
	 * @default true
	 */
	internalCallers?: boolean | ((c: Context) => boolean);
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
		if (
			options.ignorePaths &&
			shouldIgnorePath(c.req.path, options.ignorePaths)
		) {
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
		// Continued only from a trusted caller; anyone else gets a new trace
		// that links to the one they claimed.
		const { parent: parentContext, links } = incomingTraceContext(
			headers,
			isTrustedCaller(c, options),
		);

		// Build span attributes from request
		const attrs = buildHonoSpanAttributes(c, options);

		// Create the span
		const span = createHttpServerSpan(attrs, parentContext, links);
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
			// Execute the rest of the middleware chain within span context, so
			// the handler's logs and outbound spans nest under this one.
			await context.with(spanContext, async () => {
				await next();
			});

			nameAfterRoute(c, span);

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

			// Hono hands a thrown error to `onError` and sets `c.error`
			// rather than rethrowing, so that is where it is found.
			endHttpSpan(span, { statusCode }, c.error);
		} catch (error) {
			nameAfterRoute(c, span);
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
 * Whether this request's `traceparent` is continued: from one of the API's
 * own origins, or from an internal caller.
 */
function isTrustedCaller(
	c: Context,
	options: HonoTelemetryMiddlewareOptions,
): boolean {
	const origin = c.req.header('origin');
	if (origin) {
		const trusted =
			typeof options.trustedOrigins === 'function'
				? options.trustedOrigins()
				: options.trustedOrigins;
		return isTrustedOrigin(origin, trusted);
	}

	const internal = options.internalCallers ?? true;
	if (typeof internal === 'function') return internal(c);
	if (!internal) return false;
	return isInternalCaller({
		headers: c.req.raw.headers,
		remoteAddress: remoteAddressOf(c),
	});
}

/** The TCP peer's address under `@hono/node-server`, or undefined. */
function remoteAddressOf(c: Context): string | undefined {
	const env = c.env as
		| { incoming?: { socket?: { remoteAddress?: string } } }
		| undefined;
	return env?.incoming?.socket?.remoteAddress;
}

/**
 * The route the request matched, once the handler has run — `/users/:id`,
 * never `/users/42` — or undefined when only middleware ran (a 404).
 *
 * Read after `next()`: before it, the route is this middleware's own `*`.
 */
function matchedRoute(c: Context): string | undefined {
	const path = routePath(c);
	return path && !path.includes('*') ? path : undefined;
}

/** `GET /users/:id`, or the bare method when no route matched. */
function nameAfterRoute(c: Context, span: Span): void {
	const route = matchedRoute(c);
	if (route) {
		span.setAttribute('http.route', route);
		span.updateName(`${c.req.method} ${route}`);
	} else {
		span.updateName(c.req.method);
	}
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

	// No `url.full`: a query string can carry a token, and the span would
	// keep it. The route is named once the handler has run.
	const attrs: HttpSpanAttributes = {
		method: req.method,
		path: url.pathname,
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
