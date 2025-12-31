import type { CreateLoggerOptions, LogFn, Logger } from './types';

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
    return <T extends object>(
      objOrMsg: T | string,
      msg?: string,
      ...args: any[]
    ): void => {
      const ts = Date.now();

      // Handle simple string logging: logger.info('message')
      if (typeof objOrMsg === 'string') {
        const mergedData = { ...this.data, ts };
        logMethod(mergedData, objOrMsg, ...args);
        return;
      }

      // Handle structured logging: logger.info({ data }, 'message')
      const mergedData = { ...this.data, ...objOrMsg, ts };
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

export const DEFAULT_LOGGER = new ConsoleLogger() as any;

/**
 * Creates a console logger with the same API as pino's createLogger.
 *
 * @param options - Logger configuration options
 * @returns A ConsoleLogger instance
 *
 * @example
 * ```typescript
 * import { createLogger } from '@geekmidas/logger/console';
 *
 * const logger = createLogger({ level: LogLevel.Debug });
 * logger.info({ action: 'start' }, 'Application starting');
 * ```
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  return new ConsoleLogger();
}
