import { LogLevel } from '@geekmidas/logger';
import { createLogger } from '@geekmidas/logger/pino';
import { createPinoTransport } from '@geekmidas/telescope/logger/pino';
import pino from 'pino';
import { telescope } from './telescope.js';

/**
 * Pino logger with Telescope integration. Logs stream to stdout AND to
 * Telescope (`/__telescope/api/logs` while `gkm dev` is running).
 *
 * Built with `createLogger` so it redacts, and so a production server that
 * exports OpenTelemetry sends each record over OTLP too, in its request's
 * trace.
 */
export const logger = createLogger({
	level: LogLevel.Debug,
	destination: pino.multistream([
		{ stream: process.stdout },
		{ stream: createPinoTransport({ telescope }) },
	]),
});
