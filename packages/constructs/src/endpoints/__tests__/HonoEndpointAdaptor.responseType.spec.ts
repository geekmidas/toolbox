import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { ServiceDiscovery } from '@geekmidas/services';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Endpoint } from '../Endpoint';
import { HonoEndpoint } from '../HonoEndpointAdaptor';

const mockLogger: Logger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	fatal: vi.fn(),
	trace: vi.fn(),
	child: vi.fn(() => mockLogger),
};

function makeEndpoint<T>(overrides: {
	route: string;
	method: 'GET';
	output: any;
	fn: () => Promise<T> | T;
	responseType?: string;
}) {
	return new Endpoint({
		route: overrides.route,
		method: overrides.method,
		fn: overrides.fn as any,
		input: undefined,
		output: overrides.output,
		services: [],
		logger: mockLogger,
		timeout: undefined,
		memorySize: undefined,
		status: undefined,
		getSession: undefined,
		authorize: undefined,
		description: undefined,
		responseType: overrides.responseType,
	});
}

describe('HonoEndpointAdaptor — responseType', () => {
	const envParser = new EnvironmentParser({});
	const serviceDiscovery = ServiceDiscovery.getInstance(envParser);

	it('defaults to application/json and JSON-encodes the output', async () => {
		const endpoint = makeEndpoint({
			route: '/users/:id',
			method: 'GET',
			output: z.object({ id: z.string() }),
			fn: async () => ({ id: '123' }),
		});

		const app = new Hono();
		new HonoEndpoint(endpoint).addRoute(serviceDiscovery, app);

		const response = await app.request('/users/123');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toMatch(/application\/json/);
		expect(await response.json()).toEqual({ id: '123' });
	});

	it('emits raw HTML body when responseType is text/html', async () => {
		const html = '<html><body><h1>Checkout</h1></body></html>';
		const endpoint = makeEndpoint({
			route: '/checkout-page',
			method: 'GET',
			output: z.string(),
			fn: async () => html,
			responseType: 'text/html',
		});

		const app = new Hono();
		new HonoEndpoint(endpoint).addRoute(serviceDiscovery, app);

		const response = await app.request('/checkout-page');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toMatch(/text\/html/);

		const body = await response.text();
		// The body is emitted as-is, NOT JSON-encoded (would be `"<html>..."`)
		expect(body).toBe(html);
		expect(body.startsWith('"')).toBe(false);
	});

	it('emits raw plain text when responseType is text/plain', async () => {
		const endpoint = makeEndpoint({
			route: '/robots.txt',
			method: 'GET',
			output: z.string(),
			fn: async () => 'User-agent: *\nDisallow:',
			responseType: 'text/plain',
		});

		const app = new Hono();
		new HonoEndpoint(endpoint).addRoute(serviceDiscovery, app);

		const response = await app.request('/robots.txt');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toMatch(/text\/plain/);
		expect(await response.text()).toBe('User-agent: *\nDisallow:');
	});

	it('lets r.header() runtime override win over the declared responseType header', async () => {
		const endpoint = makeEndpoint({
			route: '/dynamic',
			method: 'GET',
			output: z.string(),
			fn: async (_ctx: any, r: any) => {
				r.header('content-type', 'text/xml; charset=utf-8');
				return r.send('<xml></xml>');
			},
			responseType: 'text/html',
		});

		const app = new Hono();
		new HonoEndpoint(endpoint).addRoute(serviceDiscovery, app);

		const response = await app.request('/dynamic');
		expect(response.status).toBe(200);
		// Runtime header via r.header() takes precedence over endpoint.responseType
		expect(response.headers.get('content-type')).toMatch(/text\/xml/);
		expect(await response.text()).toBe('<xml></xml>');
	});
});
