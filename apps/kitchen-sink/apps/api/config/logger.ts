import { createPinoTransport } from '@geekmidas/telescope/logger/pino';
import pino from 'pino';
import { telescope } from './telescope.js';

/**
 * Pino logger with Telescope integration. Logs stream to stdout AND to the
 * Telescope dashboard (visit `/telescope` while `gkm dev` is running).
 */
const logger = pino(
	{
		level: 'debug',
		formatters: {
			bindings() {
				return { nodeVersion: process.version };
			},
			level: (label) => ({ level: label.toUpperCase() }),
		},
	},
	pino.multistream([
		{ stream: process.stdout },
		{ stream: createPinoTransport({ telescope }) },
	]),
);

export default logger;
