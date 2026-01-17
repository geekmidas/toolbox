/**
 * Entry app fixture with nested configuration.
 * Tests that nested env var access is tracked correctly.
 */
import { EnvironmentParser } from '@geekmidas/envkit';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _config = new EnvironmentParser(process.env as Record<string, string>)
	.create((get) => ({
		server: {
			port: get('PORT').string().transform(Number),
			host: get('HOST').string(),
		},
		database: {
			url: get('DATABASE_URL').string(),
			poolSize: get('DB_POOL_SIZE').string().transform(Number),
		},
		auth: {
			secret: get('BETTER_AUTH_SECRET').string(),
			url: get('BETTER_AUTH_URL').string(),
			trustedOrigins: get('BETTER_AUTH_TRUSTED_ORIGINS').string(),
		},
	}))
	.parse();
