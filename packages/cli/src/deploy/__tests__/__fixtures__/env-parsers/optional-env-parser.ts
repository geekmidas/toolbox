/**
 * An envParser fixture that mixes required and optional/default variables.
 * Used to test the markOptional feature.
 */
import type { SnifferEnvironmentParser } from '@geekmidas/envkit/sniffer';

export function envParser(parser: SnifferEnvironmentParser) {
	return parser.create((get) => ({
		// Required
		databaseUrl: get('DATABASE_URL').string(),
		apiKey: get('API_KEY').string(),
		// Optional via .optional()
		logLevel: get('LOG_LEVEL').string().optional(),
		// Optional via .default()
		port: get('PORT').string().default('3000'),
		// Optional via .default() after transform
		timeout: get('TIMEOUT').string().transform(Number).default(5000),
	}));
}

export default envParser;
