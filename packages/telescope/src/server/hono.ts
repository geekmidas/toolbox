import type { Context, MiddlewareHandler, Next } from 'hono';
import { Hono } from 'hono';
import type {
	HonoAdapterConfig,
	TelescopeHonoContext,
} from '../adapters/types';
import { flushTelemetry } from '../instrumentation/core';
import type { Telescope } from '../Telescope';
import type { MetricsQueryOptions, QueryOptions } from '../types';
import { getAsset, getIndexHtml } from '../ui-assets';

const CONTEXT_KEY = 'telescope-context';

/** Default Hono adapter configuration */
const _DEFAULT_CONFIG: HonoAdapterConfig = {
	environment: 'server',
};

/**
 * Options for the Telescope Hono middleware
 */
export interface TelescopeMiddlewareOptions {
	/**
	 * Whether to flush telemetry after each request.
	 * Enable this for serverless environments (Lambda, Edge).
	 * @default false
	 */
	flushOnResponse?: boolean;
}

/**
 * Create Hono middleware that captures requests and responses
 */
export function createMiddleware(
	telescope: Telescope,
	options: TelescopeMiddlewareOptions = {},
): MiddlewareHandler {
	const { flushOnResponse = false } = options;

	return async (c: Context, next: Next) => {
		if (!telescope.enabled) {
			return next();
		}

		if (telescope.shouldIgnore(c.req.path)) {
			return next();
		}

		const startTime = performance.now();

		// Capture request data
		const headers: Record<string, string> = {};
		c.req.raw.headers.forEach((value, key) => {
			headers[key] = value;
		});

		const url = new URL(c.req.url);
		const query: Record<string, string> = {};
		url.searchParams.forEach((value, key) => {
			query[key] = value;
		});

		let body: unknown;
		if (
			telescope.recordBody &&
			['POST', 'PUT', 'PATCH'].includes(c.req.method)
		) {
			try {
				const contentType = c.req.header('content-type') || '';
				// Clone the request to avoid consuming the body stream
				const clonedRequest = c.req.raw.clone();
				if (contentType.includes('application/json')) {
					body = await clonedRequest.json();
				} else if (contentType.includes('application/x-www-form-urlencoded')) {
					body = Object.fromEntries((await clonedRequest.formData()).entries());
				} else if (contentType.includes('text/')) {
					body = await clonedRequest.text();
				}
			} catch {
				// Ignore body parsing errors
			}
		}

		const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');

		try {
			await next();

			// Capture response data
			const duration = performance.now() - startTime;

			const responseHeaders: Record<string, string> = {};
			c.res.headers.forEach((value, key) => {
				responseHeaders[key] = value;
			});

			let responseBody: unknown;
			if (telescope.recordBody) {
				try {
					const contentType = c.res.headers.get('content-type') || '';
					if (contentType.includes('application/json')) {
						const cloned = c.res.clone();
						responseBody = await cloned.json();
					}
				} catch {
					// Ignore body parsing errors
				}
			}

			const requestId = await telescope.recordRequest({
				method: c.req.method,
				path: c.req.path,
				url: c.req.url,
				headers,
				body,
				query,
				status: c.res.status,
				responseHeaders,
				responseBody,
				duration,
				ip,
			});

			// Store context for access by other middleware
			const ctx: TelescopeHonoContext = {
				requestId,
				startTime,
			};
			c.set(CONTEXT_KEY, ctx);

			// Flush telemetry for serverless environments
			if (flushOnResponse) {
				await flushTelemetry();
			}
		} catch (error) {
			await telescope.exception(error as Error);
			throw error;
		}
	};
}

/**
 * Parse query options from Hono context
 */
function parseQueryOptions(c: Context): QueryOptions {
	const limit = parseInt(c.req.query('limit') || '50', 10);
	const offset = parseInt(c.req.query('offset') || '0', 10);
	const search = c.req.query('search');
	const before = c.req.query('before');
	const after = c.req.query('after');
	const tags = c.req.query('tags')?.split(',').filter(Boolean);
	const method = c.req.query('method');
	const status = c.req.query('status');
	const level = c.req.query('level') as
		| 'debug'
		| 'info'
		| 'warn'
		| 'error'
		| undefined;

	return {
		limit: Math.min(limit, 100),
		offset,
		search,
		before: before ? new Date(before) : undefined,
		after: after ? new Date(after) : undefined,
		tags,
		method: method || undefined,
		status: status || undefined,
		level: level || undefined,
	};
}

/**
 * Parse metrics query options from Hono context
 */
function parseMetricsQueryOptions(c: Context): MetricsQueryOptions {
	const start = c.req.query('start');
	const end = c.req.query('end');
	const bucketSize = c.req.query('bucketSize');
	const limit = c.req.query('limit');

	return {
		range:
			start && end ? { start: new Date(start), end: new Date(end) } : undefined,
		bucketSize: bucketSize ? parseInt(bucketSize, 10) : undefined,
		limit: limit ? parseInt(limit, 10) : undefined,
	};
}

/**
 * Create Hono app with dashboard UI and API routes
 */
