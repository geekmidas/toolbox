import { setTimeout as sleep } from 'node:timers/promises';
import { EnvironmentParser } from '@geekmidas/envkit';
import { UnauthorizedError } from '@geekmidas/errors';
import type { Logger } from '@geekmidas/logger';
import {
	type Service,
	ServiceDiscovery,
	serviceContext,
} from '@geekmidas/services';
import { createMockContext, createMockV2Event } from '@geekmidas/testkit/aws';
import { trace } from '@opentelemetry/api';
import {
	InMemorySpanExporter,
	NodeTracerProvider,
	SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Authenticator } from '../construct-interface';
import { AmazonApiGatewayV2Endpoint } from '../endpoints/AmazonApiGatewayV2EndpointAdaptor';
import { HonoEndpoint } from '../endpoints/HonoEndpointAdaptor';
import { TestEndpointAdaptor } from '../endpoints/TestEndpointAdaptor';
import { RestApi } from '../rest-api';

/**
 * Who a request is for, once `auth.getSession()` verified it, stays with that
 * request — and only that request: on the logger its handler is handed, on
 * the logger a service captured once for every request, on what a service
 * reads from its context, and on the request's span.
 */

/** A line as a logger wrote it: its message, with every binding it carried. */
interface Line {
	msg: string;
	[binding: string]: unknown;
}

/** A logger that keeps what it writes, with the bindings `child()` gave it. */
function recordingLogger(
	lines: Line[] = [],
	bindings: Record<string, unknown> = {},
): Logger & { lines: Line[] } {
	const write = (msg: string) => lines.push({ ...bindings, msg });
	return {
		lines,
		trace: write,
		debug: write,
		info: write,
		warn: write,
		error: write,
		fatal: write,
		child: (more: Record<string, unknown>) =>
			recordingLogger(lines, { ...bindings, ...more }),
	} as unknown as Logger & { lines: Line[] };
}

/** Signs in whoever sends `cookie: session=<user>`. */
const authenticator: Authenticator = {
	id: 'Auth',
	declare: () => [
		{ kind: 'rest-api', id: 'Auth', path: 'apps/auth', endpoints: [] },
	],
	async verify(headers) {
		const user = headers.get('cookie')?.match(/^session=(\w+)$/)?.[1];
		// As slowly as an auth server over HTTP, so requests interleave.
		await sleep(Math.floor(Math.random() * 5));
		return user
			? {
					user: { id: `user-${user}`, email: `${user}@shop.test`, name: user },
					session: { id: `session-${user}`, userId: `user-${user}` },
				}
			: null;
	},
};

/**
 * What a singleton service does: take the request-scoped logger once, the
 * first time it is used, and keep it for every request after.
 */
const audit = {
	serviceName: 'audit' as const,
	register() {
		let logger: Logger | undefined;
		return {
			record(msg: string) {
				logger ??= serviceContext.getLogger();
				logger.info(msg);
				return serviceContext.getUser();
			},
		};
	},
} satisfies Service<'audit', { record(msg: string): unknown }>;

function surface(logger: Logger) {
	return new RestApi('Api', {
		path: 'apps/api',
		defaultAuthorizer: 'none',
		logger,
	}).auth(authenticator);
}

/** `GET /me` for someone signed in, and `GET /hello` for anyone. */
function endpoints(logger: Logger) {
	const api = surface(logger);
	const signedIn = api.session(async ({ auth }) => {
		const session = await auth.getSession();
		if (!session) throw new UnauthorizedError('No active session');
		return session;
	});
	const maybeSignedIn = api.session(async ({ auth }) => auth.getSession());

	const me = signedIn
		.get('/me')
		.services([audit])
		.output(z.object({ user: z.string().optional() }))
		.handle(async ({ logger, services }) => {
			logger.info('handled');
			// Work the handler awaits, a few hops on.
			await sleep(Math.floor(Math.random() * 5));
			const seen = (await Promise.resolve().then(() =>
				services.audit.record('audited'),
			)) as { id: string } | undefined;
			return { user: seen?.id };
		});

	const hello = maybeSignedIn
		.get('/hello')
		.services([audit])
		.output(z.object({ user: z.string().optional() }))
		.handle(async ({ logger, services }) => {
			logger.info('hello');
			const seen = services.audit.record('audited') as
				| { id: string }
				| undefined;
			return { user: seen?.id };
		});

	return { me, hello };
}

