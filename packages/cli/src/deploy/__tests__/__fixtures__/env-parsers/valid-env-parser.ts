/**
 * A valid envParser fixture that returns a parseable config.
 */
import type { SnifferEnvironmentParser } from '@geekmidas/envkit/sniffer';

export function envParser(parser: SnifferEnvironmentParser) {
	return parser.create((get) => ({
		port: get('PORT').string(),
		database: {
			url: get('DATABASE_URL').string(),
			poolSize: get('DB_POOL_SIZE').string(),
		},
	}));
}

export default envParser;
