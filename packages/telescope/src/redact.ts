import { DEFAULT_REDACT_PATHS as BASE_REDACT_PATHS } from '@geekmidas/logger/redact';
import pinoRedact from '@pinojs/redact';
import type { TelescopeRedactOptions } from './types';

/**
 * Telescope-specific redaction paths for HTTP request/response data.
 * These extend the base paths from @geekmidas/logger.
 */
const TELESCOPE_SPECIFIC_PATHS: string[] = [
	// Response headers (telescope-specific)
	'responseHeaders.set-cookie',
	'responseHeaders.Set-Cookie',

	// Request body fields
	'body.password',
	'body.token',
	'body.accessToken',
	'body.refreshToken',
	'body.apiKey',
	'body.secret',
	'body.creditCard',
	'body.cardNumber',
	'body.cvv',
	'body.ssn',

	// Nested body patterns (wildcards)
	'body.*.password',
	'body.*.token',
	'body.*.secret',
	'body.*.apiKey',

	// Response body fields
	'responseBody.password',
	'responseBody.token',
	'responseBody.accessToken',
	'responseBody.refreshToken',
	'responseBody.secret',
	'responseBody.*.password',
	'responseBody.*.token',
	'responseBody.*.secret',

	// Query parameters
	'query.token',
	'query.api_key',
	'query.apiKey',
	'query.access_token',
	'query.secret',

	// Log context patterns
	'context.password',
	'context.token',
	'context.secret',
	'context.apiKey',
	'context.*.password',
	'context.*.token',
	'context.*.secret',
];

/**
 * Combined default paths for Telescope redaction.
 * Includes base paths from @geekmidas/logger plus telescope-specific HTTP paths.
 */
export const DEFAULT_REDACT_PATHS: string[] = [
	...BASE_REDACT_PATHS,
	...TELESCOPE_SPECIFIC_PATHS,
];

/**
 * Type for the redactor function returned by @pinojs/redact
 */
export type Redactor = <T>(obj: T) => T;

/**
 * Creates a redactor function based on the provided options.
 *
 * @param options - Redaction configuration
 * @returns A redactor function, or undefined if redaction is disabled
 *
 * @example
 * const redactor = createRedactor(true);
 * const safe = redactor({ headers: { authorization: 'Bearer secret' } });
 * // safe.headers.authorization === '[REDACTED]'
 */
export function createRedactor(
	options: TelescopeRedactOptions | undefined,
): Redactor | undefined {
	if (options === undefined || options === false) {
		return undefined;
	}

	let paths: string[];
	let censor: string = '[REDACTED]';

	if (options === true) {
		// Use defaults only
		paths = DEFAULT_REDACT_PATHS;
	} else if (Array.isArray(options)) {
		// Merge custom paths with defaults
		paths = [...DEFAULT_REDACT_PATHS, ...options];
	} else {
		// Object configuration
		paths = [...DEFAULT_REDACT_PATHS, ...options.paths];
		if (options.censor !== undefined) {
			censor = options.censor;
		}
	}

	// Create the redactor with serialize: false to return objects
	const redact = pinoRedact({
		paths,
		censor,
		serialize: false,
	});

	return redact as Redactor;
}
