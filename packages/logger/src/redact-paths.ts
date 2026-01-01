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
