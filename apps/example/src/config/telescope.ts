import { InMemoryStorage, Telescope } from '@geekmidas/telescope';

/**
 * Telescope instance for debugging and monitoring.
 *
 * Telescope captures:
 * - HTTP requests and responses
 * - Logs (via Pino transport)
 * - Exceptions
 *
 * Access the dashboard at /telescope in your browser.
 */
export const telescope = new Telescope({
  storage: new InMemoryStorage({ maxEntries: 1000 }),
  enabled: true,
  recordBody: true,
  ignorePatterns: ['/telescope', '/health'],
});
