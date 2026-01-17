/**
 * An envParser that accesses some env vars then throws.
 */
import type { SnifferEnvironmentParser } from '@geekmidas/envkit/sniffer';

export function envParser(parser: SnifferEnvironmentParser) {
	const _config = parser.create((get) => ({
		port: get('PORT').string(),
		apiKey: get('API_KEY').string(),
	}));

	// Throw after creating the parser but before returning
	throw new Error('EnvParser initialization failed');
}

export default envParser;