export function createUI(telescope: Telescope): Hono {
	const app = new Hono();

	// API routes
	app.get('/api/requests', async (c) => {
		const options = parseQueryOptions(c);
		const requests = await telescope.getRequests(options);
		return c.json(requests);
	});

	app.get('/api/requests/:id', async (c) => {
		const request = await telescope.getRequest(c.req.param('id'));
		if (!request) {
			return c.json({ error: 'Request not found' }, 404);
		}
		return c.json(request);
	});

	app.get('/api/exceptions', async (c) => {
		const options = parseQueryOptions(c);
		const exceptions = await telescope.getExceptions(options);
		return c.json(exceptions);
	});

	app.get('/api/exceptions/:id', async (c) => {
		const exception = await telescope.getException(c.req.param('id'));
		if (!exception) {
			return c.json({ error: 'Exception not found' }, 404);
		}
		return c.json(exception);
	});

	app.get('/api/logs', async (c) => {
		const options = parseQueryOptions(c);
		const logs = await telescope.getLogs(options);
		return c.json(logs);
	});

	app.get('/api/stats', async (c) => {
		const stats = await telescope.getStats();
		return c.json(stats);
	});

	// Metrics API
	app.get('/api/metrics', (c) => {
		const options = parseMetricsQueryOptions(c);
		const metrics = telescope.getMetrics(options);
		return c.json(metrics);
	});

	app.get('/api/metrics/endpoints', (c) => {
		const options = parseMetricsQueryOptions(c);
		const endpoints = telescope.getEndpointMetrics(options);
		return c.json(endpoints);
	});

	// Endpoint details - method and path are query params to avoid URL encoding issues
	app.get('/api/metrics/endpoint', (c) => {
		const method = c.req.query('method');
		const path = c.req.query('path');

		if (!method || !path) {
			return c.json({ error: 'method and path are required' }, 400);
		}

		const options = parseMetricsQueryOptions(c);
		const details = telescope.getEndpointDetails(method, path, options);

		if (!details) {
			return c.json({ error: 'Endpoint not found' }, 404);
		}

		return c.json(details);
	});

	app.get('/api/metrics/status', (c) => {
		const options = parseMetricsQueryOptions(c);
		const distribution = telescope.getStatusDistribution(options);
		return c.json(distribution);
	});

	app.delete('/api/metrics', (c) => {
		telescope.resetMetrics();
		return c.json({ success: true });
	});

	// Static assets
	app.get('/assets/:filename', (c) => {
		const filename = c.req.param('filename');
		const assetPath = `assets/${filename}`;
		const asset = getAsset(assetPath);
		if (asset) {
			return c.body(asset.content, 200, {
				'Content-Type': asset.contentType,
				'Cache-Control': 'public, max-age=31536000, immutable',
			});
		}
		return c.notFound();
	});

	// Dashboard UI - serve React app
	app.get('/', (c) => {
		const html = getIndexHtml();
		if (!html) {
			return c.text(
				'Telescope UI not available. Run "pnpm build:ui" first.',
				500,
			);
		}
		return c.html(html);
	});

	app.get('/*', (c) => {
		// SPA fallback - serve index.html for client-side routing
		const html = getIndexHtml();
		if (!html) {
			return c.text(
				'Telescope UI not available. Run "pnpm build:ui" first.',
				500,
			);
		}
		return c.html(html);
	});

	return app;
}

/**
 * Options for setupWebSocket
 */
export interface WebSocketOptions {
	/**
	 * Enable real-time metrics broadcasting (default: true)
	 */
	broadcastMetrics?: boolean;
	/**
	 * Metrics broadcast interval in milliseconds (default: 5000)
	 */
	metricsBroadcastInterval?: number;
}

/**
 * Set up WebSocket routes for real-time updates.
 * Requires @hono/node-ws for Node.js or Bun's built-in WebSocket.
 */
export function setupWebSocket(
	app: Hono,
	telescope: Telescope,
	upgradeWebSocket: (handler: any) => any,
	options: WebSocketOptions = {},
): void {
	const { broadcastMetrics = true, metricsBroadcastInterval = 5000 } = options;

	// Start metrics broadcast if enabled
	if (broadcastMetrics) {
		telescope.startMetricsBroadcast(metricsBroadcastInterval);
	}

	app.get(
		'/ws',
		upgradeWebSocket(() => ({
			onOpen: (_event: Event, ws: WebSocket) => {
				telescope.addWsClient(ws);
			},
			onClose: (_event: Event, ws: WebSocket) => {
				telescope.removeWsClient(ws);
			},
			onMessage: (event: MessageEvent, ws: WebSocket) => {
				try {
					const data = JSON.parse(event.data);
					if (data.type === 'ping') {
						ws.send(JSON.stringify({ type: 'pong' }));
					}
				} catch {
					// Ignore invalid messages
				}
			},
		})),
	);
}

/**
 * Get the Telescope context from Hono context (set by middleware)
 */
export function getTelescopeContext(
	c: Context,
): TelescopeHonoContext | undefined {
	return c.get(CONTEXT_KEY);
}

/**
 * Get the request ID from Hono context (set by middleware)
 */
export function getRequestId(c: Context): string | undefined {
	return getTelescopeContext(c)?.requestId;
}

// Re-export types and utilities
export type { Telescope };
export type {
	HonoAdapterConfig,
	TelescopeHonoContext,
} from '../adapters/types';
export { flushTelemetry } from '../instrumentation/core';
