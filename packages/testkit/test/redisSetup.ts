import { ensureServices } from './services';

/** Redis, which a WebSocket surface's replicas deliver frames through. */
export default async function globalSetup() {
	await ensureServices('redis');
}
