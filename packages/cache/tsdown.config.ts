import { defineConfig } from 'tsdown';

export default defineConfig({
	// Optional peers: a driver's module is the lazy boundary, so an app that
	// never imports `@geekmidas/cache/redis` never resolves ioredis.
	external: ['expo-secure-store', '@upstash/redis', 'ioredis', 'pg'],
});
