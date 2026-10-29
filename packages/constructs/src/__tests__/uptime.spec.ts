import { EnvironmentParser } from '@geekmidas/envkit';
import { ServiceDiscovery } from '@geekmidas/services';
import { createMockContext } from '@geekmidas/testkit/aws';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { z } from 'zod';
import { AWSScheduledFunction } from '../crons/AWSScheduledFunction';
import { CronBuilder } from '../crons/CronBuilder';
import { EndpointFactory } from '../endpoints/EndpointFactory';
import { FunctionBuilder } from '../functions/FunctionBuilder';
import { TestFunctionAdaptor } from '../functions/TestFunctionAdaptor';
import type { ConstructMonitor, MonitorService } from '../monitor';
import { heartbeat } from '../monitors';

const HEARTBEAT = 'https://heartbeat.test/api/v1/heartbeat/abc';

/** Every heartbeat request MSW saw, as `path`. */
const pings: string[] = [];

const server = setupServer(
	http.get('https://heartbeat.test/*', ({ request }) => {
		pings.push(new URL(request.url).pathname.replace('/api/v1/heartbeat', ''));
		return new HttpResponse(null, { status: 200 });
	}),
);

/** A monitor that writes down what it was told, in order. */
function recorder(serviceName = 'recorder') {
	const calls: string[] = [];
	const service = {
		serviceName,
		async register(): Promise<ConstructMonitor<string>> {
			return {
				async start() {
					calls.push('start');
					return 'run-1';
				},
				async success({ run }) {
					calls.push(`success:${run}`);
				},
				async failure({ run, error }) {
					calls.push(`failure:${run}:${(error as Error).message}`);
				},
			};
		},
	} satisfies MonitorService;

	return { calls, service };
}

const throwing = {
	serviceName: 'throwing',
	async register(): Promise<ConstructMonitor> {
		return {
			async start() {
				throw new Error('start failed');
			},
			async success() {
				throw new Error('success failed');
			},
			async failure() {
				throw new Error('failure failed');
			},
		};
	},
} satisfies MonitorService;

function discovery(env: Record<string, string> = {}) {
	return ServiceDiscovery.getInstance(new EnvironmentParser(env));
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
	// Services are cached by name, so each test starts from its own env.
	ServiceDiscovery.reset();
	pings.length = 0;
});
afterEach(() => server.resetHandlers());

const cron = (monitor: MonitorService) =>
	new CronBuilder()
		.input(z.object({}))
		.schedule('cron(0 0 * * *)')
		.uptime(monitor);

describe('cron.uptime() with a heartbeat', () => {
	it('pings the URL when a run succeeds', async () => {
		await new TestFunctionAdaptor(
			cron(heartbeat.betterStack()).handle(async () => ({ ok: true })),
			discovery({ HEARTBEAT_URL: HEARTBEAT }),
		).invoke({ input: {}, services: {} });

		expect(pings).toEqual(['/abc']);
	});

	it('pings the failure URL and rethrows when a run fails', async () => {
		await expect(
			new TestFunctionAdaptor(
				cron(heartbeat.betterStack()).handle(async () => {
					throw new Error('boom');
				}),
				discovery({ HEARTBEAT_URL: HEARTBEAT }),
			).invoke({ input: {}, services: {} }),
		).rejects.toThrow('boom');

		expect(pings).toEqual(['/abc/fail']);
	});

	it('pings start before success for providers that take one', async () => {
		await new TestFunctionAdaptor(
			cron(heartbeat.healthchecks()).handle(async () => ({})),
			discovery({ HEARTBEAT_URL: HEARTBEAT }),
		).invoke({ input: {}, services: {} });

		expect(pings).toEqual(['/abc/start', '/abc']);
	});

	it('skips the heartbeat but still runs when its env var is missing', async () => {
		const output = await new TestFunctionAdaptor(
			cron(heartbeat.betterStack())
				.output(z.object({ ok: z.boolean() }))
				.handle(async () => ({ ok: true })),
			discovery(),
		).invoke({ input: {}, services: {} });

		expect(output).toEqual({ ok: true });
		expect(pings).toEqual([]);
	});

	it('reads the env var it was given', async () => {
		await new TestFunctionAdaptor(
			cron(heartbeat.betterStack('NIGHTLY_HEARTBEAT_URL')).handle(
				async () => ({}),
			),
			discovery({ NIGHTLY_HEARTBEAT_URL: `${HEARTBEAT}/nightly` }),
		).invoke({ input: {}, services: {} });

		expect(pings).toEqual(['/abc/nightly']);
	});

	it('does not fail the run when the provider is down', async () => {
		server.use(
			http.get('https://heartbeat.test/*', () =>
				HttpResponse.json({ error: 'down' }, { status: 503 }),
			),
		);

		const output = await new TestFunctionAdaptor(
			cron(heartbeat.betterStack())
				.output(z.object({ ok: z.boolean() }))
				.handle(async () => ({ ok: true })),
			discovery({ HEARTBEAT_URL: HEARTBEAT }),
		).invoke({ input: {}, services: {} });

		expect(output).toEqual({ ok: true });
	});

	it('declares its env var as required', async () => {
		const environment = await cron(
			heartbeat.betterStack('NIGHTLY_HEARTBEAT_URL'),
		)
			.handle(async () => ({}))
			.getEnvironment({ markOptional: true });

		expect(environment).toContain('NIGHTLY_HEARTBEAT_URL');
		expect(environment).not.toContain('NIGHTLY_HEARTBEAT_URL?');
	});
});

