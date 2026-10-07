/**
 * Pino logger with built-in redaction support for sensitive data.
 *
 * Redaction is on by default: a logger that was never told about passwords
 * and tokens still masks them. `redact: false` is the explicit opt-out.
 *
 * @example
 * ```typescript
 * import { createLogger, DEFAULT_REDACT_PATHS } from '@geekmidas/logger/pino';
 *
 * // Redaction with sensible defaults — the same as `redact: true`
 * const logger = createLogger();
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
import { type LogFn, type Logger, pino, stdSerializers } from 'pino';
import { otelStreamWrite } from './otel';
import {
	DEFAULT_REDACT_PATHS,
	redactUrlCredentials,
	redactUrlCredentialsIn,
} from './redact-paths';
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
 * Returns undefined only when redaction is turned off with `false`; leaving it
 * unset is the same as `true`, so sensitive paths are masked unless someone
 * decides they should not be.
 *
 * By default (resolution: 'merge'), custom paths are merged with DEFAULT_REDACT_PATHS.
 * With resolution: 'override', only the custom paths are used.
 */
function resolveRedactConfig(
	redact: boolean | RedactOptions | undefined,
): PinoRedactConfig | undefined {
	if (redact === false) {
		return undefined;
	}

	if (redact === undefined || redact === true) {
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
 * // Basic logger — sensitive paths are redacted by default
 * const logger = createLogger({ level: 'debug' });
 *
 * // Opt out of redaction
 * const rawLogger = createLogger({ redact: false });
 *
 * // Pretty printing in development
 * const devLogger = createLogger({ pretty: true });
 * ```
 */
export function createLogger(options: CreateLoggerOptions = {}) {
	// Pretty printing spawns a transport worker and writes for humans; in
	// production the output is for a log pipeline, so `pretty` is ignored there.
	const pretty = options?.pretty && process.env.NODE_ENV !== 'production';
	const baseOptions = pretty
		? {
				transport: {
					target: 'pino-pretty',
					options: { colorize: true },
				},
			}
		: {};

	const redact = resolveRedactConfig(options.redact);

	// An Error is serialized only under a key pino has a serializer for — `err`
	// by default — and anything else is JSON.stringify'd, which an Error survives
	// as `{}`: no message, no stack. `logger.error({ error }, …)` is how most
	// code writes it, so `error` gets the same serializer as `err`.
	//
	// The serialized copy is a plain object, so URL credentials in the message
	// or the stack are masked like any other field; path redaction runs after
	// serializers, so `err.message` and `error.stack` are paths it can reach.
	const serializeError = (value: unknown) => {
		const serialized = stdSerializers.err(value as Error);
		if (!redact || serialized === value) return serialized;
		return redactUrlCredentialsIn({ ...serialized });
	};

	const pinoOptions = {
		...baseOptions,
		...(options.level && { level: options.level }),
		...(redact && { redact }),
		serializers: { err: serializeError, error: serializeError },
		hooks: {
			// Redaction also masks the credentials of any URL, in any field or
			// in the message: `s3://KEY:SECRET@uploads` is logged with its
			// secret under a name no path list can predict.
			...(redact && {
				logMethod(this: Logger, args: Parameters<LogFn>, method: LogFn) {
					const redacted = args.map((arg) =>
						typeof arg === 'string' ? redactUrlCredentials(arg) : arg,
					) as Parameters<LogFn>;
					return method.apply(this, redacted);
				},
			}),
			// Each line, once redacted and serialized, also goes to
			// OpenTelemetry when a LoggerProvider is registered. On the calling
			// thread, before any transport, so the active span is the caller's.
			streamWrite: otelStreamWrite,
		},
		formatters: {
			...(redact && {
				log: (object: Record<string, unknown>) =>
					redactUrlCredentialsIn(object),
			}),
			bindings() {
				return { nodeVersion: process.version };
			},
			level: (label: string) => {
				return { level: label.toUpperCase() };
			},
		},
	};

	// A transport writes on its own worker, so a destination only applies when
	// the logger is not pretty-printing.
	return options.destination && !pretty
		? pino(pinoOptions, options.destination)
		: pino(pinoOptions);
}
