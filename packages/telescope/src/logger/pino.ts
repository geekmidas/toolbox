import build from 'pino-abstract-transport';
import type { Telescope } from '../Telescope';

/**
 * Pino log object structure after parsing
 */
export interface PinoLogObject {
	level: number | string;
	time: number;
	pid?: number;
	hostname?: string;
	msg?: string;
	[key: string]: unknown;
}

export interface TelescopePinoTransportOptions {
	/**
	 * The Telescope instance to send logs to
	 */
	telescope: Telescope;
	/**
	 * Request ID to associate logs with a specific request.
	 * Can be a static string or a function that extracts the ID from log data.
	 */
	requestId?: string | ((data: PinoLogObject) => string | undefined);
	/**
	 * Batch size before flushing to Telescope (default: 100)
	 */
	batchSize?: number;
	/**
	 * Flush interval in milliseconds (default: 1000ms)
	 */
	flushIntervalMs?: number;
}

type TelescopeLogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogBatch {
	level: TelescopeLogLevel;
	message: string;
	context: Record<string, unknown>;
	requestId?: string;
}

/**
 * Map Pino levels to Telescope log levels.
 * Handles both numeric levels (default pino) and string levels (custom formatters).
 */
function mapPinoLevel(level: number | string): TelescopeLogLevel {
	// Handle string levels (from custom formatters like `level: label => ({ level: label.toUpperCase() })`)
	if (typeof level === 'string') {
		const normalized = level.toLowerCase();
		if (normalized === 'trace' || normalized === 'debug') return 'debug';
		if (normalized === 'info') return 'info';
		if (normalized === 'warn' || normalized === 'warning') return 'warn';
		return 'error'; // error, fatal, or unknown
	}

	// Pino numeric levels: trace=10, debug=20, info=30, warn=40, error=50, fatal=60
	if (level <= 20) return 'debug'; // trace, debug
	if (level <= 30) return 'info';
	if (level <= 40) return 'warn';
	return 'error'; // error, fatal
}

/**
 * Create a Pino transport that sends logs to Telescope.
 *
 * Uses pino-abstract-transport for proper async iteration and backpressure handling.
 * Logs are batched for performance and flushed either when the batch is full
 * or after the flush interval.
 *
 * @example
 * ```typescript
 * import pino from 'pino';
 * import { Telescope, InMemoryStorage } from '@geekmidas/telescope';
 * import { createPinoTransport } from '@geekmidas/telescope/logger/pino';
 *
 * const telescope = new Telescope({ storage: new InMemoryStorage() });
 *
 * // Use with pino.multistream to log to both stdout and Telescope
 * const logger = pino(
 *   { level: 'debug' },
 *   pino.multistream([
 *     { stream: process.stdout },
 *     { stream: createPinoTransport({ telescope }) }
 *   ])
 * );
 *
 * logger.info({ userId: '123' }, 'User logged in');
 * ```
 */
export function createPinoTransport(options: TelescopePinoTransportOptions) {
	const {
		telescope,
		requestId,
		batchSize = 100,
		flushIntervalMs = 1000,
	} = options;

	const batch: LogBatch[] = [];
	let flushTimer: ReturnType<typeof setTimeout> | null = null;

	async function flush(): Promise<void> {
		if (batch.length === 0) return;

		const toFlush = batch.splice(0, batch.length);

		// Use batch insert for better performance
		try {
			await telescope.log(toFlush);
		} catch {
			// Silently ignore errors to not break logging
		}
	}

	function scheduleFlush(): void {
		if (flushTimer === null) {
			flushTimer = setTimeout(() => {
				flushTimer = null;
				flush().catch(() => {
					// Silently ignore flush errors
				});
			}, flushIntervalMs);
		}
	}

	function clearFlushTimer(): void {
		if (flushTimer !== null) {
			clearTimeout(flushTimer);
			flushTimer = null;
		}
	}

	return build(
		async (source) => {
			for await (const obj of source) {
				const data = obj as PinoLogObject;
				const { level, msg, time, pid, hostname, ...context } = data;

				const telescopeLevel = mapPinoLevel(level);

				// Extract request ID
				let reqId: string | undefined;
				if (typeof requestId === 'function') {
					reqId = requestId(data);
				} else if (typeof requestId === 'string') {
					reqId = requestId;
				} else if (typeof context.requestId === 'string') {
					reqId = context.requestId;
					delete context.requestId;
				}

				batch.push({
					level: telescopeLevel,
					message: msg || '',
					context,
					requestId: reqId,
				});

				if (batch.length >= batchSize) {
					clearFlushTimer();
					await flush();
				} else {
					scheduleFlush();
				}
			}
		},
		{
			async close() {
				clearFlushTimer();
				await flush();
			},
		},
	);
}

/**
 * Create a Pino destination that sends logs to Telescope.
 * Alias for createPinoTransport for API compatibility.
 *
 * @example
 * ```typescript
 * import pino from 'pino';
 * import { createPinoDestination } from '@geekmidas/telescope/logger/pino';
 *
 * const telescope = new Telescope({ storage: new InMemoryStorage() });
 *
 * // Use with pino.multistream to log to both stdout and Telescope
 * const logger = pino(
 *   { level: 'debug' },
 *   pino.multistream([
 *     { stream: process.stdout },
 *     { stream: createPinoDestination({ telescope }) }
 *   ])
 * );
 * ```
 */
export const createPinoDestination = createPinoTransport;

export type { Telescope };
