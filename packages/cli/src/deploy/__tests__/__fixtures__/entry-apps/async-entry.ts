/**
 * Entry app fixture with async initialization.
 * Tests that env vars are captured even with async code paths.
 */
import { EnvironmentParser } from '@geekmidas/envkit';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _config = new EnvironmentParser(process.env as Record<string, string>)
	.create((get) => ({
		port: get('PORT').string().transform(Number),
		databaseUrl: get('DATABASE_URL').string(),
	}))
	.parse();

// Simulate async initialization (fire-and-forget style)
const init = async () => {
	await Promise.resolve();
	// This would normally connect to database, etc.
};

// Fire-and-forget promise
init().catch(() => {
	// Silently ignore - common pattern in entry apps
});
