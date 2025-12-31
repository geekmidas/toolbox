/**
 * Pino logger with built-in redaction support for sensitive data.
 *
 * @example
 * ```typescript
 * import { createLogger, DEFAULT_REDACT_PATHS } from '@geekmidas/logger/pino';
 *
 * // Enable redaction with sensible defaults
 * const logger = createLogger({ redact: true });
 *
 * // Sensitive data is automatically masked
 * logger.info({ password: 'secret123', user: 'john' }, 'Login');
 * // Output: { password: '[Redacted]', user: 'john' } Login
 *
 * // Add custom paths (merged with defaults)
 * const logger2 = createLogger({ redact: ['user.ssn'] });
 *
 * // Override defaults for full control
 * const logger3 = createLogger({
 *   redact: {
 *     paths: ['onlyThis'],
 *     resolution: 'override',
 *   }
 * });
 * ```
 *
 * @module
 */
import { pino } from 'pino';
import type { CreateLoggerOptions, RedactOptions } from './types';

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
 * Type for the resolved pino redact config (without our custom resolution field).
 */
type PinoRedactConfig =
  | string[]
  | {
      paths: string[];
      censor?: string | ((value: unknown, path: string[]) => unknown);
      remove?: boolean;
    };

/**
 * Resolves redaction configuration from options.
 * Returns undefined if redaction is disabled, or a pino-compatible redact config.
 *
 * By default (resolution: 'merge'), custom paths are merged with DEFAULT_REDACT_PATHS.
 * With resolution: 'override', only the custom paths are used.
 */
function resolveRedactConfig(
  redact: boolean | RedactOptions | undefined,
): PinoRedactConfig | undefined {
  if (redact === undefined || redact === false) {
    return undefined;
  }

  if (redact === true) {
    return DEFAULT_REDACT_PATHS;
  }

  // Array syntax - merge with defaults
  if (Array.isArray(redact)) {
    return [...DEFAULT_REDACT_PATHS, ...redact];
  }

  // Object syntax - check resolution mode
  const { resolution = 'merge', paths, censor, remove } = redact;

  const resolvedPaths =
    resolution === 'override' ? paths : [...DEFAULT_REDACT_PATHS, ...paths];

  // Return clean pino config without our resolution field
  const config: PinoRedactConfig = { paths: resolvedPaths };
  if (censor !== undefined) config.censor = censor;
  if (remove !== undefined) config.remove = remove;

  return config;
}

/**
 * Creates a pino logger instance with optional redaction support.
 *
 * @param options - Logger configuration options
 * @returns A configured pino logger instance
 *
 * @example
 * ```typescript
 * // Basic logger
 * const logger = createLogger({ level: 'debug' });
 *
 * // With redaction enabled
 * const secureLogger = createLogger({ redact: true });
 *
 * // Pretty printing in development
 * const devLogger = createLogger({ pretty: true, redact: true });
 * ```
 */
export function createLogger(options: CreateLoggerOptions = {}) {
  // @ts-ignore
  const pretty = options?.pretty && process.NODE_ENV !== 'production';
  const baseOptions = pretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      }
    : {};

  const redact = resolveRedactConfig(options.redact);

  return pino({
    ...baseOptions,
    ...(options.level && { level: options.level }),
    ...(redact && { redact }),
    formatters: {
      bindings() {
        return { nodeVersion: process.version };
      },
      level: (label) => {
        return { level: label.toUpperCase() };
      },
    },
  });
}
