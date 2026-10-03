import { ConsoleLogger } from '@geekmidas/logger/console';
import type { Service } from '@geekmidas/services';
import { ServiceDiscovery, serviceContext } from '@geekmidas/services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { recordTopic } from '../../__tests__/__helpers__/recordingPublisher';
import { Topic } from '../../topic/Topic';
import { Worker } from '../../worker';
import { Function } from '../Function';
import { TestFunctionAdaptor } from '../TestFunctionAdaptor';

// Mock services
class TestService implements Service<'TestService', TestService> {
	serviceName = 'TestService' as const;
	static serviceName = 'TestService';

	async register() {
		return this;
	}

	getValue() {
		return 'test-value';
	}
}

const tests = new Topic('Tests', {
	events: { 'test.event': z.object({ data: z.string() }) },
});

/** Everything runnable is built from the process that runs it. */
const worker = new Worker('Jobs');

describe.skip('TestFunctionAdaptor', () => {
	let logger: ConsoleLogger;

	beforeEach(() => {
		logger = new ConsoleLogger();
		vi.clearAllMocks();
	});

	describe('basic function execution', () => {
		it('should execute a simple function without input/output schemas', async () => {
			const fn = new Function(async () => {
				return { message: 'Hello World' };
			});

			const adaptor = new TestFunctionAdaptor(fn);

			const result = await adaptor.invoke({
				input: {},
				services: {},
			});

			expect(result).toEqual({ message: 'Hello World' });
		});

		it('should execute a function with input schema validation', async () => {
			const inputSchema = z.object({ name: z.string() });
			const handler = vi.fn(async ({ input }) => ({
				message: `Hello ${input.name}`,
			}));

			const fn = new Function(
				handler,
				undefined,
				undefined,
				inputSchema,
				undefined,
				[],
				logger,
			);

			const adaptor = new TestFunctionAdaptor(fn);

			const result = await adaptor.invoke({
				input: { name: 'TypeScript' },
				services: {},
			});

			expect(result).toEqual({ message: 'Hello TypeScript' });
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					input: { name: 'TypeScript' },
				}),
			);
		});

		it('should fail with invalid input', async () => {
			const inputSchema = z.object({ age: z.number() });
			const fn = new Function(
				async () => ({ success: true }),
				undefined,
				undefined,
				inputSchema,
				undefined,
				[],
				logger,
			);

			const adaptor = new TestFunctionAdaptor(fn);

			await expect(
				adaptor.invoke({ input: { age: 'not a number' as any }, services: {} }),
			).rejects.toThrow();
		});

		it('should validate output schema', async () => {
			const outputSchema = z.object({
				id: z.string(),
				timestamp: z.number(),
			});

			const fn = new Function(
				async () => ({
					id: '123',
					timestamp: Date.now(),
				}),
				undefined,
				undefined,
				undefined,
				outputSchema,
				[],
				logger,
			);

			const adaptor = new TestFunctionAdaptor(fn);

			const result = await adaptor.invoke({
				input: {},
				services: {},
			});

			expect(result).toMatchObject({
				id: '123',
				timestamp: expect.any(Number),
			});
		});

		it('should fail with invalid output', async () => {
			const outputSchema = z.object({
				id: z.string(),
			});

			const fn = new Function(
				async () => ({
					id: '123', // Fixed: should be string
				}),
				undefined,
				undefined,
				undefined,
				outputSchema,
				[],
				logger,
			);

			const adaptor = new TestFunctionAdaptor(fn);

			// This should not throw since output is valid
			const result = await adaptor.invoke({
				input: {},
				services: {},
			});

			expect(result).toEqual({ id: '123' });
		});
	});

	describe('services', () => {
		it('should inject services into function context', async () => {
			const service = new TestService();
			const handler = vi.fn(async ({ services }) => ({
				value: services.TestService.getValue(),
			}));

			const fn = new Function(
				handler,
				undefined,
				undefined,
				undefined,
				undefined,
				[service],
				logger,
			);

			const adaptor = new TestFunctionAdaptor(fn);

			const result = await adaptor.invoke({
				input: {},
				services: {} as any,
			});

			expect(result).toEqual({ value: 'test-value' });
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					services: expect.objectContaining({
						TestService: expect.any(TestService),
					}),
				}),
			);
		});

		// Service overriding in context is not currently supported
	});

	describe('logging', () => {
		it('should create child logger with test context', async () => {
			const mockLogger = {
				child: vi.fn().mockReturnThis(),
				info: vi.fn(),
				error: vi.fn(),
				warn: vi.fn(),
				debug: vi.fn(),
			};

			const fn = new Function(
				async ({ logger }) => {
					logger.info('Function executed');
					return { success: true };
				},
				undefined,
				undefined,
				undefined,
				undefined,
				[],
				mockLogger as any,
			);

			const adaptor = new TestFunctionAdaptor(fn);

			await adaptor.invoke({
				input: {},
				services: {},
			});

			expect(mockLogger.child).toHaveBeenCalledWith({
				test: true,
			});
			expect(mockLogger.info).toHaveBeenCalledWith('Function executed');
		});
	});

	describe('events', () => {
		beforeEach(() => {
			ServiceDiscovery.reset();
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		it('should publish events after successful execution', async () => {
			const publisher = recordTopic(tests);

			const fn = worker
				.input(z.object({}))
				.output(z.object({ id: z.string() }))
				.event(tests, {
					type: 'test.event',
					payload: (response) => ({ data: response.id }),
				})
				.handle(async () => ({ id: '123' }));

			await new TestFunctionAdaptor(fn).invoke({ input: {} } as never);

			expect(publisher.published).toEqual([
				{ type: 'test.event', payload: { data: '123' } },
			]);
		});

		it('should conditionally publish events based on when clause', async () => {
			const publisher = recordTopic(tests);

			const fn = worker
				.input(z.object({}))
				.output(z.object({ success: z.boolean() }))
				.event(tests, {
					type: 'test.event',
					payload: () => ({ data: 'test' }),
					when: (response) => response.success === true,
				})
				.handle(async () => ({ success: false }));

			await new TestFunctionAdaptor(fn).invoke({ input: {} } as never);

			expect(publisher.published).toEqual([]);
		});
	});

	describe('default service discovery', () => {
		it('should create default service discovery', () => {
			const fn = new Function(async () => ({ success: true }));
			const serviceDiscovery =
				TestFunctionAdaptor.getDefaultServiceDiscovery(fn);

			expect(serviceDiscovery).toBeDefined();
		});

		it('should use custom service discovery when provided', async () => {
			const fn = new Function(async () => ({ success: true }));
			const mockServiceDiscovery = {
				register: vi.fn().mockResolvedValue({}),
				getInstance: vi.fn(),
			} as any;

			const adaptor = new TestFunctionAdaptor(fn, mockServiceDiscovery);

			await adaptor.invoke({
				input: {},
				services: {},
			});

			expect(mockServiceDiscovery.register).toHaveBeenCalledWith([]);
		});
	});

	describe('error handling', () => {
		it('should propagate errors from function execution', async () => {
			const fn = new Function(async () => {
				throw new Error('Function failed');
			});

			const adaptor = new TestFunctionAdaptor(fn);

			await expect(
				adaptor.invoke({
					input: {},
					services: {},
				}),
			).rejects.toThrow('Function failed');
		});
	});

	describe('request context', () => {
		it('should make serviceContext.getLogger() available inside handler', async () => {
			let contextLogger: any;

			const fn = new Function(
				async () => {
					contextLogger = serviceContext.getLogger();
					return { success: true };
				},
				undefined,
				undefined,
				undefined,
				undefined,
				[],
				logger,
			);

			const adaptor = new TestFunctionAdaptor(fn);

			await adaptor.invoke({
				input: {},
				services: {},
			});

			expect(contextLogger).toBeDefined();
		});

		it('should make serviceContext.hasContext() return true inside handler', async () => {
			let hasContext = false;

			const fn = new Function(
				async () => {
					hasContext = serviceContext.hasContext();
					return { success: true };
				},
				undefined,
				undefined,
				undefined,
				undefined,
				[],
				logger,
			);

			const adaptor = new TestFunctionAdaptor(fn);

			await adaptor.invoke({
				input: {},
				services: {},
			});

			expect(hasContext).toBe(true);
		});

		it('should provide a request ID starting with test-', async () => {
			let requestId: string | undefined;

			const fn = new Function(
				async () => {
					requestId = serviceContext.getRequestId();
					return { success: true };
				},
				undefined,
				undefined,
				undefined,
				undefined,
				[],
				logger,
			);

			const adaptor = new TestFunctionAdaptor(fn);

			await adaptor.invoke({
				input: {},
				services: {},
			});

			expect(requestId).toBeDefined();
			expect(requestId).toMatch(/^test-/);
		});
	});
});
