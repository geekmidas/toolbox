import { ensureServices } from './services';

/** Redis, and the HTTP proxy the Upstash client speaks to. */
export default async function globalSetup() {
	await ensureServices('redis', 'cache');
}
