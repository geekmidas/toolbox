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
import { DEFAULT_REDACT_PATHS } from './redact-paths';
import type { CreateLoggerOptions, RedactOptions } from './types';

// Re-export for backwards compatibility
export { DEFAULT_REDACT_PATHS } from './redact-paths';

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
