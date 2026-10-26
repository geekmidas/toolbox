import { EnvironmentParser } from '@geekmidas/envkit';
import { ServiceDiscovery } from '@geekmidas/services';
import { createMockContext, createMockV2Event } from '@geekmidas/testkit/aws';
import { Hono } from 'hono';
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
import { AmazonApiGatewayV2Endpoint } from '../endpoints/AmazonApiGatewayV2EndpointAdaptor';
import { EndpointFactory } from '../endpoints/EndpointFactory';
import { HonoEndpoint } from '../endpoints/HonoEndpointAdaptor';
import { TestEndpointAdaptor } from '../endpoints/TestEndpointAdaptor';
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
				async success({ run, status }) {
					calls.push(`success:${run}${status ? `:${status}` : ''}`);
				},
				async failure({ run, status, error }) {
					calls.push(
						`failure:${run}${status ? `:${status}` : ''}:${(error as Error).message}`,
					);
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

describe('heartbeat', () => {
	it('pings the URL when a run succeeds', async () => {
		const cron = new CronBuilder()
			.input(z.object({}))
			.schedule('rate(1 day)')
			.monitor(heartbeat.betterStack())
			.handle(async () => ({ ok: true }));

		await new TestFunctionAdaptor(
			cron,
			discovery({ HEARTBEAT_URL: HEARTBEAT }),
		).invoke({ input: {}, services: {} });

		expect(pings).toEqual(['/abc']);
	});

	it('pings the failure URL and rethrows when a run fails', async () => {
		const cron = new CronBuilder()
			.input(z.object({}))
			.schedule('rate(1 day)')
			.monitor(heartbeat.betterStack())
			.handle(async () => {
				throw new Error('boom');
			});

		await expect(
			new TestFunctionAdaptor(
				cron,
				discovery({ HEARTBEAT_URL: HEARTBEAT }),
			).invoke({ input: {}, services: {} }),
		).rejects.toThrow('boom');

		expect(pings).toEqual(['/abc/fail']);
	});

	it('pings start before success for providers that take one', async () => {
		const fn = new FunctionBuilder()
			.input(z.object({}))
			.monitor(heartbeat.healthchecks())
			.handle(async () => ({}));

		await new TestFunctionAdaptor(
			fn,
			discovery({ HEARTBEAT_URL: HEARTBEAT }),
		).invoke({ input: {}, services: {} });

		expect(pings).toEqual(['/abc/start', '/abc']);
	});

	it('does nothing when its env var is unset', async () => {
		const cron = new CronBuilder()
			.input(z.object({}))
			.schedule('rate(1 day)')
			.monitor(heartbeat.betterStack())
			.handle(async () => ({}));

		await new TestFunctionAdaptor(cron, discovery()).invoke({
			input: {},
			services: {},
		});

		expect(pings).toEqual([]);
	});

	it('reads the env var it was given', async () => {
		const cron = new CronBuilder()
			.input(z.object({}))
			.schedule('rate(1 day)')
			.monitor(heartbeat.betterStack('NIGHTLY_HEARTBEAT_URL'))
			.handle(async () => ({}));

		await new TestFunctionAdaptor(
			cron,
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
		const cron = new CronBuilder()
			.input(z.object({}))
			.schedule('rate(1 day)')
			.monitor(heartbeat.betterStack())
			.output(z.object({ ok: z.boolean() }))
			.handle(async () => ({ ok: true }));

		const output = await new TestFunctionAdaptor(
			cron,
			discovery({ HEARTBEAT_URL: HEARTBEAT }),
		).invoke({ input: {}, services: {} });

		expect(output).toEqual({ ok: true });
	});

	it('declares its env var as optional', async () => {
		const cron = new CronBuilder()
			.input(z.object({}))
			.schedule('rate(1 day)')
			.monitor(heartbeat.betterStack('NIGHTLY_HEARTBEAT_URL'))
			.handle(async () => ({}));

		expect(await cron.getEnvironment({ markOptional: true })).toContain(
			'NIGHTLY_HEARTBEAT_URL?',
		);
	});
});

describe('functions and crons', () => {
	it('report start, then success with what start returned', async () => {
		const { calls, service } = recorder();
		const fn = new FunctionBuilder()
			.input(z.object({}))
			.monitor(service)
			.handle(async () => ({}));

		await new TestFunctionAdaptor(fn, discovery()).invoke({
			input: {},
			services: {},
		});

		expect(calls).toEqual(['start', 'success:run-1']);
	});

	it('tell every monitor, in the AWS Lambda handler', async () => {
		const one = recorder('one');
		const two = recorder('two');
		const cron = new CronBuilder()
			.input(z.object({}))
			.schedule('rate(1 day)')
			.monitor(one.service)
			.monitor(two.service)
			.handle(async () => {
				throw new Error('boom');
			});
		discovery();

		const handler = new AWSScheduledFunction(new EnvironmentParser({}), cron)
			.handler;

		// The handler rethrows the wrapped error; monitors get the original.
		await expect(handler({}, createMockContext(), vi.fn())).rejects.toThrow();
		expect(one.calls).toEqual(['start', 'failure:run-1:boom']);
		expect(two.calls).toEqual(['start', 'failure:run-1:boom']);
	});

	it('ignore a monitor that throws', async () => {
		const fn = new FunctionBuilder()
			.input(z.object({}))
			.monitor(throwing)
			.output(z.object({ ok: z.boolean() }))
			.handle(async () => ({ ok: true }));

		const output = await new TestFunctionAdaptor(fn, discovery()).invoke({
			input: {},
			services: {},
		});

		expect(output).toEqual({ ok: true });
	});

	it('inherit a shared base’s monitor, and add their own', async () => {
		const shared = recorder('shared');
		const own = recorder('own');
		const base = new CronBuilder().monitor(shared.service);

		const nightly = base
			.schedule('rate(1 day)')
			.monitor(own.service)
			.handle(async () => ({}));
		const hourly = base.schedule('rate(1 hour)').handle(async () => ({}));

		expect(nightly.monitors.map((m) => m.serviceName)).toEqual([
			'shared',
			'own',
		]);
		expect(hourly.monitors.map((m) => m.serviceName)).toEqual(['shared']);
	});
});

describe('endpoints', () => {
	function api(monitor: MonitorService) {
		const e = new EndpointFactory().monitor(monitor);
		return {
			ok: e.get('/ok').handle(async () => ({ ok: true })),
			missing: e.get('/missing').handle(async () => {
				const { NotFoundError } = await import('@geekmidas/errors');
				throw new NotFoundError('nope');
			}),
			broken: e.get('/broken').handle(async () => {
				throw new Error('boom');
			}),
		};
	}

	it('inherit the factory’s monitor, and add their own', () => {
		const shared = recorder('shared');
		const own = recorder('own');
		const e = new EndpointFactory().monitor(shared.service);

		const withOwn = e
			.get('/a')
			.monitor(own.service)
			.handle(async () => ({}));
		const without = e.get('/b').handle(async () => ({}));

		expect(withOwn.monitors.map((m) => m.serviceName)).toEqual([
			'shared',
			'own',
		]);
		expect(without.monitors.map((m) => m.serviceName)).toEqual(['shared']);
	});

	describe('TestEndpointAdaptor', () => {
		const request = (endpoint: any) =>
			new TestEndpointAdaptor(endpoint, discovery()).fullRequest({
				services: {},
				headers: {},
			} as any);

		it('reports a 2xx as a success', async () => {
			const { calls, service } = recorder();
			await request(api(service).ok);
			expect(calls).toEqual(['start', 'success:run-1:200']);
		});

		it('reports a 4xx as a success: the caller erred, not the service', async () => {
			const { calls, service } = recorder();
			await expect(request(api(service).missing)).rejects.toThrow('nope');
			expect(calls).toEqual(['start', 'success:run-1:404']);
		});

		it('reports a thrown error as a 500 failure', async () => {
			const { calls, service } = recorder();
			await expect(request(api(service).broken)).rejects.toThrow('boom');
			expect(calls).toEqual(['start', 'failure:run-1:500:boom']);
		});
	});

	describe('Hono', () => {
		async function serve(endpoint: any, path: string) {
			const app = new Hono();
			new HonoEndpoint(endpoint).addRoute(discovery(), app);
			return app.request(path);
		}

		it('reports a 2xx as a success, without holding the response', async () => {
			const { calls, service } = recorder();
			const response = await serve(api(service).ok, '/ok');

			expect(response.status).toBe(200);
			await vi.waitFor(() =>
				expect(calls).toEqual(['start', 'success:run-1:200']),
			);
		});

		it('reports a 4xx as a success', async () => {
			const { calls, service } = recorder();
			const response = await serve(api(service).missing, '/missing');

			expect(response.status).toBe(404);
			await vi.waitFor(() =>
				expect(calls).toEqual(['start', 'success:run-1:404']),
			);
		});

		it('reports a 5xx as a failure, with the error', async () => {
			const { calls, service } = recorder();
			const response = await serve(api(service).broken, '/broken');

			expect(response.status).toBe(500);
			await vi.waitFor(() =>
				expect(calls).toEqual(['start', 'failure:run-1:500:boom']),
			);
		});
	});

	describe('API Gateway', () => {
		async function invoke(endpoint: any) {
			discovery();
			const handler = new AmazonApiGatewayV2Endpoint(
				new EnvironmentParser({}),
				endpoint,
			).handler;
			return handler(createMockV2Event(), createMockContext(), vi.fn());
		}

		it('reports a 2xx as a success', async () => {
			const { calls, service } = recorder();
			const response: any = await invoke(api(service).ok);

			expect(response.statusCode).toBe(200);
			expect(calls).toEqual(['start', 'success:run-1:200']);
		});

		it('reports a 4xx as a success', async () => {
			const { calls, service } = recorder();
			const response: any = await invoke(api(service).missing);

			expect(response.statusCode).toBe(404);
			expect(calls).toEqual(['start', 'success:run-1:404']);
		});

		it('reports a 5xx as a failure, with the error', async () => {
			const { calls, service } = recorder();
			const response: any = await invoke(api(service).broken);

			expect(response.statusCode).toBe(500);
			expect(calls).toEqual(['start', 'failure:run-1:500:boom']);
		});
	});
});
