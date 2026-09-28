import type { Context as LambdaContext } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryStorage } from '../../storage/memory';
import { Telescope } from '../../Telescope';
import {
	detectLambdaResources,
	LambdaAdapter,
	wrapLambdaHandler,
} from '../lambda';

const context = { awsRequestId: 'r' } as LambdaContext;

describe('LambdaAdapter.extractRequestContext', () => {
	const adapter = new LambdaAdapter(
		new Telescope({ storage: new InMemoryStorage() }),
	);

	it('reads a REST API event, falling back where fields are missing', () => {
		const ctx = adapter.extractRequestContext({
			httpMethod: '',
			path: '',
			headers: {
				'X-Forwarded-For': '1.2.3.4, 5.6.7.8',
				'Content-Length': '12',
				Dropped: undefined,
			},
			body: '{"a":1}',
		});

		expect(ctx).toMatchObject({
			method: 'UNKNOWN',
			path: '/',
			query: {},
			ip: '1.2.3.4',
			requestSize: 12,
			body: { a: 1 },
			headers: {
				'x-forwarded-for': '1.2.3.4, 5.6.7.8',
				'content-length': '12',
			},
		});
		expect(ctx.id).toBeTruthy();
	});

	it('reads an HTTP API event, decoding a base64 body', () => {
		const ctx = adapter.extractRequestContext({
			rawPath: '',
			requestContext: { http: {} },
			headers: { 'x-forwarded-for': '9.9.9.9' },
			body: Buffer.from('{"b":2}').toString('base64'),
			isBase64Encoded: true,
		});

		expect(ctx).toMatchObject({
			method: 'UNKNOWN',
			path: '/',
			ip: '9.9.9.9',
			body: { b: 2 },
			requestSize: undefined,
		});
	});

	it('reads an HTTP API event with its request id and size', () => {
		const ctx = adapter.extractRequestContext({
			rawPath: '/orders',
			requestContext: {
				requestId: 'req-2',
				http: { method: 'POST', sourceIp: '8.8.8.8' },
			},
			headers: { 'content-length': '3' },
			queryStringParameters: { page: '2' },
			body: 'raw',
		});

		expect(ctx).toMatchObject({
			id: 'req-2',
			method: 'POST',
			path: '/orders',
			ip: '8.8.8.8',
			query: { page: '2' },
			requestSize: 3,
			body: 'raw',
		});
	});

	it('reads a load balancer event', () => {
		const ctx = adapter.extractRequestContext({
			httpMethod: 'PUT',
			headers: { 'x-forwarded-for': '4.4.4.4', 'content-length': '5' },
			queryStringParameters: { q: 'x' },
			body: 'not json',
		});

		expect(ctx).toMatchObject({
			method: 'PUT',
			path: '/',
			ip: '4.4.4.4',
			query: { q: 'x' },
			requestSize: 5,
			body: 'not json',
		});
	});

	it('reads a load balancer event with nothing optional', () => {
		const ctx = adapter.extractRequestContext({ httpMethod: '' });

		expect(ctx).toMatchObject({
			method: 'UNKNOWN',
			path: '/',
			headers: {},
			query: {},
			body: undefined,
		});
	});

	it('treats anything else as a plain invocation', () => {
		const ctx = adapter.extractRequestContext({ records: [1] });

		expect(ctx).toMatchObject({
			method: 'INVOKE',
			path: '/',
			body: { records: [1] },
		});
	});
});

describe('LambdaAdapter.extractResponseContext', () => {
	const adapter = new LambdaAdapter(
		new Telescope({ storage: new InMemoryStorage() }),
	);

	it('prefers the Content-Length header', () => {
		const res = adapter.extractResponseContext(
			{ statusCode: 201, headers: { 'Content-Length': '99' }, body: 'x' },
			Date.now(),
		);

		expect(res).toMatchObject({ status: 201, responseSize: 99 });
	});

	it('measures a string body when there is no header', () => {
		const res = adapter.extractResponseContext(
			{ statusCode: 0, body: 'héllo' },
			Date.now(),
		);

		expect(res).toMatchObject({ status: 200, responseSize: 6, headers: {} });
	});

	it('leaves the size unknown for a non-string body', () => {
		const res = adapter.extractResponseContext(
			{ statusCode: 204, body: { ok: true } },
			Date.now(),
		);

		expect(res.responseSize).toBeUndefined();
	});

	it('treats any other result as a 200', () => {
		expect(adapter.extractResponseContext('done', Date.now())).toMatchObject({
			status: 200,
			body: 'done',
		});
	});
});

describe('detectLambdaResources', () => {
	const saved = { ...process.env };
	afterEach(() => {
		process.env = { ...saved };
	});

	it('says unknown for anything the runtime did not set', () => {
		for (const key of [
			'AWS_REGION',
			'AWS_LAMBDA_FUNCTION_NAME',
			'AWS_LAMBDA_FUNCTION_VERSION',
			'AWS_LAMBDA_LOG_STREAM_NAME',
			'AWS_LAMBDA_FUNCTION_MEMORY_SIZE',
		]) {
			delete process.env[key];
		}

		expect(detectLambdaResources()).toMatchObject({
			'cloud.region': 'unknown',
			'faas.name': 'unknown',
			'faas.version': 'unknown',
			'faas.instance': 'unknown',
		});
	});
});

describe('LambdaAdapter lifecycle', () => {
	it('detects resources on setup only when asked', async () => {
		const telescope = new Telescope({ storage: new InMemoryStorage() });
		const detecting = new LambdaAdapter(telescope, { detectResource: true });
		const quiet = new LambdaAdapter(telescope, { detectResource: false });

		await detecting.onSetup();
		await quiet.onSetup();

		expect(detecting.getResourceAttributes()).not.toBeNull();
		expect(quiet.getResourceAttributes()).toBeNull();
		await expect(detecting.onDestroy()).resolves.toBeUndefined();
	});
});

describe('wrapLambdaHandler', () => {
	let storage: InMemoryStorage;
	let telescope: Telescope;

	beforeEach(() => {
		storage = new InMemoryStorage();
		telescope = new Telescope({ storage });
	});

	afterEach(() => telescope.destroy());

	it('rethrows a thrown non-Error without recording an exception', async () => {
		const handler = wrapLambdaHandler(
			telescope,
			async () => {
				throw 'plain string';
			},
			{ autoFlush: false },
		);

		await expect(handler({ records: [] }, context)).rejects.toBe(
			'plain string',
		);
		expect(await telescope.getExceptions()).toEqual([]);
	});

	it('records the request without flushing when auto-flush is off', async () => {
		const handler = wrapLambdaHandler(
			telescope,
			async () => ({ statusCode: 200, body: 'ok' }),
			{ autoFlush: false },
		);

		await handler({ httpMethod: 'GET', path: '/x' }, context);

		expect((await telescope.getRequests()).map((r) => r.path)).toEqual(['/x']);
	});
});
