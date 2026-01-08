/**
 * Logging function type that supports both structured and simple logging.
 * Can be called with an object for structured logging or just a message string.
 *
 * @example
 * ```typescript
 * // Structured logging with context object
 * logger.info({ userId: 123, action: 'login' }, 'User logged in');
 *
 * // Simple string logging
 * logger.info('Application started');
 * ```
 */
export type LogFn = {
	/** Structured logging with context object, optional message, and additional arguments */
	<T extends object>(obj: T, msg?: string, ...args: any[]): void;
	/** Simple string logging */
	(msg: string): void;
};

/**
 * Standard logger interface with multiple log levels and child logger support.
 * Follows common logging patterns with structured logging capabilities.
 *
 * @interface Logger
 */
export interface Logger {
	/** Debug level logging - verbose information for debugging */
	debug: LogFn;
	/** Info level logging - general informational messages */
	info: LogFn;
	/** Warning level logging - potentially harmful situations */
	warn: LogFn;
	/** Error level logging - error events that might still allow the application to continue */
	error: LogFn;
	/** Fatal level logging - severe errors that will likely cause the application to abort */
	fatal: LogFn;
	/** Trace level logging - most detailed information */
	trace: LogFn;
	/**
	 * Creates a child logger with additional context.
	 * Child loggers inherit parent context and add their own.
	 *
	 * @param obj - Additional context to include in all child logger calls
	 * @returns A new Logger instance with merged context
	 */
	child: (obj: object) => Logger;
}

/**
 * Console-based logger implementation that outputs to standard console methods.
 * Supports structured logging with automatic timestamp injection and context inheritance.
 *
 * @implements {Logger}
 *
 * @example
 * ```typescript
 * const logger = new ConsoleLogger({ app: 'myApp', version: '1.0.0' });
 * logger.info({ userId: 123 }, 'User action performed');
 * // Output: { app: 'myApp', version: '1.0.0', userId: 123, ts: 1234567890 } User action performed
 *
 * const childLogger = logger.child({ module: 'auth' });
 * childLogger.debug({ action: 'validate' }, 'Validating token');
 * // Output: { app: 'myApp', version: '1.0.0', module: 'auth', action: 'validate', ts: 1234567891 } Validating token
 * ```
 */
export enum LogLevel {
	Trace = 'trace',
	Debug = 'debug',
	Info = 'info',
	Warn = 'warn',
	Error = 'error',
	Fatal = 'fatal',
	Silent = 'silent',
}

/**
 * Redaction configuration for masking sensitive data in logs.
 * Uses pino's fast-redact library under the hood.
 *
 * By default, custom paths are merged with the default sensitive paths.
 * Use `resolution: 'override'` to use only your custom paths.
 *
 * @example
 * ```typescript
 * // Simple path array (merges with defaults)
 * redact: ['user.ssn', 'custom.field']
 *
 * // Override defaults completely
 * redact: {
 *   paths: ['only.these.paths'],
 *   resolution: 'override',
 * }
 *
 * // With custom censor
 * redact: {
 *   paths: ['extra.secret'],
 *   censor: '***',
 * }
 *
 * // Remove fields entirely
 * redact: {
 *   paths: ['temporary.data'],
 *   remove: true,
 * }
 * ```
 */
export type RedactOptions =
	| string[]
	| {
			/** Paths to redact using dot notation or bracket notation for special chars */
			paths: string[];
			/** Custom replacement text (default: '[REDACTED]') */
			censor?: string | ((value: unknown, path: string[]) => unknown);
			/** Remove the field entirely instead of replacing (default: false) */
			remove?: boolean;
			/**
			 * How to combine custom paths with default sensitive paths.
			 * - 'merge': Custom paths are added to default paths (default)
			 * - 'override': Only custom paths are used, defaults are ignored
			 */
			resolution?: 'merge' | 'override';
	  };

export type CreateLoggerOptions = {
	/** Enable pretty printing with colors (disabled in production) */
	pretty?: boolean;
	/** Minimum log level to output */
	level?: LogLevel;
	/**
	 * Redaction configuration for masking sensitive data.
	 *
	 * - `true`: Uses default sensitive paths (password, token, secret, etc.)
	 * - `false` or `undefined`: No redaction applied
	 * - `string[]`: Custom paths merged with defaults
	 * - `object`: Advanced config with paths, censor, remove, and resolution options
	 *
	 * By default, custom paths are **merged** with the default sensitive paths.
	 * Use `resolution: 'override'` to disable defaults and use only your paths.
	 *
	 * @example
	 * ```typescript
	 * // Use defaults only
	 * createLogger({ redact: true });
	 *
	 * // Add custom paths (merged with defaults)
	 * createLogger({ redact: ['user.ssn', 'custom.field'] });
	 *
	 * // Override defaults completely
	 * createLogger({
	 *   redact: {
	 *     paths: ['only.these.paths'],
	 *     resolution: 'override',
	 *   }
	 * });
	 *
	 * // Merge with custom censor
	 * createLogger({
	 *   redact: {
	 *     paths: ['extra.secret'],
	 *     censor: '***',
	 *   }
	 * });
	 * ```
	 */
	redact?: boolean | RedactOptions;
};
