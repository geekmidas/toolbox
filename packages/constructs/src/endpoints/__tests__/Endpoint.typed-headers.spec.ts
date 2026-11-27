import { EnvironmentParser } from '@geekmidas/envkit';
import { ServiceDiscovery } from '@geekmidas/services';
import {
	createMockContext,
	createMockV1Event,
	createMockV2Event,
} from '@geekmidas/testkit/aws';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RestApi } from '../../rest-api';
import { AmazonApiGatewayV1Endpoint } from '../AmazonApiGatewayV1EndpointAdaptor';
import { AmazonApiGatewayV2Endpoint } from '../AmazonApiGatewayV2EndpointAdaptor';
import { Endpoint } from '../Endpoint';
import { HonoEndpoint } from '../HonoEndpointAdaptor';
import {
	defineHeader,
	HeaderNameNotLowerCase,
	RequestHeadersInvalid,
} from '../headers';
import { TestEndpointAdaptor } from '../TestEndpointAdaptor';

/**
 * Request headers are declared with `.headers()`, validated like the query
 * — a refusal is 400 — and documented as `in: header` parameters. Response
 * headers are declared with `.responseHeaders()` and documented under the
 * response. A header made by `defineHeader()` is written once, under
 * `components`, and referred to with `$ref`.
 */

const IdempotencyKey = defineHeader('Idempotency-Key', {
	schema: z.string().min(8),
	description: 'Makes a retried request safe to repeat.',
});
const ETag = defineHeader('ETag', {
	schema: z.string(),
	description: 'The version of the resource returned (RFC 9110 §8.8.3).',
});

const api = new RestApi('TypedHeaders', {
	path: '.',
	defaultAuthorizer: 'none',
});

const pay = api
	.post('/payments')
	.headers({
		'Idempotency-Key': IdempotencyKey,
		'if-match': z.string().optional(),
	})
	.body(z.object({ amount: z.number() }))
	.output(z.object({ key: z.string(), ifMatch: z.string().nullable() }))
	.status(201)
	.responseHeaders({
		ETag,
		Location: { schema: z.string(), description: 'Where the payment is' },
		'Retry-After': { schema: z.string().optional() },
	})
	.handle(async ({ headers }, response) =>
		response
			.header('ETag', '"v1"')
			.header('Location', `/payments/${headers['idempotency-key']}`)
			.send({
				key: headers['idempotency-key'],
				ifMatch: headers['if-match'] ?? null,
			}),
	);

const page = api
	.get('/things')
	.headers(
		z.object({
			'x-page-size': z.coerce.number().int().default(10),
			'if-none-match': z.string().optional(),
		}),
	)
	.query(z.object({ q: z.string().optional() }))
	.responseHeaders({ ETag })
	.output(z.object({ size: z.number() }))
	.handle(async ({ headers }) => ({ size: headers['x-page-size'] }));

const plain = api
	.get('/plain')
	.output(z.object({ ok: z.boolean() }))
	.handle(async () => ({ ok: true }));

function app() {
	const hono = new Hono();
	HonoEndpoint.addRoutes(
		[pay, page, plain] as any,
		ServiceDiscovery.getInstance(new EnvironmentParser({})),
		hono,
		{ docsPath: false },
	);
	return hono;
}

const json = (headers: Record<string, string> = {}) => ({
	method: 'POST',
	headers: { 'content-type': 'application/json', ...headers },
	body: JSON.stringify({ amount: 5 }),
});

describe('the document', () => {
	it('lists request headers as `in: header` parameters', async () => {
		const doc = await Endpoint.buildOpenApiSchema([pay, page, plain]);

		const payParameters = (doc.paths['/payments'] as any).post.parameters;
		expect(payParameters).toEqual([
			{ $ref: '#/components/parameters/Idempotency-Key' },
			{
				name: 'if-match',
				in: 'header',
				required: false,
				schema: { type: 'string' },
			},
		]);
		expect(doc.components?.parameters?.['Idempotency-Key']).toEqual({
			name: 'Idempotency-Key',
			in: 'header',
			required: true,
			description: 'Makes a retried request safe to repeat.',
			schema: { type: 'string', minLength: 8 },
		});

		const pageParameters = (doc.paths['/things'] as any).get.parameters;
		expect(pageParameters).toEqual([
			expect.objectContaining({ name: 'q', in: 'query' }),
			expect.objectContaining({
				name: 'x-page-size',
				in: 'header',
				required: false,
			}),
			expect.objectContaining({
				name: 'if-none-match',
				in: 'header',
				required: false,
			}),
		]);

		expect((doc.paths['/plain'] as any).get.parameters).toBeUndefined();
	});

	it('documents the response headers under the response', async () => {
		const doc = await Endpoint.buildOpenApiSchema([pay, page, plain]);

		const created = (doc.paths['/payments'] as any).post.responses['201'];
		expect(created.headers).toEqual({
			ETag: { $ref: '#/components/headers/ETag' },
			Location: {
				required: true,
				description: 'Where the payment is',
				schema: { type: 'string' },
			},
			'Retry-After': { required: false, schema: { type: 'string' } },
		});
		expect((doc.paths['/things'] as any).get.responses['200'].headers).toEqual({
			ETag: { $ref: '#/components/headers/ETag' },
		});
		expect(doc.components?.headers).toEqual({
			ETag: {
				required: true,
				description: 'The version of the resource returned (RFC 9110 §8.8.3).',
				schema: { type: 'string' },
			},
		});
		expect(
			(doc.paths['/plain'] as any).get.responses['200'].headers,
		).toBeUndefined();
	});

	it('adds no components to a document without shared headers', async () => {
		const doc = await Endpoint.buildOpenApiSchema([plain]);

		expect(doc.components?.parameters).toBeUndefined();
		expect(doc.components?.headers).toBeUndefined();
	});
});

