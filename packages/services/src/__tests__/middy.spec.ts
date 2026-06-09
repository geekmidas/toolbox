import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import middy from '@middy/core';
import type { Context } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serviceContext } from '../context';
import { addServices, requestContext, withServices } from '../middy';
import { ServiceDiscovery } from '../ServiceDiscovery';
import type { Service } from '../types';

const createMockContext = (): Context =>
	({
		functionName: 'standalone',
		functionVersion: '1',
		invokedFunctionArn:
			'arn:aws:lambda:us-east-1:123456789012:function:standalone',
		memoryLimitInMB: '128',
		awsRequestId: 'aws-req-1',
		logGroupName: '/aws/lambda/standalone',
		logStreamName: 'stream',
		getRemainingTimeInMillis: () => 30000,
		done: vi.fn(),
		fail: vi.fn(),
		succeed: vi.fn(),
		callbackWaitsForEmptyEventLoop: true,
	}) as unknown as Context;

/**
 * Invoke a Middy-wrapped handler with a mock Lambda context. The service
 * middlewares augment the context type to require `services`, but at runtime
 * they populate it before the handler runs — so the mock starts without it and
 * we invoke through a loosely-typed shim.
 */
const invoke = (
	handler: (event: any, context: any) => any,
	event: unknown = {},
): Promise<unknown> => Promise.resolve(handler(event, createMockContext()));

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

interface Greeter {
	greet(): string;
	registeredRequestId: string;
}

class GreeterService implements Service<'greeter', Greeter> {
	serviceName = 'greeter' as const;
	async register(): Promise<Greeter> {
		// Service code can read the request context during registration.
		const registeredRequestId = serviceContext.getRequestId();
		return {
			registeredRequestId,
			greet() {
				serviceContext.getLogger().info('greeting');
				return 'hello';
			},
		};
	}
}

interface Counter {
	next(): number;
}

class CounterService implements Service<'counter', Counter> {
	serviceName = 'counter' as const;
	async register(): Promise<Counter> {
		let n = 0;
		return { next: () => ++n };
	}
}

describe('middy adaptor', () => {
	beforeEach(() => {
		// ServiceDiscovery is a process-wide singleton that caches resolved
		// instances; reset so each test starts clean.
		ServiceDiscovery.reset();
	});

	describe('requestContext', () => {
		it('makes serviceContext available inside a plain handler', async () => {
			const logger = makeSpyLogger();
			let seenRequestId: string | undefined;
			let hadContext = false;

			const handler = middy(async () => {
				hadContext = serviceContext.hasContext();
				seenRequestId = serviceContext.getRequestId();
				serviceContext.getLogger().info('tick');
			}).use(requestContext({ logger }));

			await invoke(handler);

			expect(hadContext).toBe(true);
			expect(seenRequestId).toBe('aws-req-1');
			expect(logger.info).toHaveBeenCalledWith('tick');
		});

		it('gives each invocation its own fresh context', async () => {
			const seen: string[] = [];
			let counter = 0;
			const handler = middy(async () => {
				seen.push(serviceContext.getRequestId());
			}).use(
				requestContext({
					logger: makeSpyLogger(),
					getRequestId: () => `req-${++counter}`,
				}),
			);

			await invoke(handler);
			await invoke(handler);

			// The second invocation must not inherit the first's request id.
			expect(seen).toEqual(['req-1', 'req-2']);
		});

		it('propagates handler errors', async () => {
			const handler = middy(async () => {
				throw new Error('boom');
			}).use(requestContext({ logger: makeSpyLogger() }));

			await expect(invoke(handler)).rejects.toThrow('boom');
		});

		it('derives the request id via getRequestId override', async () => {
			let seen: string | undefined;
			const handler = middy(async () => {
				seen = serviceContext.getRequestId();
			}).use(
				requestContext({
					logger: makeSpyLogger(),
					getRequestId: () => 'custom-id',
				}),
			);

			await invoke(handler);
			expect(seen).toBe('custom-id');
		});
	});

	describe('addServices', () => {
		it('resolves services onto event.services (paired with requestContext)', async () => {
			const envParser = new EnvironmentParser({});
			const logger = makeSpyLogger();
			let greeting: string | undefined;
			let counted: number | undefined;
			let registeredRequestId: string | undefined;

			const handler = middy(async (event: { services: any }) => {
				registeredRequestId = event.services.greeter.registeredRequestId;
				greeting = event.services.greeter.greet();
				counted = event.services.counter.next();
			})
				.use(requestContext({ logger, getRequestId: () => 'shared-id' }))
				.use(
					addServices([new GreeterService(), new CounterService()], {
						envParser,
					}),
				);

			await invoke(handler);

			expect(greeting).toBe('hello');
			expect(counted).toBe(1);
			// register() and the service method ran inside the requestContext.
			expect(registeredRequestId).toBe('shared-id');
			expect(logger.info).toHaveBeenCalledWith('greeting');
		});

		it('resolves context-free services without a requestContext', async () => {
			const envParser = new EnvironmentParser({});
			let counted: number | undefined;

			const handler = middy(async (event: { services: any }) => {
				counted = event.services.counter.next();
			}).use(addServices([new CounterService()], { envParser }));

			await invoke(handler);

			expect(counted).toBe(1);
		});
	});

	describe('withServices', () => {
		it('establishes context and resolves services out of the box', async () => {
			const envParser = new EnvironmentParser({});
			let greeting: string | undefined;
			let registeredRequestId: string | undefined;

			const handler = middy(async (event: { services: any }) => {
				registeredRequestId = event.services.greeter.registeredRequestId;
				greeting = event.services.greeter.greet();
			}).use(
				withServices([new GreeterService()], {
					logger: makeSpyLogger(),
					envParser,
				}),
			);

			await invoke(handler);

			expect(greeting).toBe('hello');
			expect(registeredRequestId).toBe('aws-req-1');
		});
	});
});
