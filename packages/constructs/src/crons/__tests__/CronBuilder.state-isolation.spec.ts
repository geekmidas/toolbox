import { ConsoleLogger } from '@geekmidas/logger/console';
import type { Service } from '@geekmidas/services';
import { describe, expect, it } from 'vitest';
import { CronBuilder } from '../CronBuilder';

const ServiceA = {
	serviceName: 'a' as const,
	async register() {
		return { test: () => 'a' };
	},
} satisfies Service<'a', any>;

const ServiceB = {
	serviceName: 'b' as const,
	async register() {
		return { test: () => 'b' };
	},
} satisfies Service<'b', any>;

const customLogger = new ConsoleLogger({ app: 'reusable-base' });

describe('CronBuilder - State Isolation', () => {
	describe('singleton instance state reset', () => {
		it('should reset services after handle() is called', () => {
			const c = new CronBuilder();

			// First cron with ServiceA and ServiceB
			const cron1 = c
				.schedule('rate(5 minutes)')
				.services([ServiceA, ServiceB])
				.handle(async () => ({}));

			// Second cron should not have any services from first
			const cron2 = c.schedule('rate(10 minutes)').handle(async () => ({}));

			expect(cron1.services.map((s) => s.serviceName)).toEqual(['a', 'b']);
			expect(cron2.services.map((s) => s.serviceName)).toEqual([]);
		});

		it('should reset logger after handle() is called', () => {
			const c = new CronBuilder();
			const customLogger = new ConsoleLogger({ app: 'custom' });

			// First cron with custom logger
			const cron1 = c
				.schedule('rate(5 minutes)')
				.logger(customLogger)
				.handle(async () => ({}));

			// Second cron should have default logger (not the custom one)
			const cron2 = c.schedule('rate(10 minutes)').handle(async () => ({}));

			expect(cron1.logger).toBe(customLogger);
			expect(cron2.logger).not.toBe(customLogger);
			expect(cron2.logger).toBeInstanceOf(ConsoleLogger);
		});

		it('should reset schedule after handle() is called', () => {
			const c = new CronBuilder();

			// First cron with schedule
			const cron1 = c.schedule('rate(5 minutes)').handle(async () => ({}));

			// Second cron should not have schedule from first
			const cron2 = c.schedule('rate(10 minutes)').handle(async () => ({}));

			expect(cron1.schedule).toBe('rate(5 minutes)');
			expect(cron2.schedule).toBe('rate(10 minutes)');

			// Check internal state is reset
			expect((c as any)._schedule).toBeUndefined();
		});

		it('should reset events after handle() is called', () => {
			const c = new CronBuilder();

			// Create first cron (events array should be empty initially)
			const _cron1 = c.schedule('rate(5 minutes)').handle(async () => ({}));

			// Verify state was reset
			expect((c as any)._events).toEqual([]);
			expect((c as any)._services).toEqual([]);
			expect((c as any)._schedule).toBeUndefined();
		});

		it('should reset input/output schemas after handle() is called', () => {
			const c = new CronBuilder();
			const inputSchema: any = { '~standard': { validate: () => ({}) } };
			const outputSchema: any = { '~standard': { validate: () => ({}) } };

			// First cron with schemas
			const cron1 = c
				.schedule('rate(5 minutes)')
				.input(inputSchema)
				.output(outputSchema)
				.handle(async () => ({}));

			// Second cron should not have schemas
			const cron2 = c.schedule('rate(10 minutes)').handle(async () => ({}));

			expect(cron1.input).toBe(inputSchema);
			expect(cron1.outputSchema).toBe(outputSchema);
			expect(cron2.input).toBeUndefined();
			expect(cron2.outputSchema).toBeUndefined();
		});

		it('should reset timeout after handle() is called', () => {
			const c = new CronBuilder();

			// First cron with custom timeout
			const cron1 = c
				.schedule('rate(5 minutes)')
				.timeout(5000)
				.handle(async () => ({}));

			// Second cron should have default timeout (30000)
			const cron2 = c.schedule('rate(10 minutes)').handle(async () => ({}));

			expect(cron1.timeout).toBe(5000);
			expect(cron2.timeout).toBe(30000); // Default timeout
		});
	});

	describe('method chaining before handle()', () => {
		it('should accumulate services when chaining', () => {
			const c = new CronBuilder();

			const cron = c
				.schedule('rate(5 minutes)')
				.services([ServiceA])
				.services([ServiceB])
				.handle(async () => ({}));

			expect(cron.services.map((s) => s.serviceName)).toEqual(['a', 'b']);
		});

		it('should not share references between different builder chains', () => {
			const c = new CronBuilder();

			// Two chains off one base. They used to be the *same object* — every
			// method mutated the base and returned it — so chain 1's function came
			// out holding chain 2's services as well, and the base only survived
			// because `.handle()` wiped it afterwards. That wipe is also what made
			// a configured base unusable twice.
			const builder1 = c.services([ServiceA]);
			const builder2 = c.services([ServiceB]);

			expect(builder1).not.toBe(builder2);
			expect(builder1).not.toBe(c);

			const fn1 = builder1.handle(async () => ({}));
			const fn2 = builder2.handle(async () => ({}));

			// Each function gets exactly what its own chain declared.
			expect(fn1.services.map((s) => s.serviceName)).toEqual(['a']);
			expect(fn2.services.map((s) => s.serviceName)).toEqual(['b']);

			// And the base is untouched, so it stays reusable.
			expect((c as any)._services).toEqual([]);
		});
	});

	describe('sequential cron creation', () => {
		it('should create independent crons sequentially', () => {
			const c = new CronBuilder();

			const cron1 = c
				.schedule('rate(5 minutes)')
				.services([ServiceA, ServiceB])
				.handle(async () => ({ result: 1 }));

			const cron2 = c
				.schedule('rate(10 minutes)')
				.services([ServiceA])
				.handle(async () => ({ result: 2 }));

			const cron3 = c
				.schedule('rate(15 minutes)')
				.handle(async () => ({ result: 3 }));

			expect(cron1.services.map((s) => s.serviceName)).toEqual(['a', 'b']);
			expect(cron1.schedule).toBe('rate(5 minutes)');

			expect(cron2.services.map((s) => s.serviceName)).toEqual(['a']);
			expect(cron2.schedule).toBe('rate(10 minutes)');

			expect(cron3.services.map((s) => s.serviceName)).toEqual([]);
			expect(cron3.schedule).toBe('rate(15 minutes)');
		});
	});

	describe('publisher isolation', () => {
		it('should reset publisher after handle() is called', () => {
			const c = new CronBuilder();
			const mockPublisher: any = {
				serviceName: 'publisher',
				async register() {
					return { publish: () => {} };
				},
			};

			const cron1 = c
				.schedule('rate(5 minutes)')
				.publisher(mockPublisher)
				.handle(async () => ({}));

			const cron2 = c.schedule('rate(10 minutes)').handle(async () => ({}));

			expect((cron1 as any).publisherService).toBe(mockPublisher);
			expect((cron2 as any).publisherService).toBeUndefined();
		});
	});

	describe('cron expression types', () => {
		it('should handle different schedule expression formats', () => {
			const c = new CronBuilder();

			const cron1 = c.schedule('rate(5 minutes)').handle(async () => ({}));
			const cron2 = c.schedule('cron(0 12 * * ? *)').handle(async () => ({}));
			const cron3 = c.schedule('rate(1 hour)').handle(async () => ({}));

			expect(cron1.schedule).toBe('rate(5 minutes)');
			expect(cron2.schedule).toBe('cron(0 12 * * ? *)');
			expect(cron3.schedule).toBe('rate(1 hour)');
		});
	});

	describe('a configured base, reused', () => {
		it('carries its configuration into every cron built from it', () => {
			const base = new CronBuilder()
				.logger(customLogger)
				.timeout(60_000)
				.schedule('rate(1 day)');

			const first = base.services([ServiceA]).handle(async () => ({}));
			const second = base.services([ServiceB]).handle(async () => ({}));

			// The point of the whole shape: `const base = c.logger(log)` is a base you
			// can keep. It used to survive exactly one `.handle()` — the reset put
			// the logger and the timeout back to their defaults — so the second
			// cron built from it silently logged somewhere else and timed out
			// on a different clock.
			for (const built of [first, second]) {
				expect(built.logger).toBe(customLogger);
				expect(built.timeout).toBe(60_000);
			}

			// And each still gets only what its own chain declared.
			expect(first.services.map((s) => s.serviceName)).toEqual(['a']);
			expect(second.services.map((s) => s.serviceName)).toEqual(['b']);
		});

		it('persists configuration when handle() is called on the base itself', () => {
			const base = new CronBuilder()
				.logger(customLogger)
				.timeout(60_000)
				.schedule('rate(1 day)');

			// No clone in between: `.handle()` is called straight on the base,
			// twice. Cloning the config methods was not enough on its own —
			// `.handle()` still ran a reset block that wiped whatever it was
			// called on, so the second cron came back on the default logger and
			// the default timeout.
			const first = base.handle(async () => ({}));
			const second = base.handle(async () => ({}));

			for (const built of [first, second]) {
				expect(built.logger).toBe(customLogger);
				expect(built.timeout).toBe(60_000);
			}
		});
	});
});
