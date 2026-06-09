import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { initTRPC } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serviceContext } from '../context';
import { ServiceDiscovery } from '../ServiceDiscovery';
import {
	createRequestContextMiddleware,
	createServicesMiddleware,
} from '../trpc';
import type { Service } from '../types';

beforeEach(() => {
	// ServiceDiscovery is a process-wide singleton that caches resolved
	// instances. Reset so each test gets a fresh registry.
	ServiceDiscovery.reset();
});

function makeLogger(): Logger {
	const logger: Logger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		trace: vi.fn(),
		child: vi.fn(() => logger),
	};
	return logger;
}

describe('createServicesMiddleware (with envParser)', () => {
	it('resolves services and merges them onto ctx', async () => {
		const databaseService = {
			serviceName: 'database' as const,
			register: () => ({ query: (sql: string) => `result: ${sql}` }),
		} satisfies Service<'database', { query: (sql: string) => string }>;

		const t = initTRPC.context<{ logger: Logger }>().create();
		const withServices = createServicesMiddleware(
			t.middleware,
			new EnvironmentParser({}),
		);

		const caller = t.router({
			run: t.procedure
				.use(withServices([databaseService]))
				.query(({ ctx }) => ctx.database.query('select 1')),
		});

		const result = await caller.createCaller({ logger: makeLogger() }).run();

		expect(result).toBe('result: select 1');
	});

	it('makes serviceContext.getLogger() readable from inside a service method', async () => {
		let observedLogger: Logger | null = null;
		const dbService = {
			serviceName: 'database' as const,
			register: () => ({
				touch() {
					observedLogger = serviceContext.getLogger();
					observedLogger.info('touched');
					return 'ok';
				},
			}),
		} satisfies Service<'database', { touch: () => string }>;

		const t = initTRPC.context<{ logger: Logger }>().create();
		const withServices = createServicesMiddleware(
			t.middleware,
			new EnvironmentParser({}),
		);

		const requestLogger = makeLogger();

		const caller = t.router({
			run: t.procedure
				.use(withServices([dbService]))
				.query(({ ctx }) => ctx.database.touch()),
		});

		await caller.createCaller({ logger: requestLogger }).run();

		// getLogger() returns a request-scoped proxy (not the raw logger), so we
		// assert it delegates to the request logger rather than checking identity.
		expect(observedLogger).not.toBeNull();
		expect(requestLogger.info).toHaveBeenCalledWith('touched');
	});

	it('throws cleanly when service code runs outside the procedure', () => {
		// Sanity check that serviceContext stays scoped to the procedure call —
		// reads outside any procedure must throw.
		expect(() => serviceContext.getLogger()).toThrow();
	});
});

describe('createServicesMiddleware (context-supplied discovery)', () => {
	it('uses ctx.serviceDiscovery when no envParser is provided', async () => {
		const cacheService = {
			serviceName: 'cache' as const,
			register: () => ({ get: (key: string) => `cached:${key}` }),
		} satisfies Service<'cache', { get: (key: string) => string }>;

		type Ctx = { logger: Logger; serviceDiscovery: ServiceDiscovery };
		const t = initTRPC.context<Ctx>().create();
		const withServices = createServicesMiddleware<Ctx, object>(t.middleware);

		const caller = t.router({
			run: t.procedure
				.use(withServices([cacheService]))
				.query(({ ctx }) => ctx.cache.get('k')),
		});

		const discovery = ServiceDiscovery.getInstance(new EnvironmentParser({}));

		const result = await caller
			.createCaller({ logger: makeLogger(), serviceDiscovery: discovery })
			.run();

		expect(result).toBe('cached:k');
	});
});

describe('createRequestContextMiddleware', () => {
	it('exposes ctx.logger via serviceContext.getLogger() for the handler', async () => {
		const t = initTRPC.context<{ logger: Logger }>().create();
		const withRequestContext = createRequestContextMiddleware(t.middleware);

		let observed: Logger | null = null;
		const caller = t.router({
			run: t.procedure.use(withRequestContext).query(() => {
				observed = serviceContext.getLogger();
				observed.info('handled');
				return 'done';
			}),
		});

		const requestLogger = makeLogger();
		const result = await caller.createCaller({ logger: requestLogger }).run();

		expect(result).toBe('done');
		// The request-scoped proxy delegates to ctx.logger.
		expect(observed).not.toBeNull();
		expect(requestLogger.info).toHaveBeenCalledWith('handled');
	});

	it('auto-generates requestId and startTime when ctx does not provide them', async () => {
		const t = initTRPC.context<{ logger: Logger }>().create();
		const withRequestContext = createRequestContextMiddleware(t.middleware);

		let requestId: string | null = null;
		let startTime: number | null = null;

		const caller = t.router({
			run: t.procedure.use(withRequestContext).query(() => {
				requestId = serviceContext.getRequestId();
				startTime = serviceContext.getRequestStartTime();
				return 'ok';
			}),
		});

		await caller.createCaller({ logger: makeLogger() }).run();

		expect(requestId).toBeTypeOf('string');
		expect(requestId!.length).toBeGreaterThan(0);
		expect(typeof startTime).toBe('number');
	});

	it('honors caller-supplied requestId and startTime when present on ctx', async () => {
		type Ctx = { logger: Logger; requestId?: string; startTime?: number };
		const t = initTRPC.context<Ctx>().create();
		const withRequestContext = createRequestContextMiddleware(t.middleware);

		let observedId: string | null = null;
		let observedStart: number | null = null;

		const caller = t.router({
			run: t.procedure.use(withRequestContext).query(() => {
				observedId = serviceContext.getRequestId();
				observedStart = serviceContext.getRequestStartTime();
				return 'ok';
			}),
		});

		await caller
			.createCaller({
				logger: makeLogger(),
				requestId: 'req_abc',
				startTime: 12345,
			})
			.run();

		expect(observedId).toBe('req_abc');
		expect(observedStart).toBe(12345);
	});
});

describe('tagging for tooling', () => {
	it('attaches the resolved services tuple to the inner middleware', () => {
		const svc = {
			serviceName: 'sample' as const,
			register: () => ({}),
		} satisfies Service<'sample', {}>;

		const t = initTRPC.context<{ logger: Logger }>().create();
		const withServices = createServicesMiddleware(
			t.middleware,
			new EnvironmentParser({}),
		);

		const builder = withServices([svc]);
		const middlewares = (
			builder as unknown as { _middlewares: Array<{ _services?: Service[] }> }
		)._middlewares;
		expect(middlewares?.at(-1)?._services).toEqual([svc]);
	});
});
