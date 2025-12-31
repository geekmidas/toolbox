import { pino } from 'pino';
import type { CreateLoggerOptions, RedactOptions } from './types';

/**
 * Default sensitive field paths for redaction.
 * These cover common patterns for passwords, tokens, API keys, and other secrets.
 * Includes wildcards to catch nested sensitive data.
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
