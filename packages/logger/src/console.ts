import type { CreateLoggerOptions, LogFn, Logger } from './types';
import { LogLevel } from './types';

/**
 * Numeric priority for log levels (higher = more severe)
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
	[LogLevel.Trace]: 10,
	[LogLevel.Debug]: 20,
	[LogLevel.Info]: 30,
	[LogLevel.Warn]: 40,
	[LogLevel.Error]: 50,
	[LogLevel.Fatal]: 60,
	[LogLevel.Silent]: 70,
};

export class ConsoleLogger implements Logger {
	private readonly level: LogLevel;

	/**
	 * Creates a new ConsoleLogger instance.
	 *
	 * @param data - Initial context data to include in all log messages
	 * @param level - Minimum log level to output (default: Info)
	 */
	constructor(
		readonly data: object = {},
		level: LogLevel = LogLevel.Info,
	) {
		this.level = level;
	}

	/**
	 * Checks if a log level should be output based on the configured minimum level.
	 */
	private shouldLog(level: LogLevel): boolean {
		if (this.level === LogLevel.Silent) {
			return false;
		}
		return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
	}

	/**
	 * Creates a logging function that merges context data and adds timestamps.
	 *
	 * @param logMethod - The console method to use (e.g., console.log, console.error)
	 * @param level - The log level for this method
	 * @returns A LogFn that handles both structured and simple logging
	 * @private
	 */
	private createLogFn(
		logMethod: (...args: any[]) => void,
		level: LogLevel,
	): LogFn {
		return <T extends object>(
			objOrMsg: T | string,
			msg?: string,
			...args: any[]
		): void => {
			if (!this.shouldLog(level)) {
				return;
			}

			const ts = Date.now();

			// Handle simple string logging: logger.info('message')
			if (typeof objOrMsg === 'string') {
				const logData = { ...this.data, msg: objOrMsg, ts };
				logMethod(logData, ...args);
				return;
			}

			// Handle structured logging: logger.info({ data }, 'message')
			const logData = msg
				? { ...this.data, ...objOrMsg, msg, ts }
				: { ...this.data, ...objOrMsg, ts };
			logMethod(logData, ...args);
		};
	}

	/** Trace level logging function */
	trace: LogFn = this.createLogFn(console.trace.bind(console), LogLevel.Trace);
	/** Debug level logging function */
	debug: LogFn = this.createLogFn(console.debug.bind(console), LogLevel.Debug);
	/** Info level logging function */
	info: LogFn = this.createLogFn(console.info.bind(console), LogLevel.Info);
	/** Warning level logging function */
	warn: LogFn = this.createLogFn(console.warn.bind(console), LogLevel.Warn);
	/** Error level logging function */
	error: LogFn = this.createLogFn(console.error.bind(console), LogLevel.Error);
	/** Fatal level logging function (uses console.error) */
	fatal: LogFn = this.createLogFn(console.error.bind(console), LogLevel.Fatal);

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
		return new ConsoleLogger(
			{
				...this.data,
				...obj,
			},
			this.level,
		);
	}
}

/**
 * @example Basic usage
 * ```typescript
 * const logger = new ConsoleLogger({ app: 'myApp' });
 * logger.info({ action: 'start' }, 'Application starting');
 * // Logs: { app: 'myApp', action: 'start', msg: 'Application starting', ts: 1234567890 }
 * ```
 *
 * @example Child logger usage
 * ```typescript
 * const childLogger = logger.child({ module: 'auth' });
 * childLogger.debug({ userId: 123 }, 'User authenticated');
 * // Logs: { app: 'myApp', module: 'auth', userId: 123, msg: 'User authenticated', ts: 1234567891 }
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
 * import { LogLevel } from '@geekmidas/logger';
 *
 * const logger = createLogger({ level: LogLevel.Debug });
 * logger.debug('This will be logged');
 * logger.trace('This will NOT be logged (below Debug level)');
 * ```
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
	return new ConsoleLogger({}, options.level ?? LogLevel.Info);
}
