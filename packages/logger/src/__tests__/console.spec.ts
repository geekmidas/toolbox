import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleLogger, createLogger } from '../console';
import { LogLevel } from '../types';

describe('ConsoleLogger', () => {
	// Mock console methods
	const originalConsole = {
		debug: console.debug,
		info: console.info,
		warn: console.warn,
		error: console.error,
		trace: console.trace,
	};

	beforeEach(() => {
		// Mock all console methods
		console.debug = vi.fn();
		console.info = vi.fn();
		console.warn = vi.fn();
		console.error = vi.fn();
		console.trace = vi.fn();

		// Mock Date.now for predictable timestamps
		vi.spyOn(Date, 'now').mockReturnValue(1234567890);
	});

	afterEach(() => {
		// Restore console methods
		console.debug = originalConsole.debug;
		console.info = originalConsole.info;
		console.warn = originalConsole.warn;
		console.error = originalConsole.error;
		console.trace = originalConsole.trace;

		vi.restoreAllMocks();
	});

	describe('Constructor', () => {
		it('should create logger with no initial context', () => {
			const logger = new ConsoleLogger();

			expect(logger.data).toEqual({});
		});

		it('should create logger with initial context', () => {
			const logger = new ConsoleLogger({ app: 'myApp', version: '1.0.0' });

			expect(logger.data).toEqual({ app: 'myApp', version: '1.0.0' });
		});
	});

	describe('Log levels', () => {
		describe('debug', () => {
			it('should log debug message with context when level is Debug', () => {
				const logger = new ConsoleLogger({ app: 'test' }, LogLevel.Debug);

				logger.debug({ userId: 123 }, 'Debug message');

				expect(console.debug).toHaveBeenCalledWith({
					app: 'test',
					userId: 123,
					msg: 'Debug message',
					ts: 1234567890,
				});
			});

			it('should log debug with only context object when level is Debug', () => {
				const logger = new ConsoleLogger({}, LogLevel.Debug);

				logger.debug({ action: 'test' });

				expect(console.debug).toHaveBeenCalledWith({
					action: 'test',
					ts: 1234567890,
				});
			});
		});

		describe('info', () => {
			it('should log info message with context', () => {
				const logger = new ConsoleLogger({ app: 'test' });

				logger.info({ userId: 123 }, 'Info message');

				expect(console.info).toHaveBeenCalledWith({
					app: 'test',
					userId: 123,
					msg: 'Info message',
					ts: 1234567890,
				});
			});

			it('should log info with only context object', () => {
				const logger = new ConsoleLogger();

				logger.info({ status: 'success' });

				expect(console.info).toHaveBeenCalledWith({
					status: 'success',
					ts: 1234567890,
				});
			});
		});

		describe('warn', () => {
			it('should log warning message with context', () => {
				const logger = new ConsoleLogger({ app: 'test' });

				logger.warn({ code: 'DEPRECATED' }, 'Warning message');

				expect(console.warn).toHaveBeenCalledWith({
					app: 'test',
					code: 'DEPRECATED',
					msg: 'Warning message',
					ts: 1234567890,
				});
			});

			it('should log warning with only context object', () => {
				const logger = new ConsoleLogger();

				logger.warn({ issue: 'memory' });

				expect(console.warn).toHaveBeenCalledWith({
					issue: 'memory',
					ts: 1234567890,
				});
			});
		});

		describe('error', () => {
			it('should log error message with context', () => {
				const logger = new ConsoleLogger({ app: 'test' });
				const error = new Error('Test error');

				logger.error({ error }, 'Error occurred');

				expect(console.error).toHaveBeenCalledWith({
					app: 'test',
					error,
					msg: 'Error occurred',
					ts: 1234567890,
				});
			});

			it('should log error with only context object', () => {
				const logger = new ConsoleLogger();
				const error = new Error('Test error');

				logger.error({ error });

				expect(console.error).toHaveBeenCalledWith({
					error,
					ts: 1234567890,
				});
			});
		});

		describe('fatal', () => {
			it('should log fatal message with context', () => {
				const logger = new ConsoleLogger({ app: 'test' });

				logger.fatal({ exitCode: 1 }, 'Fatal error');

				expect(console.error).toHaveBeenCalledWith({
					app: 'test',
					exitCode: 1,
					msg: 'Fatal error',
					ts: 1234567890,
				});
			});

			it('should log fatal with only context object', () => {
				const logger = new ConsoleLogger();

				logger.fatal({ critical: true });

				expect(console.error).toHaveBeenCalledWith({
					critical: true,
					ts: 1234567890,
				});
			});
		});

		describe('trace', () => {
			it('should log trace message with context when level is Trace', () => {
				const logger = new ConsoleLogger({ app: 'test' }, LogLevel.Trace);

				logger.trace({ stack: 'trace' }, 'Trace message');

				expect(console.trace).toHaveBeenCalledWith({
					app: 'test',
					stack: 'trace',
					msg: 'Trace message',
					ts: 1234567890,
				});
			});

			it('should log trace with only context object when level is Trace', () => {
				const logger = new ConsoleLogger({}, LogLevel.Trace);

				logger.trace({ depth: 5 });

				expect(console.trace).toHaveBeenCalledWith({
					depth: 5,
					ts: 1234567890,
				});
			});
		});
	});

	describe('Log level filtering', () => {
		it('should not log debug when level is Info', () => {
			const logger = new ConsoleLogger({}, LogLevel.Info);

			logger.debug('This should not appear');

			expect(console.debug).not.toHaveBeenCalled();
		});

		it('should not log trace when level is Debug', () => {
			const logger = new ConsoleLogger({}, LogLevel.Debug);

			logger.trace('This should not appear');

			expect(console.trace).not.toHaveBeenCalled();
		});

		it('should log debug when level is Debug', () => {
			const logger = new ConsoleLogger({}, LogLevel.Debug);

			logger.debug('Debug message');

			expect(console.debug).toHaveBeenCalled();
		});

		it('should log info when level is Debug', () => {
			const logger = new ConsoleLogger({}, LogLevel.Debug);

			logger.info('Info message');

			expect(console.info).toHaveBeenCalled();
		});

		it('should not log anything when level is Silent', () => {
			const logger = new ConsoleLogger({}, LogLevel.Silent);

			logger.trace('trace');
			logger.debug('debug');
			logger.info('info');
			logger.warn('warn');
			logger.error('error');
			logger.fatal('fatal');

			expect(console.trace).not.toHaveBeenCalled();
			expect(console.debug).not.toHaveBeenCalled();
			expect(console.info).not.toHaveBeenCalled();
			expect(console.warn).not.toHaveBeenCalled();
			expect(console.error).not.toHaveBeenCalled();
		});

		it('should log error when level is Error', () => {
			const logger = new ConsoleLogger({}, LogLevel.Error);

			logger.info('This should not appear');
			logger.warn('This should not appear');
			logger.error('Error message');

			expect(console.info).not.toHaveBeenCalled();
			expect(console.warn).not.toHaveBeenCalled();
			expect(console.error).toHaveBeenCalled();
		});

		it('should inherit log level in child logger', () => {
			const parent = new ConsoleLogger({}, LogLevel.Warn);
			const child = parent.child({ module: 'test' });

			child.info('This should not appear');
			child.warn('Warning message');

			expect(console.info).not.toHaveBeenCalled();
			expect(console.warn).toHaveBeenCalled();
		});
	});

	describe('Context merging', () => {
		it('should merge logger context with log context', () => {
			const logger = new ConsoleLogger({ app: 'myApp', env: 'production' });

			logger.info({ userId: 123, action: 'login' }, 'User logged in');

			expect(console.info).toHaveBeenCalledWith({
				app: 'myApp',
				env: 'production',
				userId: 123,
				action: 'login',
				msg: 'User logged in',
				ts: 1234567890,
			});
		});

		it('should override logger context with log context', () => {
			const logger = new ConsoleLogger({ env: 'production', status: 'old' });

			logger.info({ status: 'new', userId: 456 }, 'Status updated');

			expect(console.info).toHaveBeenCalledWith({
				env: 'production',
				status: 'new', // Overridden
				userId: 456,
				msg: 'Status updated',
				ts: 1234567890,
			});
		});

		it('should always add timestamp', () => {
			const logger = new ConsoleLogger();

			logger.info({ action: 'test' }, 'Test message');

			expect(console.info).toHaveBeenCalledWith(
				expect.objectContaining({ ts: 1234567890 }),
			);
		});
	});

	describe('Additional arguments', () => {
		it('should pass additional arguments to console method', () => {
			const logger = new ConsoleLogger();
			const obj1 = { key: 'value' };
			const obj2 = { another: 'object' };

			logger.info({ action: 'test' }, 'Message', obj1, obj2);

			expect(console.info).toHaveBeenCalledWith(
				{ action: 'test', msg: 'Message', ts: 1234567890 },
				obj1,
				obj2,
			);
		});

		it('should pass additional arguments without message', () => {
			const logger = new ConsoleLogger({}, LogLevel.Debug);
			const extra = 'extra data';

			logger.debug({ action: 'test' }, undefined as any, extra);

			expect(console.debug).toHaveBeenCalledWith(
				{ action: 'test', ts: 1234567890 },
				extra,
			);
		});
	});

	describe('Child logger', () => {
		it('should create child logger with merged context', () => {
			const parentLogger = new ConsoleLogger({
				app: 'myApp',
				version: '1.0.0',
			});
			const childLogger = parentLogger.child({
				module: 'auth',
			}) as ConsoleLogger;

			expect(childLogger.data).toEqual({
				app: 'myApp',
				version: '1.0.0',
				module: 'auth',
			});
		});

		it('should inherit parent context in child logs', () => {
			const parentLogger = new ConsoleLogger({ app: 'myApp' });
			const childLogger = parentLogger.child({ module: 'database' });

			childLogger.info({ query: 'SELECT *' }, 'Query executed');

			expect(console.info).toHaveBeenCalledWith({
				app: 'myApp',
				module: 'database',
				query: 'SELECT *',
				msg: 'Query executed',
				ts: 1234567890,
			});
		});

		it('should override parent context in child logger', () => {
			const parentLogger = new ConsoleLogger({ env: 'dev', status: 'parent' });
			const childLogger = parentLogger.child({
				status: 'child',
				module: 'api',
			}) as ConsoleLogger;

			expect(childLogger.data).toEqual({
				env: 'dev',
				status: 'child', // Overridden
				module: 'api',
			});
		});

		it('should create nested child loggers', () => {
			const parentLogger = new ConsoleLogger({ app: 'myApp' });
			const childLogger = parentLogger.child({ module: 'database' });
			const grandchildLogger = childLogger.child({ operation: 'query' });

			grandchildLogger.info({ table: 'users' }, 'Query executed');

			expect(console.info).toHaveBeenCalledWith({
				app: 'myApp',
				module: 'database',
				operation: 'query',
				table: 'users',
				msg: 'Query executed',
				ts: 1234567890,
			});
		});

		it('should not affect parent logger', () => {
			const parentLogger = new ConsoleLogger({ app: 'myApp' });
			const childLogger = parentLogger.child({
				module: 'auth',
			}) as ConsoleLogger;

			// Child logger has additional context
			expect(childLogger.data).toEqual({ app: 'myApp', module: 'auth' });

			// Parent logger is unchanged
			expect(parentLogger.data).toEqual({ app: 'myApp' });
		});
	});

	describe('Edge cases', () => {
		it('should handle string-only logging without context object', () => {
			const logger = new ConsoleLogger({ app: 'test' });

			logger.info('Simple message without context object');

			expect(console.info).toHaveBeenCalledWith({
				app: 'test',
				msg: 'Simple message without context object',
				ts: 1234567890,
			});
		});

		it('should handle string-only logging with child logger', () => {
			const logger = new ConsoleLogger({ app: 'test' });
			const child = logger.child({ module: 'auth' });

			child.warn('Warning message');

			expect(console.warn).toHaveBeenCalledWith({
				app: 'test',
				module: 'auth',
				msg: 'Warning message',
				ts: 1234567890,
			});
		});

		it('should handle empty context object', () => {
			const logger = new ConsoleLogger();

			logger.info({}, 'Empty context');

			expect(console.info).toHaveBeenCalledWith({
				msg: 'Empty context',
				ts: 1234567890,
			});
		});

		it('should handle complex nested objects', () => {
			const logger = new ConsoleLogger();
			const complexObj = {
				user: {
					id: 123,
					profile: {
						name: 'John',
						tags: ['admin', 'user'],
					},
				},
			};

			logger.info(complexObj, 'Complex object');

			expect(console.info).toHaveBeenCalledWith({
				...complexObj,
				msg: 'Complex object',
				ts: 1234567890,
			});
		});

		it('should handle null and undefined values', () => {
			const logger = new ConsoleLogger();

			logger.info({ value: null, missing: undefined }, 'Null values');

			expect(console.info).toHaveBeenCalledWith({
				value: null,
				missing: undefined,
				msg: 'Null values',
				ts: 1234567890,
			});
		});

		it('should handle special characters in strings', () => {
			const logger = new ConsoleLogger();

			logger.info({ message: 'Test\n\t"quotes"' }, 'Special chars');

			expect(console.info).toHaveBeenCalledWith({
				message: 'Test\n\t"quotes"',
				msg: 'Special chars',
				ts: 1234567890,
			});
		});
	});

	describe('Real-world scenarios', () => {
		it('should log HTTP request', () => {
			const logger = new ConsoleLogger({ service: 'api' });

			logger.info(
				{
					method: 'POST',
					path: '/users',
					statusCode: 201,
					duration: 45,
				},
				'HTTP request completed',
			);

			expect(console.info).toHaveBeenCalledWith({
				service: 'api',
				method: 'POST',
				path: '/users',
				statusCode: 201,
				duration: 45,
				msg: 'HTTP request completed',
				ts: 1234567890,
			});
		});

		it('should log error with stack trace', () => {
			const logger = new ConsoleLogger({ service: 'worker' });
			const error = new Error('Database connection failed');

			logger.error(
				{
					error: error.message,
					stack: error.stack,
					operation: 'connect',
				},
				'Database error',
			);

			expect(console.error).toHaveBeenCalledWith(
				expect.objectContaining({
					service: 'worker',
					error: 'Database connection failed',
					operation: 'connect',
					msg: 'Database error',
					ts: 1234567890,
				}),
			);
		});

		it('should log business event', () => {
			const logger = new ConsoleLogger({ app: 'ecommerce' });

			logger.info(
				{
					eventType: 'order.created',
					orderId: 'ORD-123',
					userId: 456,
					amount: 99.99,
					currency: 'USD',
				},
				'Order created successfully',
			);

			expect(console.info).toHaveBeenCalledWith({
				app: 'ecommerce',
				eventType: 'order.created',
				orderId: 'ORD-123',
				userId: 456,
				amount: 99.99,
				currency: 'USD',
				msg: 'Order created successfully',
				ts: 1234567890,
			});
		});

		it('should use child logger for module-specific logging', () => {
			const appLogger = new ConsoleLogger(
				{ app: 'myApp', env: 'production' },
				LogLevel.Debug,
			);
			const authLogger = appLogger.child({ module: 'auth' });
			const dbLogger = appLogger.child({ module: 'database' });

			authLogger.info({ userId: 123 }, 'User authenticated');
			dbLogger.debug({ query: 'SELECT *', duration: 10 }, 'Query executed');

			expect(console.info).toHaveBeenCalledWith({
				app: 'myApp',
				env: 'production',
				module: 'auth',
				userId: 123,
				msg: 'User authenticated',
				ts: 1234567890,
			});

			expect(console.debug).toHaveBeenCalledWith({
				app: 'myApp',
				env: 'production',
				module: 'database',
				query: 'SELECT *',
				duration: 10,
				msg: 'Query executed',
				ts: 1234567890,
			});
		});
	});

	describe('DEFAULT_LOGGER', () => {
		it('should export default logger instance', () => {
			const { DEFAULT_LOGGER } = require('../console');

			expect(DEFAULT_LOGGER).toBeDefined();
			expect(DEFAULT_LOGGER.data).toBeDefined();
		});
	});

	describe('createLogger', () => {
		it('should create logger with default Info level', () => {
			const logger = createLogger();

			logger.debug('This should not appear');
			logger.info('This should appear');

			expect(console.debug).not.toHaveBeenCalled();
			expect(console.info).toHaveBeenCalled();
		});

		it('should create logger with specified level', () => {
			const logger = createLogger({ level: LogLevel.Debug });

			logger.trace('This should not appear');
			logger.debug('This should appear');

			expect(console.trace).not.toHaveBeenCalled();
			expect(console.debug).toHaveBeenCalled();
		});

		it('should create silent logger', () => {
			const logger = createLogger({ level: LogLevel.Silent });

			logger.error('This should not appear');
			logger.fatal('This should not appear');

			expect(console.error).not.toHaveBeenCalled();
		});
	});
});
