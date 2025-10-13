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

export type CreateLoggerOptions = {
  pretty?: boolean;
  level?: LogLevel;
};
