import { EnvironmentParser } from '@geekmidas/envkit';
import { UnprocessableEntityError } from '@geekmidas/errors';
import type { Logger } from '@geekmidas/logger';
import { ServiceDiscovery } from '@geekmidas/services';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Endpoint } from '../Endpoint';
import { HonoEndpoint } from '../HonoEndpointAdaptor';

/** One `logger.error` call, with the bindings of the child it went through. */
interface ErrorLine {
	bindings: Record<string, unknown>;
	fields: Record<string, unknown>;
	message: string;
}

/** A logger that keeps each error line it is given. */
function recordingLogger(
	lines: ErrorLine[],
	bindings: Record<string, unknown> = {},
): Logger {
	const ignore = () => {};
	return {
		debug: ignore,
		info: ignore,
		warn: ignore,
		fatal: ignore,
		trace: ignore,
		error: ((fields: Record<string, unknown>, message: string) => {
			lines.push({ bindings, fields, message });
		}) as Logger['error'],
		child: (more: Record<string, unknown>) =>
			recordingLogger(lines, { ...bindings, ...more }),
	};
}

const serviceDiscovery = ServiceDiscovery.getInstance(
	new EnvironmentParser({}),
);

function appFor(
	input: ConstructorParameters<typeof Endpoint>[0]['input'],
	lines: ErrorLine[],
	route = '/users',
	method: 'GET' | 'POST' = 'POST',
) {
	const endpoint = new Endpoint({
		route,
		method,
		fn: async () => ({ ok: true }),
		input,
		output: z.object({ ok: z.boolean() }),
		services: [],
		logger: recordingLogger(lines),
		timeout: undefined,
		memorySize: undefined,
		status: undefined,
		getSession: undefined,
		authorize: undefined,
		description: undefined,
	} as any);
	const app = new Hono();
	new HonoEndpoint(endpoint).addRoute(serviceDiscovery, app);
	return app;
}

describe('HonoEndpoint — a request rejected before the handler is logged', () => {
	it('logs a body that fails its schema, with the request it was', async () => {
		const lines: ErrorLine[] = [];
		const app = appFor({ body: z.object({ email: z.email() }) }, lines);

		const response = await app.request('/users', {
			method: 'POST',
			body: JSON.stringify({ email: 'not-an-email' }),
			headers: {
				'content-type': 'application/json',
				'x-request-id': 'req-422',
			},
		});

		expect(response.status).toBe(422);
		expect(response.headers.get('x-request-id')).toBe('req-422');
		expect(lines).toHaveLength(1);
		const [line] = lines;
		expect(line?.message).toBe('Request validation failed');
		expect(line?.fields.part).toBe('body');
		expect(line?.fields.err).toBeInstanceOf(UnprocessableEntityError);
		expect(line?.bindings).toMatchObject({
			requestId: 'req-422',
			route: '/users',
			method: 'POST',
			path: '/users',
		});
	});

	it('logs a query that fails its schema', async () => {
		const lines: ErrorLine[] = [];
		const app = appFor(
			{ query: z.object({ page: z.coerce.number().int() }) },
			lines,
			'/users',
			'GET',
		);

		const response = await app.request('/users?page=abc');

		expect(response.status).toBe(422);
		expect(lines.map((line) => [line.message, line.fields.part])).toEqual([
			['Request validation failed', 'query'],
		]);
	});

	it('logs params that fail their schema', async () => {
		const lines: ErrorLine[] = [];
		const app = appFor(
			{ params: z.object({ id: z.uuid() }) },
			lines,
			'/users/:id',
			'GET',
		);

		const response = await app.request('/users/42');

		expect(response.status).toBe(422);
		expect(lines.map((line) => [line.message, line.fields.part])).toEqual([
			['Request validation failed', 'params'],
		]);
	});

	it('logs a body that cannot be read', async () => {
		const lines: ErrorLine[] = [];
		const app = appFor({ body: z.object({ email: z.email() }) }, lines);

		const response = await app.request('/users', {
			method: 'POST',
			body: '{"email":',
			headers: { 'content-type': 'application/json' },
		});

		expect(response.status).toBeGreaterThanOrEqual(400);
		expect(response.status).toBeLessThan(500);
		expect(lines.map((line) => line.message)).toEqual([
			'Request body could not be read',
		]);
		// The id the response names is the one the log line carries.
		expect(lines[0]?.bindings.requestId).toBe(
			response.headers.get('x-request-id'),
		);
	});

	it('logs nothing for a valid request', async () => {
		const lines: ErrorLine[] = [];
		const app = appFor({ body: z.object({ email: z.email() }) }, lines);

		const response = await app.request('/users', {
			method: 'POST',
			body: JSON.stringify({ email: 'ada@example.com' }),
			headers: { 'content-type': 'application/json' },
		});

		expect(response.status).toBe(200);
		expect(lines).toEqual([]);
	});
});
