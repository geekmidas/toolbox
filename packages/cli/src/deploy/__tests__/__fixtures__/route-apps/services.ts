/**
 * Test services for route-based app sniffing fixtures.
 * These services access environment variables via envParser.create().
 */
import type { Service } from '@geekmidas/services';

// Database service - requires DATABASE_URL
export const databaseService = {
	serviceName: 'database' as const,
	async register({ envParser }) {
		const config = envParser
			.create((get: any) => ({
				url: get('DATABASE_URL').string(),
				poolSize: get('DB_POOL_SIZE').string().transform(Number).optional(),
			}))
			.parse();
		return { url: config.url };
	},
} satisfies Service<'database', { url: string }>;

// Cache service - requires REDIS_URL
export const cacheService = {
	serviceName: 'cache' as const,
	async register({ envParser }) {
		const config = envParser
			.create((get: any) => ({
				url: get('REDIS_URL').string(),
			}))
			.parse();
		return { url: config.url };
	},
} satisfies Service<'cache', { url: string }>;

// Auth service - requires AUTH_SECRET and AUTH_URL
export const authService = {
	serviceName: 'auth' as const,
	async register({ envParser }) {
		const config = envParser
			.create((get: any) => ({
				secret: get('AUTH_SECRET').string(),
				url: get('AUTH_URL').string(),
			}))
			.parse();
		return { secret: config.secret, url: config.url };
	},
} satisfies Service<'auth', { secret: string; url: string }>;
