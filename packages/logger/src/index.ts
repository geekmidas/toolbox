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
export class ConsoleLogger implements Logger {
  /**
   * Creates a new ConsoleLogger instance.
   *
   * @param data - Initial context data to include in all log messages
   */
  constructor(readonly data: object = {}) {}

  /**
   * Creates a logging function that merges context data and adds timestamps.
   *
   * @param logMethod - The console method to use (e.g., console.log, console.error)
   * @returns A LogFn that handles both structured and simple logging
   * @private
   */
  private createLogFn(logMethod: (...args: any[]) => void): LogFn {
    return <T extends object>(obj: T, msg?: string, ...args: any[]): void => {
      // Merge the logger's context data with the provided object
      const ts = Date.now();
      const mergedData = { ...this.data, ...obj, ts };

      if (msg) {
        logMethod(mergedData, msg, ...args);
      } else {
        logMethod(mergedData, ...args);
      }
    };
  }

  /** Debug level logging function */
  debug: LogFn = this.createLogFn(console.debug.bind(console));
  /** Info level logging function */
  info: LogFn = this.createLogFn(console.info.bind(console));
  /** Warning level logging function */
  warn: LogFn = this.createLogFn(console.warn.bind(console));
  /** Error level logging function */
  error: LogFn = this.createLogFn(console.error.bind(console));
  /** Fatal level logging function (uses console.error) */
  fatal: LogFn = this.createLogFn(console.error.bind(console));
  /** Trace level logging function */
  trace: LogFn = this.createLogFn(console.trace.bind(console));

  /**
   * Creates a child logger with additional context data.
   * The child logger inherits all context from the parent and adds its own.
   *
   * @param obj - Additional context data for the child logger
   * @returns A new ConsoleLogger instance with merged context
   *
   * @example
   * ```typescript
   * const parentLogger = new ConsoleLogger({ app: 'myApp' });
   * const childLogger = parentLogger.child({ module: 'database' });
   * childLogger.info({ query: 'SELECT * FROM users' }, 'Query executed');
   * // Context includes both { app: 'myApp' } and { module: 'database' }
   * ```
   */
  child(obj: object): Logger {
    return new ConsoleLogger({
      ...this.data,
      ...obj,
    });
  }
}

/**
 * @example Basic usage
 * ```typescript
 * const logger = new ConsoleLogger({ app: 'myApp' });
 * logger.info({ action: 'start' }, 'Application starting');
 * // Logs: { app: 'myApp', action: 'start', ts: 1234567890 } Application starting
 * ```
 *
 * @example Child logger usage
 * ```typescript
 * const childLogger = logger.child({ module: 'auth' });
 * childLogger.debug({ userId: 123 }, 'User authenticated');
 * // Logs: { app: 'myApp', module: 'auth', userId: 123, ts: 1234567891 } User authenticated
 * ```
 *
 * @example Error logging with context
 * ```typescript
 * try {
 *   await someOperation();
 * } catch (error) {
 *   logger.error({ error, operation: 'someOperation' }, 'Operation failed');
 * }
 * ```
 */
