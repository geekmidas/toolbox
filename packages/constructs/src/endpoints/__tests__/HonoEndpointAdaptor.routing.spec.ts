import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { ServiceDiscovery } from '@geekmidas/services';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Endpoint } from '../Endpoint';
import { HonoEndpoint } from '../HonoEndpointAdaptor';

const logger: Logger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	fatal: vi.fn(),
	trace: vi.fn(),
	child: vi.fn(() => logger),
};

function endpoint<T>(
	route: string,
	fn: (
		ctx: unknown,
		response: { header: (k: string, v: string) => void },
	) => T | Promise<T>,
	extra: { output?: z.ZodType; responseType?: string } = {},
) {
	return new Endpoint({
		route,
		method: 'GET',
		fn: fn as never,
		input: undefined,
		output: extra.output,
		services: [],
		logger,
		timeout: undefined,
		memorySize: undefined,
		status: undefined,
		getSession: undefined,
		authorize: undefined,
		description: undefined,
		responseType: extra.responseType,
	});
}

const discovery = ServiceDiscovery.getInstance(new EnvironmentParser({}));

describe('HonoEndpoint.addRoutes', () => {
	const isDev = HonoEndpoint.isDev;
	afterEach(() => {
		HonoEndpoint.isDev = isDev;
	});

	it('serves a static route ahead of a dynamic one registered before it', async () => {
		const app = new Hono();
		HonoEndpoint.addRoutes(
			[
				endpoint('/users/:id', () => ({ matched: 'dynamic' }), {
					output: z.object({ matched: z.string() }),
				}),
				endpoint('/users/me', () => ({ matched: 'static' }), {
					output: z.object({ matched: z.string() }),
				}),
				endpoint('/users/:id/orders', () => ({ matched: 'nested' }), {
					output: z.object({ matched: z.string() }),
				}),
			],
			discovery,
			app,
		);

		expect(await (await app.request('/users/me')).json()).toEqual({
			matched: 'static',
		});
		expect(await (await app.request('/users/42')).json()).toEqual({
			matched: 'dynamic',
		});
		expect(await (await app.request('/users/42/orders')).json()).toEqual({
			matched: 'nested',
		});
	});

	it('mounts the OpenAPI document where it is told, or not at all', async () => {
		const routes = () => [endpoint('/ping', () => ({}))];

		const custom = new Hono();
		HonoEndpoint.addRoutes(routes(), discovery, custom, {
			docsPath: '/api-docs',
		});
		expect((await custom.request('/api-docs')).status).toBe(200);
		expect((await custom.request('/docs')).status).toBe(404);

		const none = new Hono();
		HonoEndpoint.addRoutes(routes(), discovery, none, { docsPath: false });
		expect((await none.request('/docs')).status).toBe(404);
	});

	it('keeps a content-type the handler set on a non-JSON response', async () => {
		const app = new Hono();
		new HonoEndpoint(
			endpoint(
				'/export',
				(_ctx, response) => {
					response.header('Content-Type', 'text/csv; charset=utf-8');
					return 'id\n1\n';
				},
				{ responseType: 'text/plain', output: z.string() },
			),
		).addRoute(discovery, app);

		const response = await app.request('/export');

		expect(response.headers.get('content-type')).toBe(
			'text/csv; charset=utf-8',
		);
		expect(await response.text()).toBe('id\n1\n');
	});

	it('logs every outgoing response in development, including failures', async () => {
		HonoEndpoint.isDev = true;
		const app = new Hono();
		HonoEndpoint.addRoutes(
			[
				endpoint('/ok', () => ({ ok: true }), {
					output: z.object({ ok: z.boolean() }),
				}),
				endpoint('/boom', () => {
					throw new Error('kaboom');
				}),
				// Returns what its output schema refuses.
				endpoint('/invalid', () => ({ ok: 'yes' }), {
					output: z.object({ ok: z.boolean() }),
				}),
			],
			discovery,
			app,
		);
		vi.mocked(logger.info).mockClear();

		expect((await app.request('/ok')).status).toBe(200);
		expect((await app.request('/boom')).status).toBe(500);
		expect((await app.request('/invalid')).status).toBe(422);

		const statuses = vi
			.mocked(logger.info)
			.mock.calls.filter(([, message]) => message === 'Outgoing response')
			.map(([details]) => (details as { status: number }).status);
		expect(statuses).toEqual([200, 500, 422]);
	});
});
