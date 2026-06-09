import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import type { Service } from '@geekmidas/services';
import { ServiceDiscovery, serviceContext } from '@geekmidas/services';
import type { Context } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { AWSScheduledFunction } from '../AWSScheduledFunction';
import { CronBuilder } from '../CronBuilder';

/** Spy logger whose `child()` returns itself, so all log calls land on it. */
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

// Minimal EventBridge scheduled-event envelope (no user payload).
const scheduledEvent = {
	id: 'cdc73f9d-aea9-11e3-9d5a-835b769c0d9c',
	version: '0',
	account: '123456789012',
	time: '2026-06-09T00:00:00Z',
	region: 'us-east-1',
	source: 'aws.events',
	resources: ['arn:aws:events:us-east-1:123456789012:rule/daily'],
	'detail-type': 'Scheduled Event',
	detail: {},
};

const createMockContext = (): Context =>
	({
		functionName: 'cancelPastBookings',
		functionVersion: '1',
		invokedFunctionArn:
			'arn:aws:lambda:us-east-1:123456789012:function:cancelPastBookings',
		memoryLimitInMB: '128',
		awsRequestId: 'test-request-id',
		logGroupName: '/aws/lambda/cancelPastBookings',
		logStreamName: '2026/06/09/[$LATEST]test-stream',
		getRemainingTimeInMillis: () => 30000,
		done: vi.fn(),
		fail: vi.fn(),
		succeed: vi.fn(),
		callbackWaitsForEmptyEventLoop: true,
	}) as unknown as Context;

class CounterService implements Service<'counter', CounterService> {
	serviceName = 'counter' as const;
	count = 0;
	async register() {
		return this;
	}
	increment() {
		this.count += 1;
		return this.count;
	}
}

describe('AWSScheduledFunction', () => {
	let envParser: EnvironmentParser<{}>;

	beforeEach(() => {
		// ServiceDiscovery is a process-wide singleton that caches resolved
		// instances; reset so each test (and ordering) starts clean.
		ServiceDiscovery.reset();
		envParser = new EnvironmentParser({});
		vi.clearAllMocks();
	});

	it('runs the cron handler on a scheduled event', async () => {
		const ran = vi.fn();
		const cron = new CronBuilder().schedule('rate(1 day)').handle(async () => {
			ran();
		});

		const adapter = new AWSScheduledFunction(envParser, cron);
		const result = await adapter.handler(
			scheduledEvent,
			createMockContext(),
			vi.fn(),
		);

		expect(ran).toHaveBeenCalledTimes(1);
		// With no output schema the adaptor returns undefined, matching
		// AWSLambdaFunction — crons typically don't return a response.
		expect(result).toBeUndefined();
	});

	it('parses and returns output when the cron declares an output schema', async () => {
		const cron = new CronBuilder()
			.schedule('rate(1 day)')
			.output(z.object({ cancelled: z.number() }))
			.handle(async () => ({ cancelled: 3 }));

		const adapter = new AWSScheduledFunction(envParser, cron);
		const result = await adapter.handler(
			scheduledEvent,
			createMockContext(),
			vi.fn(),
		);

		expect(result).toEqual({ cancelled: 3 });
	});

	it('exposes services to the cron handler', async () => {
		let observed = 0;
		const cron = new CronBuilder()
			.schedule('rate(1 hour)')
			.services([new CounterService()])
			.handle(async ({ services }) => {
				observed = services.counter.increment();
			});

		const adapter = new AWSScheduledFunction(envParser, cron);
		await adapter.handler(scheduledEvent, createMockContext(), vi.fn());

		expect(observed).toBe(1);
	});

	it('establishes request context so serviceContext.getLogger() works', async () => {
		// The cron runs through the same runWithRequestContext wrapper as
		// functions, so service code can resolve the request-scoped logger. We
		// assert delegation via the cron's own logger rather than spying on the
		// shared serviceContext proxy (which is a process-wide singleton).
		let hadContext = false;
		const logger = makeSpyLogger();

		const cron = new CronBuilder()
			.schedule('rate(1 day)')
			.logger(logger)
			.handle(async () => {
				hadContext = serviceContext.hasContext();
				serviceContext.getLogger().info('cron tick');
			});

		const adapter = new AWSScheduledFunction(envParser, cron);
		await adapter.handler(scheduledEvent, createMockContext(), vi.fn());

		expect(hadContext).toBe(true);
		expect(logger.info).toHaveBeenCalledWith('cron tick');
		// Context must not leak past the invocation.
		expect(serviceContext.hasContext()).toBe(false);
	});
});
