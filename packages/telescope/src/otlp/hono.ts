import { Hono } from 'hono';
import type { MetricsHandler, OTLPReceiverOptions } from './receiver';
import { OTLPReceiver } from './receiver';
import type {
	ExportLogsServiceRequest,
	ExportMetricsServiceRequest,
	ExportTraceServiceRequest,
} from './types';

/**
 * Create Hono routes for OTLP endpoints.
 *
 * Mount this at /v1 to get the standard OTLP paths:
 * - POST /v1/traces
 * - POST /v1/logs
 * - POST /v1/metrics
 *
 * @example
 * ```typescript
 * import { createOTLPRoutes } from '@geekmidas/telescope/otlp/hono';
 *
 * const telescope = new Telescope({ storage: new InMemoryStorage() });
 * const app = new Hono();
 *
 * // Mount OTLP endpoints at /v1
 * app.route('/v1', createOTLPRoutes({ telescope }));
 *
 * // Now accepts:
 * // POST /v1/traces
 * // POST /v1/logs
 * // POST /v1/metrics
 * ```
 */
export function createOTLPRoutes(options: OTLPReceiverOptions): Hono {
	const receiver = new OTLPReceiver(options);
	const app = new Hono();

	// POST /traces - Receive trace data
	app.post('/traces', async (c) => {
		try {
			const contentType = c.req.header('content-type') || '';

			// Only support JSON for now
			if (!contentType.includes('application/json')) {
				return c.json({ error: 'Only application/json is supported' }, 415);
			}

			const request = await c.req.json<ExportTraceServiceRequest>();
			const response = await receiver.receiveTraces(request);

			return c.json(response, response.partialSuccess ? 206 : 200);
		} catch (error) {
			return c.json(
				{
					error:
						error instanceof Error ? error.message : 'Failed to process traces',
				},
				400,
			);
		}
	});

	// POST /logs - Receive log data
	app.post('/logs', async (c) => {
		try {
			const contentType = c.req.header('content-type') || '';

			if (!contentType.includes('application/json')) {
				return c.json({ error: 'Only application/json is supported' }, 415);
			}

			const request = await c.req.json<ExportLogsServiceRequest>();
			const response = await receiver.receiveLogs(request);

			return c.json(response, response.partialSuccess ? 206 : 200);
		} catch (error) {
			return c.json(
				{
					error:
						error instanceof Error ? error.message : 'Failed to process logs',
				},
				400,
			);
		}
	});

	// POST /metrics - Receive metrics data
	app.post('/metrics', async (c) => {
		try {
			const contentType = c.req.header('content-type') || '';

			if (!contentType.includes('application/json')) {
				return c.json({ error: 'Only application/json is supported' }, 415);
			}

			const request = await c.req.json<ExportMetricsServiceRequest>();
			const response = await receiver.receiveMetrics(request);

			return c.json(response, response.partialSuccess ? 206 : 200);
		} catch (error) {
			return c.json(
				{
					error:
						error instanceof Error
							? error.message
							: 'Failed to process metrics',
				},
				400,
			);
		}
	});

	return app;
}

/**
 * Re-export the receiver for custom usage
 */
export { OTLPReceiver };
export type { MetricsHandler, OTLPReceiverOptions };
