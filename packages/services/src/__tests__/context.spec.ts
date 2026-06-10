import type { Logger } from '@geekmidas/logger';
import { ConsoleLogger } from '@geekmidas/logger/console';
import { describe, expect, it, vi } from 'vitest';
import { runWithRequestContext, serviceContext } from '../context';

/** Minimal spy logger whose `child()` returns itself for easy assertions. */
function makeSpyLogger(): Logger {
	const logger: Logger = {
		trace: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn(() => logger),
	};
	return logger;
}

/**
 * A logger that carries MORE than the base `Logger` interface: an extra method
 * (`flush`) and a data property (`level`). Models a richer real-world logger
 * (e.g. pino) so we can assert the request-scoped proxy forwards the full
 * surface, not just the known log methods.
 */
type ExtendedLogger = Logger & {
	flush: ReturnType<typeof vi.fn>;
	level: string;
};

function makeExtendedSpyLogger(level = 'info'): ExtendedLogger {
	const logger = makeSpyLogger() as ExtendedLogger;
	logger.flush = vi.fn();
	logger.level = level;
	return logger;
}

describe('Request Context', () => {
	const logger = new ConsoleLogger({ app: 'test' });

	describe('serviceContext', () => {
		describe('hasContext', () => {
			it('should return false outside request context', () => {
				expect(serviceContext.hasContext()).toBe(false);
			});

			it('should return true inside request context', async () => {
				await runWithRequestContext(
					{ logger, requestId: 'test-id', startTime: Date.now() },
					async () => {
						expect(serviceContext.hasContext()).toBe(true);
					},
				);
			});
		});

		describe('getLogger', () => {
			it('should throw outside request context', () => {
				expect(() => serviceContext.getLogger()).toThrow(
					'ServiceContext.getLogger() called outside request context',
				);
			});

			it('should delegate to the current request logger', async () => {
				const requestLogger = makeSpyLogger();
				await runWithRequestContext(
					{
						logger: requestLogger,
						requestId: 'test-id',
						startTime: Date.now(),
					},
					async () => {
						serviceContext.getLogger().info('hello');
					},
				);
				expect(requestLogger.info).toHaveBeenCalledWith('hello');
			});

			it('captured-once logger follows each request (singleton service fix)', async () => {
				// Mimic a singleton service that grabs the logger ONCE (during its
				// one-time register) and reuses that reference for every request.
				let captured: Logger | undefined;
				const handle = (requestLogger: Logger) =>
					runWithRequestContext(
						{ logger: requestLogger, requestId: 'r', startTime: Date.now() },
						async () => {
							captured ??= serviceContext.getLogger();
							captured.info('handled');
						},
					);

				const first = makeSpyLogger();
				const second = makeSpyLogger();
				await handle(first);
				await handle(second);

				// Before the fix, the captured logger stayed bound to `first`, so
				// `second` never saw the call.
				expect(first.info).toHaveBeenCalledTimes(1);
				expect(second.info).toHaveBeenCalledTimes(1);
			});

			it('child loggers also follow the current request', async () => {
				let capturedChild: Logger | undefined;
				const handle = (requestLogger: Logger) =>
					runWithRequestContext(
						{ logger: requestLogger, requestId: 'r', startTime: Date.now() },
						async () => {
							capturedChild ??= serviceContext
								.getLogger()
								.child({ scope: 'svc' });
							capturedChild.info('scoped');
						},
					);

				const first = makeSpyLogger();
				const second = makeSpyLogger();
				await handle(first);
				await handle(second);

				expect(first.child).toHaveBeenCalledWith({ scope: 'svc' });
				expect(second.child).toHaveBeenCalledWith({ scope: 'svc' });
				expect(first.info).toHaveBeenCalledWith('scoped');
				expect(second.info).toHaveBeenCalledWith('scoped');
			});

			describe('forwards the full logger surface (logger with more)', () => {
				it('forwards an extra method beyond the Logger interface', async () => {
					const requestLogger = makeExtendedSpyLogger();
					await runWithRequestContext(
						{ logger: requestLogger, requestId: 'r', startTime: Date.now() },
						async () => {
							(serviceContext.getLogger() as ExtendedLogger).flush();
						},
					);
					expect(requestLogger.flush).toHaveBeenCalledTimes(1);
				});

				it('re-resolves an extra method per request when captured once', async () => {
					let captured: ExtendedLogger | undefined;
					const handle = (requestLogger: Logger) =>
						runWithRequestContext(
							{ logger: requestLogger, requestId: 'r', startTime: Date.now() },
							async () => {
								captured ??= serviceContext.getLogger() as ExtendedLogger;
								captured.flush();
							},
						);

					const first = makeExtendedSpyLogger();
					const second = makeExtendedSpyLogger();
					await handle(first);
					await handle(second);

					expect(first.flush).toHaveBeenCalledTimes(1);
					expect(second.flush).toHaveBeenCalledTimes(1);
				});

				it('forwards a data property as the current request logger value', async () => {
					const captureLevel = (requestLogger: Logger) =>
						runWithRequestContext(
							{ logger: requestLogger, requestId: 'r', startTime: Date.now() },
							async () => (serviceContext.getLogger() as ExtendedLogger).level,
						);

					const debugLogger = makeExtendedSpyLogger('debug');
					const warnLogger = makeExtendedSpyLogger('warn');

					expect(await captureLevel(debugLogger)).toBe('debug');
					expect(await captureLevel(warnLogger)).toBe('warn');
				});

				it('detached method reference still targets the current request', async () => {
					const requestLogger = makeExtendedSpyLogger();
					await runWithRequestContext(
						{ logger: requestLogger, requestId: 'r', startTime: Date.now() },
						async () => {
							const { info } = serviceContext.getLogger();
							info('detached');
						},
					);
					expect(requestLogger.info).toHaveBeenCalledWith('detached');
				});

				it('invokes log methods with the logger as `this` (pino receiver)', async () => {
					// Real pino reads internal state off the receiver, e.g.
					// `this[Symbol(pino.msgPrefix)]`. A logger whose methods depend
					// on `this` must still work through the proxy — calling them
					// unbound throws "Cannot read properties of undefined".
					const received: unknown[] = [];
					const requestLogger = {
						secret: 'pino-state',
						info(this: { secret: string }, msg: string) {
							// Throws if `this` is undefined (the original bug).
							received.push(`${this.secret}:${msg}`);
						},
						child() {
							return requestLogger;
						},
					} as unknown as Logger;

					await runWithRequestContext(
						{ logger: requestLogger, requestId: 'r', startTime: Date.now() },
						async () => {
							// Both direct and detached calls must keep the receiver.
							serviceContext.getLogger().info('direct');
							const { info } = serviceContext.getLogger();
							info('detached');
						},
					);

					expect(received).toEqual([
						'pino-state:direct',
						'pino-state:detached',
					]);
				});

				it('reflects underlying membership via the `in` operator', async () => {
					const requestLogger = makeExtendedSpyLogger();
					await runWithRequestContext(
						{ logger: requestLogger, requestId: 'r', startTime: Date.now() },
						async () => {
							const proxy = serviceContext.getLogger();
							expect('flush' in proxy).toBe(true);
							expect('child' in proxy).toBe(true);
							expect('nope' in proxy).toBe(false);
						},
					);
				});

				it('is not thenable (safe to return from async / await)', async () => {
					await runWithRequestContext(
						{
							logger: makeExtendedSpyLogger(),
							requestId: 'r',
							startTime: Date.now(),
						},
						async () => {
							const proxy = serviceContext.getLogger();
							expect((proxy as { then?: unknown }).then).toBeUndefined();
							// Awaiting a non-thenable yields the value itself rather than
							// hanging or invoking a spurious `then`.
							expect(await proxy).toBe(proxy);
						},
					);
				});
			});
		});

		describe('getRequestId', () => {
			it('should throw outside request context', () => {
				expect(() => serviceContext.getRequestId()).toThrow(
					'ServiceContext.getRequestId() called outside request context',
				);
			});

			it('should return requestId inside request context', async () => {
				await runWithRequestContext(
					{ logger, requestId: 'my-request-id-123', startTime: Date.now() },
					async () => {
						expect(serviceContext.getRequestId()).toBe('my-request-id-123');
					},
				);
			});
		});

		describe('getRequestStartTime', () => {
			it('should throw outside request context', () => {
				expect(() => serviceContext.getRequestStartTime()).toThrow(
					'ServiceContext.getRequestStartTime() called outside request context',
				);
			});

			it('should return startTime inside request context', async () => {
				const startTime = Date.now();
				await runWithRequestContext(
					{ logger, requestId: 'test-id', startTime },
					async () => {
						expect(serviceContext.getRequestStartTime()).toBe(startTime);
					},
				);
			});
		});
	});

	describe('runWithRequestContext', () => {
		it('should return synchronous value', () => {
			const result = runWithRequestContext(
				{ logger, requestId: 'test-id', startTime: Date.now() },
				() => 'sync-result',
			);

			expect(result).toBe('sync-result');
		});

		it('should return async value', async () => {
			const result = await runWithRequestContext(
				{ logger, requestId: 'test-id', startTime: Date.now() },
				async () => {
					await new Promise((resolve) => setTimeout(resolve, 10));
					return 'async-result';
				},
			);

			expect(result).toBe('async-result');
		});

		it('should provide isolated context per run', async () => {
			const results: string[] = [];

			await Promise.all([
				runWithRequestContext(
					{ logger, requestId: 'request-1', startTime: Date.now() },
					async () => {
						await new Promise((resolve) => setTimeout(resolve, 10));
						results.push(`1:${serviceContext.getRequestId()}`);
					},
				),
				runWithRequestContext(
					{ logger, requestId: 'request-2', startTime: Date.now() },
					async () => {
						await new Promise((resolve) => setTimeout(resolve, 5));
						results.push(`2:${serviceContext.getRequestId()}`);
					},
				),
				runWithRequestContext(
					{ logger, requestId: 'request-3', startTime: Date.now() },
					async () => {
						results.push(`3:${serviceContext.getRequestId()}`);
					},
				),
			]);

			// Each request should have its own isolated context
			expect(results).toContain('1:request-1');
			expect(results).toContain('2:request-2');
			expect(results).toContain('3:request-3');
		});

		it('should propagate context through async operations', async () => {
			const capturedIds: string[] = [];

			async function nestedOperation() {
				// Should still have access to context from parent
				capturedIds.push(serviceContext.getRequestId());
				await new Promise((resolve) => setTimeout(resolve, 1));
				capturedIds.push(serviceContext.getRequestId());
			}

			await runWithRequestContext(
				{ logger, requestId: 'parent-context', startTime: Date.now() },
				async () => {
					capturedIds.push(serviceContext.getRequestId());
					await nestedOperation();
					capturedIds.push(serviceContext.getRequestId());
				},
			);

			// All operations should see the same context
			expect(capturedIds).toEqual([
				'parent-context',
				'parent-context',
				'parent-context',
				'parent-context',
			]);
		});

		it('should handle errors while preserving context', async () => {
			let capturedIdBeforeError: string | undefined;
			let capturedIdInCatch: string | undefined;

			await runWithRequestContext(
				{ logger, requestId: 'error-context', startTime: Date.now() },
				async () => {
					capturedIdBeforeError = serviceContext.getRequestId();
					try {
						throw new Error('Test error');
					} catch {
						capturedIdInCatch = serviceContext.getRequestId();
					}
				},
			);

			expect(capturedIdBeforeError).toBe('error-context');
			expect(capturedIdInCatch).toBe('error-context');
		});

		it('should propagate exceptions', async () => {
			await expect(
				runWithRequestContext(
					{ logger, requestId: 'test-id', startTime: Date.now() },
					async () => {
						throw new Error('Test exception');
					},
				),
			).rejects.toThrow('Test exception');
		});

		it('should allow nested runWithRequestContext calls', async () => {
			const capturedIds: string[] = [];

			await runWithRequestContext(
				{ logger, requestId: 'outer', startTime: Date.now() },
				async () => {
					capturedIds.push(serviceContext.getRequestId());

					// Nested context should override
					await runWithRequestContext(
						{ logger, requestId: 'inner', startTime: Date.now() },
						async () => {
							capturedIds.push(serviceContext.getRequestId());
						},
					);

					// Should return to outer context
					capturedIds.push(serviceContext.getRequestId());
				},
			);

			expect(capturedIds).toEqual(['outer', 'inner', 'outer']);
		});
	});

	describe('Integration with services', () => {
		it('should allow services to access context', async () => {
			// Simulating a service that accesses context
			const myService = {
				getRequestInfo() {
					if (!serviceContext.hasContext()) {
						return null;
					}
					return {
						requestId: serviceContext.getRequestId(),
						startTime: serviceContext.getRequestStartTime(),
					};
				},
			};

			// Outside context
			expect(myService.getRequestInfo()).toBeNull();

			// Inside context
			const startTime = Date.now();
			await runWithRequestContext(
				{ logger, requestId: 'service-request', startTime },
				async () => {
					const info = myService.getRequestInfo();
					expect(info).not.toBeNull();
					expect(info?.requestId).toBe('service-request');
					expect(info?.startTime).toBe(startTime);
				},
			);
		});

		it('should allow logger access for request-scoped logging', async () => {
			const logMessages: string[] = [];
			const requestLogger = new ConsoleLogger({
				app: 'test',
			});

			// Override info method to capture logs
			const originalInfo = requestLogger.info.bind(requestLogger);
			requestLogger.info = (...args: Parameters<typeof requestLogger.info>) => {
				logMessages.push(
					typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0]),
				);
				return originalInfo(...args);
			};

			await runWithRequestContext(
				{
					logger: requestLogger,
					requestId: 'log-test',
					startTime: Date.now(),
				},
				async () => {
					const contextLogger = serviceContext.getLogger();
					contextLogger.info('Request started');
				},
			);

			expect(logMessages).toContain('Request started');
		});
	});
});
