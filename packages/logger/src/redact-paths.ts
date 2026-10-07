/**
 * Default sensitive field paths for redaction.
 *
 * These paths are automatically used when `redact: true` is set,
 * and merged with custom paths unless `resolution: 'override'` is specified.
 *
 * Includes:
 * - Authentication: password, token, apiKey, authorization, credentials
 * - Headers: authorization, cookie, x-api-key, x-auth-token
 * - Personal data: ssn, creditCard, cvv, pin
 * - Secrets: secret, connectionString, databaseUrl
 * - Wildcards: *.password, *.secret, *.token (catches nested fields)
 */
export const DEFAULT_REDACT_PATHS: string[] = [
	// Authentication & authorization
	'password',
	'pass',
	'passwd',
	'secret',
	'token',
	'accessToken',
	'refreshToken',
	'idToken',
	'apiKey',
	'api_key',
	'apikey',
	'auth',
	'authorization',
	'credential',
	'credentials',

	// Common nested patterns (headers, body, etc.)
	'*.password',
	'*.secret',
	'*.token',
	'*.apiKey',
	'*.api_key',
	'*.authorization',
	'*.accessToken',
	'*.refreshToken',

	// HTTP headers (case variations)
	'headers.authorization',
	'headers.Authorization',
	'headers["authorization"]',
	'headers["Authorization"]',
	'headers.cookie',
	'headers.Cookie',
	'headers["x-api-key"]',
	'headers["X-Api-Key"]',
	'headers["x-auth-token"]',
	'headers["X-Auth-Token"]',

	// Common sensitive data fields
	'ssn',
	'socialSecurityNumber',
	'social_security_number',
	'creditCard',
	'credit_card',
	'cardNumber',
	'card_number',
	'cvv',
	'cvc',
	'pin',

	// Database & connection strings
	'connectionString',
	'connection_string',
	'databaseUrl',
	'database_url',
];

/**
 * `scheme://user:password@` — the userinfo of a URL that carries a secret.
 * A user with no password (`ssh://git@host`) names nobody's secret and is left
 * alone.
 */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@:]*:[^\s/?#@]*@/gi;

/**
 * Replace the credentials of every URL in `text` with `REDACTED`, so
 * `s3://KEY:SECRET@uploads` is logged as `s3://REDACTED@uploads`.
 *
 * Path redaction cannot catch these: a URL turns up under any field name —
 * `url`, `origin`, `endpoint` — or inside a message, and blanking every such
 * field would hide the half of it that is useful.
 */
export function redactUrlCredentials(text: string): string {
	return text.replace(URL_CREDENTIALS, '$1REDACTED@');
}

/** Deep enough for a log object; past it, values are logged as they are. */
const MAX_DEPTH = 6;

/**
 * A copy of `value` with {@link redactUrlCredentials} applied to every string
 * in it. Objects and arrays without such a string are returned as they were.
 */
export function redactUrlCredentialsIn<T>(value: T, depth = 0): T {
	if (typeof value === 'string') {
		return redactUrlCredentials(value) as T;
	}
	if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') {
		return value;
	}
	if (Array.isArray(value)) {
		let changed = false;
		const next = value.map((item) => {
			const redacted = redactUrlCredentialsIn(item, depth + 1);
			if (redacted !== item) changed = true;
			return redacted;
		});
		return (changed ? next : value) as T;
	}
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) return value;

	let next: Record<string, unknown> | undefined;
	for (const [key, item] of Object.entries(value)) {
		const redacted = redactUrlCredentialsIn(item, depth + 1);
		if (redacted !== item) {
			next ??= { ...(value as Record<string, unknown>) };
			next[key] = redacted;
		}
	}
	return (next ?? value) as T;
}