describe('on a server', () => {
	it('hands the handler the headers it declared, by lower-case name', async () => {
		const response = await app().request(
			'/payments',
			json({ 'Idempotency-Key': 'key-12345', 'If-Match': '"v0"' }),
		);

		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({
			key: 'key-12345',
			ifMatch: '"v0"',
		});
		expect(response.headers.get('etag')).toBe('"v1"');
		expect(response.headers.get('location')).toBe('/payments/key-12345');
	});

	it('answers a missing required header with 400', async () => {
		const response = await app().request('/payments', json());

		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.name).toBe('RequestHeadersInvalid');
		expect(body.message).toContain('idempotency-key');
	});

	it('answers a header its schema refuses with 400', async () => {
		const response = await app().request(
			'/payments',
			json({ 'idempotency-key': 'short' }),
		);

		expect(response.status).toBe(400);
	});

	it('parses a header with its schema', async () => {
		const sized = await app().request('/things', {
			headers: { 'X-Page-Size': '25' },
		});
		expect(await sized.json()).toEqual({ size: 25 });

		const unsized = await app().request('/things');
		expect(await unsized.json()).toEqual({ size: 10 });
	});
});

describe('on API Gateway', () => {
	it('hands the handler the headers it declared (v2)', async () => {
		const response = await new AmazonApiGatewayV2Endpoint(pay).handler(
			createMockV2Event({
				routeKey: 'POST /payments',
				rawPath: '/payments',
				headers: {
					'content-type': 'application/json',
					'idempotency-key': 'key-12345',
				},
				body: JSON.stringify({ amount: 5 }),
			}),
			createMockContext(),
		);

		expect(response.statusCode).toBe(201);
		expect(JSON.parse(response.body!)).toEqual({
			key: 'key-12345',
			ifMatch: null,
		});
	});

	it('lower-cases the names before validating them (v1)', async () => {
		const response = await new AmazonApiGatewayV1Endpoint(pay).handler(
			createMockV1Event({
				httpMethod: 'POST',
				path: '/payments',
				headers: {
					'Content-Type': 'application/json',
					'Idempotency-Key': 'key-12345',
				},
				body: JSON.stringify({ amount: 5 }),
			}),
			createMockContext(),
		);

		expect(response.statusCode).toBe(201);
		expect(JSON.parse(response.body!).key).toBe('key-12345');
	});

	it('answers a missing required header with 400', async () => {
		const response = await new AmazonApiGatewayV2Endpoint(pay).handler(
			createMockV2Event({
				routeKey: 'POST /payments',
				rawPath: '/payments',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ amount: 5 }),
			}),
			createMockContext(),
		);

		expect(response.statusCode).toBe(400);
	});
});

describe('in a test', () => {
	it('hands the handler the headers it declared', async () => {
		const result = await new TestEndpointAdaptor(pay).fullRequest({
			services: {},
			headers: { 'Idempotency-Key': 'key-12345' },
			body: { amount: 5 },
		} as any);

		expect(result.status).toBe(201);
		expect(result.body).toEqual({ key: 'key-12345', ifMatch: null });
		expect(result.headers.ETag).toBe('"v1"');
	});

	it('refuses a missing required header as a server would', async () => {
		const request = new TestEndpointAdaptor(pay).request({
			services: {},
			headers: {},
			body: { amount: 5 },
		} as any);

		await expect(request).rejects.toBeInstanceOf(RequestHeadersInvalid);
		await expect(request).rejects.toMatchObject({ statusCode: 400 });
	});
});

describe('.headers()', () => {
	it('refuses an object schema whose keys are not lower-case', () => {
		expect(() =>
			api.get('/upper').headers(z.object({ 'Idempotency-Key': z.string() })),
		).toThrow(HeaderNameNotLowerCase);
	});
});
