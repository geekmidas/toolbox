import { InMemoryStorage, Telescope } from '@geekmidas/telescope';

/**
 * Telescope captures HTTP requests/responses, logs (via the Pino transport in
 * `logger.ts`) and exceptions. Dashboard: `/telescope`.
 */
export const telescope = new Telescope({
	storage: new InMemoryStorage({ maxEntries: 1000 }),
	enabled: true,
	recordBody: true,
	ignorePatterns: ['/telescope', '/health'],
});