describe('the user a request was verified as', () => {
	describe('through the test adaptor', () => {
		it('is on every line the handler and its services log', async () => {
			const logger = recordingLogger();
			const { me } = endpoints(logger);

			const result = await new TestEndpointAdaptor(me).request({
				services: { audit: audit.register() },
				headers: { cookie: 'session=ada' },
			});

			expect(result).toEqual({ user: 'user-ada' });
			const lines = logger.lines.filter((l) =>
				['handled', 'audited'].includes(l.msg),
			);
			expect(lines).toHaveLength(2);
			for (const line of lines) {
				// Who it was for, without losing which request and route.
				expect(line).toMatchObject({
					requestId: expect.any(String),
					endpoint: 'GET /me',
					route: '/me',
					method: 'GET',
					userId: 'user-ada',
					sessionId: 'session-ada',
				});
			}
		});

		it('stays with its own request when many run at once', async () => {
			const logger = recordingLogger();
			const { me } = endpoints(logger);
			// One instance for every request, as service discovery keeps it.
			const shared = audit.register();
			const users = ['ada', 'grace', 'linus', 'margaret', 'ken', 'barbara'];

			const results = await Promise.all(
				users.map((user) =>
					new TestEndpointAdaptor(me).request({
						services: { audit: shared },
						headers: { cookie: `session=${user}` },
					}),
				),
			);

			expect(results).toEqual(users.map((user) => ({ user: `user-${user}` })));
			// Each request's lines carry its own user, and no one else's.
			const byRequest = new Map<unknown, Set<unknown>>();
			for (const line of logger.lines.filter((l) => l.userId)) {
				const seen = byRequest.get(line.requestId) ?? new Set();
				seen.add(line.userId);
				byRequest.set(line.requestId, seen);
			}
			expect(byRequest.size).toBe(users.length);
			for (const seen of byRequest.values()) expect(seen.size).toBe(1);
		});

		it('is no one for a request without a session', async () => {
			const logger = recordingLogger();
			const { hello } = endpoints(logger);

			const result = await new TestEndpointAdaptor(hello).request({
				services: { audit: audit.register() },
				headers: {},
			});

			expect(result).toEqual({ user: undefined });
			for (const line of logger.lines) {
				expect(line).not.toHaveProperty('userId');
			}
		});
	});

	describe('through Hono', () => {
		function app(logger: Logger) {
			const { me, hello } = endpoints(logger);
			const hono = new Hono();
			HonoEndpoint.addRoutes(
				[me, hello] as never,
				ServiceDiscovery.getInstance(new EnvironmentParser({})),
				hono,
				{ docsPath: false },
			);
			return hono;
		}

		it('keeps each concurrent request’s user to itself', async () => {
			const logger = recordingLogger();
			const hono = app(logger);
			const users = ['ada', 'grace', 'linus', 'margaret'];

			const bodies = await Promise.all(
				users.map(async (user) => {
					const response = await hono.request('/me', {
						headers: { cookie: `session=${user}` },
					});
					return {
						requestId: response.headers.get('X-Request-ID'),
						body: await response.json(),
					};
				}),
			);

			for (const [i, user] of users.entries()) {
				expect(bodies[i]!.body).toEqual({ user: `user-${user}` });
				const lines = logger.lines.filter(
					(l) => l.requestId === bodies[i]!.requestId && l.msg !== undefined,
				);
				const handled = lines.filter((l) =>
					['handled', 'audited'].includes(l.msg),
				);
				expect(handled).toHaveLength(2);
				for (const line of handled) {
					expect(line).toMatchObject({
						requestId: bodies[i]!.requestId,
						endpoint: 'GET /me',
						route: '/me',
						method: 'GET',
						path: '/me',
						userId: `user-${user}`,
						sessionId: `session-${user}`,
					});
				}
			}
		});

		it('leaves an anonymous request anonymous beside a signed-in one', async () => {
			const logger = recordingLogger();
			const hono = app(logger);

			const [signedIn, anonymous] = await Promise.all([
				hono.request('/hello', { headers: { cookie: 'session=ada' } }),
				hono.request('/hello'),
			]);

			expect(await signedIn.json()).toEqual({ user: 'user-ada' });
			expect(await anonymous.json()).toEqual({});
			const anonymousId = anonymous.headers.get('X-Request-ID');
			for (const line of logger.lines.filter(
				(l) => l.requestId === anonymousId,
			)) {
				expect(line).not.toHaveProperty('userId');
			}
		});
	});

	describe('through API Gateway', () => {
		const invoke = (
			handler: ReturnType<
				AmazonApiGatewayV2Endpoint<any, any, any, any, any, any, any>['handler']
			>,
			path: string,
			awsRequestId: string,
			cookie?: string,
		) =>
			handler(
				createMockV2Event({
					routeKey: `GET ${path}`,
					rawPath: path,
					headers: cookie ? { cookie } : {},
				}),
				{ ...createMockContext(), awsRequestId },
			);

		it('logs every line — the handler’s and its services’ — with the route and the user', async () => {
			const logger = recordingLogger();
			const { me } = endpoints(logger);
			const handler = new AmazonApiGatewayV2Endpoint(me as never).handler;
			const users = ['ada', 'grace', 'linus'];

			const responses = await Promise.all(
				users.map((user) =>
					invoke(handler, '/me', `req-${user}`, `session=${user}`),
				),
			);

			for (const [i, user] of users.entries()) {
				expect(JSON.parse(responses[i]!.body!)).toEqual({
					user: `user-${user}`,
				});
				const handled = logger.lines.filter(
					(l) =>
						l.requestId === `req-${user}` &&
						['handled', 'audited'].includes(l.msg),
				);
				// The service's line too: it logs through the request context,
				// which used to carry the request id and nothing else.
				expect(handled.map((l) => l.msg).sort()).toEqual([
					'audited',
					'handled',
				]);
				for (const line of handled) {
					expect(line).toMatchObject({
						endpoint: 'GET /me',
						route: '/me',
						method: 'GET',
						userId: `user-${user}`,
						sessionId: `session-${user}`,
					});
				}
			}
		});

		it('logs an anonymous request with the route and no user', async () => {
			const logger = recordingLogger();
			const { hello } = endpoints(logger);
			const handler = new AmazonApiGatewayV2Endpoint(hello as never).handler;

			await invoke(handler, '/hello', 'req-anon');

			const lines = logger.lines.filter((l) => l.requestId === 'req-anon');
			expect(lines.map((l) => l.msg)).toEqual(
				expect.arrayContaining(['audited', 'hello']),
			);
			for (const line of lines) {
				expect(line).toMatchObject({ route: '/hello', method: 'GET' });
				expect(line).not.toHaveProperty('userId');
			}
		});
	});

	describe('on the trace', () => {
		const exporter = new InMemorySpanExporter();
		const provider = new NodeTracerProvider({
			spanProcessors: [new SimpleSpanProcessor(exporter)],
		});

		beforeAll(() => {
			provider.register();
		});
		afterAll(async () => {
			await provider.shutdown();
			trace.disable();
		});
		beforeEach(() => exporter.reset());

		/** A request, inside the server span an HTTP instrumentation opens. */
		const traced = (cookie: string | undefined) =>
			trace.getTracer('test').startActiveSpan('GET /me', async (span) => {
				try {
					const { me } = endpoints(recordingLogger());
					return await new TestEndpointAdaptor(me)
						.request({
							services: { audit: audit.register() },
							headers: cookie ? { cookie } : {},
						})
						.catch(() => undefined);
				} finally {
					span.end();
				}
			});

		it('marks the request’s span with who it was for', async () => {
			await traced('session=ada');

			const [span] = exporter
				.getFinishedSpans()
				.filter((s) => s.name === 'GET /me');
			expect(span?.attributes).toMatchObject({
				'enduser.id': 'user-ada',
				'session.id': 'session-ada',
			});
		});

		it('marks each concurrent request’s span with its own user', async () => {
			await Promise.all([
				traced('session=ada'),
				traced('session=grace'),
				traced(undefined),
			]);

			const users = exporter
				.getFinishedSpans()
				.filter((s) => s.name === 'GET /me')
				.map((s) => s.attributes['enduser.id'])
				.sort();
			expect(users).toEqual([undefined, 'user-ada', 'user-grace'].sort());
		});

		it('never carries the address, only the id', async () => {
			await traced('session=ada');

			const [span] = exporter
				.getFinishedSpans()
				.filter((s) => s.name === 'GET /me');
			expect(JSON.stringify(span?.attributes)).not.toContain('@shop.test');
		});
	});
});
