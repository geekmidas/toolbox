/**
 * Entry app fixture that throws during initialization.
 * Tests that env vars are still captured even when the entry throws.
 */
import { EnvironmentParser } from '@geekmidas/envkit';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _config = new EnvironmentParser(process.env as Record<string, string>)
	.create((get) => ({
		port: get('PORT').string().transform(Number),
		apiKey: get('API_KEY').string(),
	}))
	.parse();

// Throw after env vars are accessed
throw new Error('Initialization failed: Missing required configuration');
