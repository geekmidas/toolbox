import { ensureServices } from './services';

/**
 * Redis, the HTTP proxy the Upstash client speaks to, and the Postgres the
 * database-backed cache keeps its table in.
 */
export default async function globalSetup() {
	await ensureServices('postgres', 'redis', 'cache');
}
