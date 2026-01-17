/**
 * An envParser that returns a config with a parse() method.
 */
import type { SnifferEnvironmentParser } from '@geekmidas/envkit/sniffer';

export function envParser(parser: SnifferEnvironmentParser) {
	// Create a config that will fail on parse() due to missing env vars
	// This tests the try/catch around result.parse()
	const config = parser.create((get) => ({
		port: get('PORT').string(),
		databaseUrl: get('DATABASE_URL').string(),
		apiKey: get('API_KEY').string(),
	}));

	return config;
}

export default envParser;
