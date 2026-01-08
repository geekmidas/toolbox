import { createPinoTransport } from '@geekmidas/telescope/logger/pino';
import pino from 'pino';
import { telescope } from './telescope.js';

/**
 * Pino logger with Telescope integration.
 *
 * Logs are sent to both:
 * - stdout (for console output)
 * - Telescope (for the debugging dashboard)
 *
 * View logs at /telescope in your browser.
 */
const logger = pino(
	{
		level: 'debug',
		formatters: {
			bindings() {
				return { nodeVersion: process.version };
			},
			level: (label) => {
				return { level: label.toUpperCase() };
			},
		},
	},
	pino.multistream([
		{ stream: process.stdout },
		{ stream: createPinoTransport({ telescope }) },
	]),
);

export default logger;
