import type { Telescope } from '../Telescope';

/**
 * Logger interface matching @geekmidas/logger
 */
export interface Logger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;
  trace: LogFn;
  child: (obj: object) => Logger;
}

export type LogFn = {
  <T extends object>(obj: T, msg?: string, ...args: any[]): void;
  (msg: string): void;
};

export interface TelescopeLoggerOptions {
  /**
   * The Telescope instance to send logs to
   */
  telescope: Telescope;
  /**
   * Optional underlying logger to also forward logs to.
   * If not provided, logs will only go to Telescope.
   */
  logger?: Logger;
  /**
   * Request ID to associate logs with a specific request.
   */
  requestId?: string;
  /**
   * Initial context data to include in all log messages
   */
  context?: Record<string, unknown>;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * A logger that sends logs to both Telescope and an optional underlying logger.
 * Implements the Logger interface from @geekmidas/logger.
 *
 * @example
 * ```typescript
 * import { Telescope, InMemoryStorage } from '@geekmidas/telescope';
 * import { TelescopeLogger } from '@geekmidas/telescope/logger/console';
 * import { ConsoleLogger } from '@geekmidas/logger/console';
 *
 * const telescope = new Telescope({ storage: new InMemoryStorage() });
 *
 * // With underlying logger (logs to both console and Telescope)
 * const logger = new TelescopeLogger({
 *   telescope,
 *   logger: new ConsoleLogger({ app: 'myApp' }),
 * });
 *
 * // Without underlying logger (logs only to Telescope)
 * const telescopeOnly = new TelescopeLogger({ telescope });
 *
 * // Usage
 * logger.info({ userId: '123' }, 'User logged in');
 * logger.error({ error: 'Something failed' }, 'Operation failed');
 * ```
 */
export class TelescopeLogger implements Logger {
  private telescope: Telescope;
  private logger?: Logger;
  private requestId?: string;
  private context: Record<string, unknown>;

  constructor(options: TelescopeLoggerOptions) {
    this.telescope = options.telescope;
    this.logger = options.logger;
    this.requestId = options.requestId;
    this.context = options.context ?? {};
  }

  private createLogFn(level: LogLevel): LogFn {
    const fn = <T extends object>(
      objOrMsg: T | string,
      msg?: string,
      ...args: any[]
    ): void => {
      let context: Record<string, unknown>;
      let message: string;

      if (typeof objOrMsg === 'string') {
        context = { ...this.context };
        message = objOrMsg;
      } else {
        context = { ...this.context, ...objOrMsg };
        message = msg ?? '';
      }

      // Forward to underlying logger if present
      if (this.logger) {
        if (typeof objOrMsg === 'string') {
          this.logger[level](objOrMsg);
        } else {
          this.logger[level](objOrMsg as any, msg, ...args);
        }
      }

      // Send to Telescope (fire and forget)
      this.telescope[level](message, context, this.requestId).catch(() => {});
    };

    return fn as LogFn;
  }

  debug: LogFn = this.createLogFn('debug');
  info: LogFn = this.createLogFn('info');
  warn: LogFn = this.createLogFn('warn');
  error: LogFn = this.createLogFn('error');

  // Map fatal and trace to error and debug for Telescope
  fatal: LogFn = ((
    objOrMsg: object | string,
    msg?: string,
    ...args: any[]
  ): void => {
    // Forward to underlying logger if present
    if (this.logger) {
      if (typeof objOrMsg === 'string') {
        this.logger.fatal(objOrMsg);
      } else {
        this.logger.fatal(objOrMsg as any, msg, ...args);
      }
    }

    // Send to Telescope as error level
    let context: Record<string, unknown>;
    let message: string;

    if (typeof objOrMsg === 'string') {
      context = { ...this.context, level: 'fatal' };
      message = objOrMsg;
    } else {
      context = { ...this.context, ...objOrMsg, level: 'fatal' };
      message = msg ?? '';
    }

    this.telescope.error(message, context, this.requestId).catch(() => {});
  }) as LogFn;

  trace: LogFn = ((
    objOrMsg: object | string,
    msg?: string,
    ...args: any[]
  ): void => {
    // Forward to underlying logger if present
    if (this.logger) {
      if (typeof objOrMsg === 'string') {
        this.logger.trace(objOrMsg);
      } else {
        this.logger.trace(objOrMsg as any, msg, ...args);
      }
    }

    // Send to Telescope as debug level
    let context: Record<string, unknown>;
    let message: string;

    if (typeof objOrMsg === 'string') {
      context = { ...this.context, level: 'trace' };
      message = objOrMsg;
    } else {
      context = { ...this.context, ...objOrMsg, level: 'trace' };
      message = msg ?? '';
    }

    this.telescope.debug(message, context, this.requestId).catch(() => {});
  }) as LogFn;

  /**
   * Creates a child logger with additional context.
   * The child logger inherits all context from the parent.
   */
  child(obj: object): Logger {
    return new TelescopeLogger({
      telescope: this.telescope,
      logger: this.logger?.child(obj),
      requestId: this.requestId,
      context: { ...this.context, ...obj },
    });
  }

  /**
   * Create a child logger bound to a specific request ID.
   * Useful for correlating logs with HTTP requests.
   */
  withRequestId(requestId: string): TelescopeLogger {
    return new TelescopeLogger({
      telescope: this.telescope,
      logger: this.logger,
      requestId,
      context: this.context,
    });
  }
}

/**
 * Create a logger that sends logs to Telescope.
 * Convenience function for creating a TelescopeLogger.
 *
 * @example
 * ```typescript
 * import { createTelescopeLogger } from '@geekmidas/telescope/logger/console';
 * import { ConsoleLogger } from '@geekmidas/logger/console';
 *
 * const telescope = new Telescope({ storage: new InMemoryStorage() });
 * const baseLogger = new ConsoleLogger({ app: 'myApp' });
 *
 * const logger = createTelescopeLogger(telescope, baseLogger);
 * logger.info({ action: 'startup' }, 'Application started');
 * ```
 */
export function createTelescopeLogger(
  telescope: Telescope,
  logger?: Logger,
  context?: Record<string, unknown>,
): TelescopeLogger {
  return new TelescopeLogger({ telescope, logger, context });
}

export type { Telescope };
