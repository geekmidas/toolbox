/**
 * Simple entry app fixture that uses @geekmidas/envkit.
 * Used for testing entry app sniffing via subprocess.
 */
import { EnvironmentParser } from '@geekmidas/envkit';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _config = new EnvironmentParser(process.env as Record<string, string>)
	.create((get) => ({
		port: get('PORT').string().transform(Number),
		databaseUrl: get('DATABASE_URL').string(),
		redisUrl: get('REDIS_URL').string(),
	}))
	.parse();
