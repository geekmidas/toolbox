import { ConsoleLogger } from '@geekmidas/logger/console';
import type { Service } from '@geekmidas/services';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ConstructType } from '../../Construct';
import { Cron, type ScheduleExpression } from '../Cron';
import { CronBuilder } from '../CronBuilder';

// Mock service for testing
class MockService implements Service<'MockService', MockService> {
	serviceName = 'MockService' as const;

	async register() {
		return this;
	}

	getValue() {
		return 'mock-value';
	}
}

describe('Cron', () => {
	describe('Cron class', () => {
		it('should create a Cron instance with basic handler', () => {
			const handler = vi.fn().mockResolvedValue({ success: true });
			const cron = new Cron(handler);

			expect(cron).toBeInstanceOf(Cron);
			expect(cron.type).toBe(ConstructType.Cron);
			expect(cron.timeout).toBe(30000); // Default timeout
			// The handler is stored in the protected fn property
		});

		it('should create a Cron instance with timeout', () => {
			const handler = vi.fn().mockResolvedValue({ data: 'test' });
			const timeout = 60000;
			const cron = new Cron(handler, timeout);

			expect(cron.timeout).toBe(timeout);
		});

		it('should create a Cron instance with schedule expression', () => {
			const handler = vi.fn();
			const schedule: ScheduleExpression = 'cron(0 12 * * MON)';
			const cron = new Cron(handler, undefined, schedule);

			expect(cron).toBeInstanceOf(Cron);
			expect(cron.type).toBe(ConstructType.Cron);
			// Schedule is protected, so we can't directly test it, but it should be set
		});

		it('should create a Cron instance with input schema', () => {
			const inputSchema = z.object({
				id: z.string(),
				count: z.number(),
			});

			const handler = vi.fn().mockImplementation(async ({ input }) => {
				return { processed: input.id };
			});

			const cron = new Cron(handler, undefined, undefined, inputSchema);

			expect(cron).toBeInstanceOf(Cron);
			expect(cron.input).toBe(inputSchema);
		});

		it('should create a Cron instance with output schema', () => {
			const outputSchema = z.object({
				result: z.string(),
				timestamp: z.number(),
			});

			const handler = vi.fn().mockResolvedValue({
				result: 'success',
				timestamp: Date.now(),
			});

			const cron = new Cron(
				handler,
				undefined,
				undefined,
				undefined,
				outputSchema,
			);

			expect(cron).toBeInstanceOf(Cron);
			expect(cron.outputSchema).toBe(outputSchema);
		});

		it('should create a Cron instance with services', () => {
			const mockService = new MockService();
			const services = [mockService];

			const handler = vi.fn().mockImplementation(async ({ services }) => {
				return { value: services.MockService.getValue() };
			});

			const cron = new Cron(
				handler,
				undefined,
				undefined,
				undefined,
				undefined,
				services,
			);

			expect(cron).toBeInstanceOf(Cron);
			expect(cron.services).toEqual(services);
		});

		it('should create a Cron instance with custom logger', () => {
			const customLogger = new ConsoleLogger();

			const handler = vi.fn().mockImplementation(async ({ logger }) => {
				logger.info('Cron executed');
				return { logged: true };
			});

			const cron = new Cron(
				handler,
				undefined,
				undefined,
				undefined,
				undefined,
				[],
				customLogger,
			);

			expect(cron).toBeInstanceOf(Cron);
			expect(cron.logger).toBe(customLogger);
		});

		it('should create a Cron with all parameters', () => {
			const inputSchema = z.object({ name: z.string() });
			const outputSchema = z.object({ greeting: z.string() });
			const schedule: ScheduleExpression = 'cron(*/5 * * * *)';
			const timeout = 60000;
			const service = new MockService();
			const logger = new ConsoleLogger();

			const handler = vi
				.fn()
				.mockImplementation(async ({ input, services }) => {
					return {
						greeting: `Hello ${input.name} from ${services.MockService.getValue()}`,
					};
				});

			const cron = new Cron(
				handler,
				timeout,
				schedule,
				inputSchema,
				outputSchema,
				[service],
				logger,
			);

			expect(cron).toBeInstanceOf(Cron);
			expect(cron.type).toBe(ConstructType.Cron);
			expect(cron.timeout).toBe(timeout);
			expect(cron.input).toBe(inputSchema);
			expect(cron.outputSchema).toBe(outputSchema);
			expect(cron.services).toEqual([service]);
			expect(cron.logger).toBe(logger);
		});
	});

	describe('Cron.isCron', () => {
		it('should return true for Cron instances', () => {
			const cron = new Cron(vi.fn());
			expect(Cron.isCron(cron)).toBe(true);
		});

		it('should return false for non-Cron objects', () => {
			expect(Cron.isCron({})).toBe(false);
			expect(Cron.isCron(null)).toBeFalsy();
			expect(Cron.isCron(undefined)).toBeFalsy();
			expect(Cron.isCron('string')).toBe(false);
			expect(Cron.isCron(123)).toBe(false);
			expect(Cron.isCron([])).toBe(false);
		});

		it('should return false for objects with similar structure', () => {
			const fakeCron = {
				__IS_FUNCTION__: true,
				type: 'SomethingElse',
			};
			expect(Cron.isCron(fakeCron)).toBe(false);
		});

		it('should return false for objects with __IS_FUNCTION__ but wrong type', () => {
			const fakeFunction = {
				__IS_FUNCTION__: true,
				type: ConstructType.Function,
			};
			expect(Cron.isCron(fakeFunction)).toBe(false);
		});
	});

	describe('CronBuilder', () => {
		it('should create a CronBuilder instance', () => {
			const builder = new CronBuilder();
			expect(builder).toBeInstanceOf(CronBuilder);
		});

		it('should set schedule with schedule() method', () => {
			const builder = new CronBuilder();
			const schedule: ScheduleExpression = 'cron(0 0 * * SUN)';

			const result = builder.schedule(schedule);

			// A new builder carrying the schedule, so the base it came from stays
			// clean for the next cron built off it.
			expect(result).toBeInstanceOf(CronBuilder);
			expect(result).not.toBe(builder);
			expect((result as any)._schedule).toBe(schedule);
		});

		it('should build Cron with handle() method', () => {
			const builder = new CronBuilder();
			const handler = vi.fn().mockResolvedValue({ done: true });

			const cron = builder.handle(handler);

			expect(cron).toBeInstanceOf(Cron);
			expect(cron.type).toBe(ConstructType.Cron);
		});

		it('should build Cron with full builder chain', () => {
			const inputSchema = z.object({ task: z.string() });
			const outputSchema = z.object({ completed: z.boolean() });
			const schedule: ScheduleExpression = 'cron(0 * * * *)';
			const service = new MockService();
			const logger = new ConsoleLogger();

			const handler = vi.fn().mockImplementation(async ({ input }) => {
				return { completed: input.task === 'test' };
			});

			const cron = new CronBuilder()
				.input(inputSchema)
				.output(outputSchema)
				.services([service])
				.logger(logger)
				.timeout(45000)
				.schedule(schedule)
				.handle(handler);

			expect(cron).toBeInstanceOf(Cron);
			expect(cron.type).toBe(ConstructType.Cron);
			expect(cron.timeout).toBe(45000);
			expect(cron.input).toBe(inputSchema);
			expect(cron.outputSchema).toBe(outputSchema);
			expect(cron.services).toEqual([service]);
			expect(cron.logger).toBe(logger);
		});

		it('should support method chaining in any order', () => {
			const builder = new CronBuilder();
			const schedule: ScheduleExpression = 'cron(30 2 * * TUE)';

			const chained = builder
				.timeout(30000)
				.schedule(schedule)
				.input(z.object({ data: z.string() }));

			expect(chained).toBeInstanceOf(CronBuilder);
			expect(chained).not.toBe(builder);
			expect((chained as any)._schedule).toBe(schedule);
			expect((chained as any)._timeout).toBe(30000);
		});
	});

	describe('Schedule Expression Types', () => {
		it('accepts Unix and AWS literals and rejects invalid ones', () => {
			const c = new CronBuilder();

			c.schedule('cron(0 8 * * *)');
			c.schedule('cron(0 9 * * MON-FRI)');
			c.schedule('cron(0 9 1 * MON)');
			c.schedule('cron(0 0 * * 7)');
			c.schedule('cron(0 8 * * ? *)');
			c.schedule('cron(0 9 ? * MON-FRI *)');
			c.schedule('cron(0 9 L * ? *)');
			c.schedule('cron(0 9 15W * ? *)');
			c.schedule('cron(0 9 ? * 6#3 *)');
			c.schedule('cron(0 9 ? * FRIL 2026-2027)');

			// @ts-expect-error 4 fields
			c.schedule('cron(0 8 * *)');
			// @ts-expect-error 7 fields
			c.schedule('cron(0 0 8 * * ? *)');
			// @ts-expect-error `?` is AWS, not Unix
			c.schedule('cron(0 8 * * ?)');
			// @ts-expect-error AWS needs `?` in one day field
			c.schedule('cron(0 8 * * * *)');
			// @ts-expect-error AWS with `?` in both day fields
			c.schedule('cron(0 8 ? * ? *)');
			// @ts-expect-error AWS with both day fields restricted
			c.schedule('cron(0 9 1 * MON *)');
			// @ts-expect-error AWS day-of-week is 1-7
			c.schedule('cron(0 9 ? * 0 *)');
			// @ts-expect-error hour 25
			c.schedule('cron(0 25 * * *)');
			// @ts-expect-error minute 60
			c.schedule('cron(60 * * * ? *)');
			// @ts-expect-error `L` is AWS only
			c.schedule('cron(0 9 L * *)');
			// @ts-expect-error rate() is not supported
			c.schedule('rate(1 day)');
			// @ts-expect-error double space
			c.schedule('cron(0  8 * * *)');
			// @ts-expect-error not a month
			c.schedule('cron(0 8 * FOO *)');
			// @ts-expect-error a year before 1970
			c.schedule('cron(0 8 * * ? 1969)');
			// @ts-expect-error a plain string needs a cast
			c.schedule('cron(0 8 * * *)' as string);
			// A runtime schedule cast to ScheduleExpression is checked at build.
			c.schedule('cron(0 8 * * *)' as ScheduleExpression);
		});
	});

	describe('Cron configuration', () => {
		it('should store handler with error handling capability', () => {
			const error = new Error('Cron execution failed');
			const handler = vi.fn().mockRejectedValue(error);

			const cron = new Cron(handler);

			expect(cron).toBeInstanceOf(Cron);
			// Handler is stored but not directly accessible (protected)
		});

		it('should store input schema for validation', () => {
			const inputSchema = z.object({
				id: z.string().uuid(),
				amount: z.number().positive(),
			});

			const handler = vi.fn();
			const cron = new Cron(handler, undefined, undefined, inputSchema);

			expect(cron.input).toBe(inputSchema);
		});

		it('should store output schema for validation', () => {
			const outputSchema = z.object({
				status: z.enum(['success', 'failure']),
				count: z.number().int(),
			});

			const handler = vi.fn().mockResolvedValue({
				status: 'invalid',
				count: 3.14,
			});

			const cron = new Cron(
				handler,
				undefined,
				undefined,
				undefined,
				outputSchema,
			);

			expect(cron.outputSchema).toBe(outputSchema);
		});

		it('should work with multiple services', () => {
			class ServiceA implements Service<'ServiceA', ServiceA> {
				serviceName = 'ServiceA' as const;
				async register() {
					return this;
				}
				getA() {
					return 'A';
				}
			}

			class ServiceB implements Service<'ServiceB', ServiceB> {
				serviceName = 'ServiceB' as const;
				async register() {
					return this;
				}
				getB() {
					return 'B';
				}
			}

			const services = [new ServiceA(), new ServiceB()];

			const handler = vi.fn().mockImplementation(async ({ services }) => {
				return {
					a: services.ServiceA.getA(),
					b: services.ServiceB.getB(),
				};
			});

			const cron = new Cron(
				handler,
				undefined,
				undefined,
				undefined,
				undefined,
				services,
			);

			expect(cron.services).toEqual(services);
		});

		it('should maintain separate instances with different configurations', () => {
			const handler1 = vi.fn().mockResolvedValue({ cron: 1 });
			const handler2 = vi.fn().mockResolvedValue({ cron: 2 });

			const cron1 = new CronBuilder()
				.timeout(1000)
				.schedule('cron(*/5 * * * *)')
				.handle(handler1);

			const cron2 = new CronBuilder()
				.timeout(2000)
				.schedule('cron(0 0 * * *)')
				.handle(handler2);

			expect(cron1).toBeInstanceOf(Cron);
			expect(cron2).toBeInstanceOf(Cron);
			expect(cron1.timeout).toBe(1000);
			expect(cron2.timeout).toBe(2000);
			expect(cron1).not.toBe(cron2);
		});
	});
});