describe('cron.uptime()', () => {
	it('reports start, then success with what start returned', async () => {
		const { calls, service } = recorder();

		await new TestFunctionAdaptor(
			cron(service).handle(async () => ({})),
			discovery(),
		).invoke({ input: {}, services: {} });

		expect(calls).toEqual(['start', 'success:run-1']);
	});

	it('ignores a monitor that throws', async () => {
		const output = await new TestFunctionAdaptor(
			cron(throwing)
				.output(z.object({ ok: z.boolean() }))
				.handle(async () => ({ ok: true })),
			discovery(),
		).invoke({ input: {}, services: {} });

		expect(output).toEqual({ ok: true });
	});

	it('replaces the monitor when called again', () => {
		const first = recorder('first');
		const second = recorder('second');

		const nightly = cron(first.service)
			.uptime(second.service)
			.handle(async () => ({}));

		expect(nightly.monitors.map((m) => m.serviceName)).toEqual(['second']);
	});

	it('is inherited from a shared base', () => {
		const shared = recorder('shared');
		const base = new CronBuilder().uptime(shared.service);

		const nightly = base.schedule('cron(0 0 * * *)').handle(async () => ({}));
		const hourly = base.schedule('cron(0 * * * *)').handle(async () => ({}));

		expect(nightly.monitors.map((m) => m.serviceName)).toEqual(['shared']);
		expect(hourly.monitors.map((m) => m.serviceName)).toEqual(['shared']);
	});

	it('is not available on functions or endpoints', () => {
		// @ts-expect-error uptime is for crons only
		expect(new FunctionBuilder().uptime).toBeUndefined();
		// @ts-expect-error monitor() is removed
		expect(new FunctionBuilder().monitor).toBeUndefined();
		// @ts-expect-error monitor() is removed
		expect(new EndpointFactory().monitor).toBeUndefined();
		// @ts-expect-error monitor() is removed
		expect(new EndpointFactory().get('/x').monitor).toBeUndefined();
	});
});

describe('cron.uptime() in the AWS Lambda handler', () => {
	const invoke = (construct: any, env = { HEARTBEAT_URL: HEARTBEAT }) =>
		new AWSScheduledFunction(new EnvironmentParser(env), construct).handler(
			{},
			createMockContext(),
			vi.fn(),
		);

	it('sends the success ping', async () => {
		await invoke(cron(heartbeat.betterStack()).handle(async () => ({})));
		expect(pings).toEqual(['/abc']);
	});

	it('sends the failure ping', async () => {
		await expect(
			invoke(
				cron(heartbeat.betterStack()).handle(async () => {
					throw new Error('boom');
				}),
			),
		).rejects.toThrow();
		expect(pings).toEqual(['/abc/fail']);
	});

	it('reports the original error, not the wrapped one', async () => {
		const { calls, service } = recorder();
		discovery();

		await expect(
			invoke(
				cron(service).handle(async () => {
					throw new Error('boom');
				}),
			),
		).rejects.toThrow();
		expect(calls).toEqual(['start', 'failure:run-1:boom']);
	});

	it('sends the start ping first, for Healthchecks.io', async () => {
		await invoke(cron(heartbeat.healthchecks()).handle(async () => ({})));
		expect(pings).toEqual(['/abc/start', '/abc']);
	});

	it('sends one ping per run, from a shared base', async () => {
		const base = new CronBuilder().uptime(heartbeat.betterStack());

		await invoke(base.schedule('cron(0 0 * * *)').handle(async () => ({})));
		await invoke(base.schedule('cron(0 * * * *)').handle(async () => ({})));

		expect(pings).toEqual(['/abc', '/abc']);
	});
});

describe('getUptime', () => {
	it('records the monitor for the manifest', () => {
		expect(
			cron(heartbeat.betterStack('MONITORING_URL'))
				.handle(async () => ({}))
				.getUptime(),
		).toEqual({
			type: 'heartbeat',
			provider: 'betterStack',
			env: 'MONITORING_URL',
		});
	});

	it('records a custom heartbeat without a provider, on its default env var', () => {
		expect(
			cron(heartbeat())
				.handle(async () => ({}))
				.getUptime(),
		).toEqual({
			type: 'heartbeat',
			env: 'HEARTBEAT_URL',
		});
	});

	it('records a hand-written monitor by its service name', () => {
		const custom = {
			serviceName: 'custom',
			async register() {
				return { async success() {}, async failure() {} };
			},
		} satisfies MonitorService;

		expect(
			cron(custom)
				.handle(async () => ({}))
				.getUptime(),
		).toEqual({
			type: 'custom',
		});
	});

	it('records nothing for a cron without one', () => {
		expect(
			new CronBuilder()
				.schedule('cron(0 0 * * *)')
				.handle(async () => ({}))
				.getUptime(),
		).toBeUndefined();
	});
});
