import { ConsoleLogger } from '@geekmidas/logger/console';
import { describe, expect, it } from 'vitest';
import { runWithRequestContext, serviceContext } from '../context';

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

			it('should return logger inside request context', async () => {
				await runWithRequestContext(
					{ logger, requestId: 'test-id', startTime: Date.now() },
					async () => {
						expect(serviceContext.getLogger()).toBe(logger);
					},
				);
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
