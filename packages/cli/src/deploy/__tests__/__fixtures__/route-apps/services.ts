/**
 * Test services for route-based app sniffing fixtures.
 * These services access environment variables via envParser.create().
 */
import type { EnvironmentParser } from '@geekmidas/envkit';

// Simple Service type for test fixtures (avoids importing @geekmidas/services)
type TestService<TName extends string, TInstance> = {
	serviceName: TName;
	register(ctx: { envParser: EnvironmentParser<Record<string, string | undefined>> }): Promise<TInstance>;
};

// Database service - requires DATABASE_URL
export const databaseService: TestService<'database', { url: string }> = {
	serviceName: 'database' as const,
	async register({ envParser }) {
		const config = envParser
			.create((get) => ({
				url: get('DATABASE_URL').string(),
				poolSize: get('DB_POOL_SIZE').string().transform(Number).optional(),
			}))
			.parse();
		return { url: config.url };
	},
};

// Cache service - requires REDIS_URL
export const cacheService: TestService<'cache', { url: string }> = {
	serviceName: 'cache' as const,
	async register({ envParser }) {
		const config = envParser
			.create((get) => ({
				url: get('REDIS_URL').string(),
			}))
			.parse();
		return { url: config.url };
	},
};

// Auth service - requires AUTH_SECRET and AUTH_URL
export const authService: TestService<'auth', { secret: string; url: string }> = {
	serviceName: 'auth' as const,
	async register({ envParser }) {
		const config = envParser
			.create((get) => ({
				secret: get('AUTH_SECRET').string(),
				url: get('AUTH_URL').string(),
			}))
			.parse();
		return { secret: config.secret, url: config.url };
	},
};
