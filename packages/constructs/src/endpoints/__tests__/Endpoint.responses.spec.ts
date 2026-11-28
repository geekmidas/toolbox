import { EnvironmentParser } from '@geekmidas/envkit';
import { ServiceDiscovery } from '@geekmidas/services';
import { createMockContext, createMockV2Event } from '@geekmidas/testkit/aws';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { recordTopic } from '../../__tests__/__helpers__/recordingPublisher';
import { RestApi } from '../../rest-api';
import { Topic } from '../../topic/Topic';
import { AmazonApiGatewayV2Endpoint } from '../AmazonApiGatewayV2EndpointAdaptor';
import { Endpoint } from '../Endpoint';
import { HonoEndpoint } from '../HonoEndpointAdaptor';
import { binary, UndeclaredResponseContentType } from '../responses';
import { TestEndpointAdaptor } from '../TestEndpointAdaptor';

/**
 * `.response(status, content)`: an endpoint that answers more than one status,
 * or one status in more than one content type, documents each, and the body
 * the handler answers is checked against the response it answers.
 */
const api = new RestApi('Responses', { path: '.', defaultAuthorizer: 'none' });

const Order = z.object({ id: z.string(), total: z.number() });
const Report = z.object({ id: z.string(), rows: z.number() });
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF

const orders = new Topic('ResponseOrders', {
	events: { 'order.created': z.object({ id: z.string() }) },
});

/** 201 when it creates, 200 when a retry hands back the original. */
const putOrder = api
	.put('/orders/:id')
	.params(z.object({ id: z.string() }))
	.output(Order)
	.status(201)
	.event(orders, {
		type: 'order.created',
		payload: (order) => ({ id: order.id }),
	})
	.response(200, z.object({ id: z.string(), retried: z.literal(true) }), {
		description: 'A retry: the order it already created',
	})
	.handle(async ({ params, header }, response) => {
		if (header('idempotency-replay') === 'yes') {
			return response.status(200).send({ id: params.id, retried: true });
		}
		return { id: params.id, total: 10 };
	});

/** JSON, CSV or a PDF, depending on what the caller accepts. */
const getReport = api
	.get('/reports/:id')
	.params(z.object({ id: z.string() }))
	.response(
		200,
		{
			'application/json': Report,
			'text/csv': z.string(),
			'application/pdf': binary(),
		},
		{ description: 'The report' },
	)
	.handle(async ({ params, header }, response) => {
		const accept = header('accept') ?? '';
		if (accept.includes('text/csv')) {
			return response
				.header('content-type', 'text/csv')
				.send(`id,rows\n${params.id},3\n`);
		}
		if (accept.includes('application/pdf')) {
			return response.header('content-type', 'application/pdf').send(PDF);
		}
		return { id: params.id, rows: 3 };
	});

const serve = (endpoint: Endpoint<any, any, any, any, any, any>) => {
	const app = new Hono();
	HonoEndpoint.addRoutes(
		[endpoint],
		new ServiceDiscovery(new EnvironmentParser({})),
		app,
		{ docsPath: false },
	);
	return app;
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe('declared responses — the document', () => {
	it('documents each status the endpoint answers', async () => {
		const doc = await Endpoint.buildOpenApiSchema([putOrder]);
		const responses = (doc.paths['/orders/{id}'] as any).put.responses;

		expect(Object.keys(responses).sort()).toEqual(['200', '201']);
		expect(responses['201']).toMatchObject({
			description: 'Successful response',
			content: {
				'application/json': {
					schema: { type: 'object', required: ['id', 'total'] },
				},
			},
		});
		expect(responses['200']).toMatchObject({
			description: 'A retry: the order it already created',
			content: {
				'application/json': {
					schema: {
						type: 'object',
						properties: { retried: { const: true } },
					},
				},
			},
		});
	});

	it('documents each content type a response is answered in', async () => {
		const doc = await Endpoint.buildOpenApiSchema([getReport]);
		const ok = (doc.paths['/reports/{id}'] as any).get.responses['200'];

		expect(ok.description).toBe('The report');
		expect(Object.keys(ok.content)).toEqual([
			'application/json',
			'text/csv',
			'application/pdf',
		]);
		expect(ok.content['application/json'].schema).toMatchObject({
			type: 'object',
			required: ['id', 'rows'],
		});
		expect(ok.content['text/csv'].schema).toEqual({ type: 'string' });
		expect(ok.content['application/pdf'].schema).toEqual({
			type: 'string',
			format: 'binary',
		});
	});

	it('documents a response with no body without content', async () => {
		const accept = api
			.post('/jobs')
			.output(z.object({ id: z.string() }))
			.response(202, undefined, { description: 'Queued' })
			.handle(async () => ({ id: '1' }));

		const doc = await Endpoint.buildOpenApiSchema([accept]);
		const responses = (doc.paths['/jobs'] as any).post.responses;

		expect(responses['202']).toEqual({ description: 'Queued' });
		expect(responses['200'].content['application/json']).toBeDefined();
	});

	it('puts a registered schema in components, as .output() does', async () => {
		const Receipt = z
			.object({ id: z.string() })
			.meta({ id: 'ResponsesReceipt' });
		const endpoint = api
			.post('/receipts')
			.response(201, Receipt)
			.handle(async () => ({ id: '1' }));

		const doc = await Endpoint.buildOpenApiSchema([endpoint]);

		expect(
			(doc.paths['/receipts'] as any).post.responses['201'].content[
				'application/json'
			].schema,
		).toEqual({ $ref: '#/components/schemas/ResponsesReceipt' });
		expect(doc.components?.schemas).toHaveProperty('ResponsesReceipt');
	});
});

describe('declared responses — served by Hono', () => {
	it('answers the default status, checked against .output()', async () => {
		const publisher = recordTopic(orders);
		const response = await serve(putOrder).request('/orders/o1', {
			method: 'PUT',
		});

		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({ id: 'o1', total: 10 });
		expect(publisher.published).toEqual([
			{ type: 'order.created', payload: { id: 'o1' } },
		]);
	});

	it("checks another status's body against that response, and publishes no event for it", async () => {
		const publisher = recordTopic(orders);
		const response = await serve(putOrder).request('/orders/o1', {
			method: 'PUT',
			headers: { 'idempotency-replay': 'yes' },
		});

		expect(response.status).toBe(200);
		// `.output()` would have stripped `retried` and failed on `total`.
		expect(await response.json()).toEqual({ id: 'o1', retried: true });
		expect(publisher.calls).toEqual([]);
	});

	it('refuses a body its declared response does not describe', async () => {
		const wrong = api
			.put('/wrong/:id')
			.output(Order)
			.status(201)
			.response(200, z.object({ retried: z.literal(true) }))
			.handle(async (_ctx, response) =>
				// The default's shape, answered as the declared 200.
				response
					.status(200)
					.send({ id: '1', total: 1 } as never),
			);

		const response = await serve(wrong).request('/wrong/1', {
			method: 'PUT',
		});

		expect(response.status).toBe(422);
	});

	it('answers JSON by default', async () => {
		const response = await serve(getReport).request('/reports/r1');

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(await response.json()).toEqual({ id: 'r1', rows: 3 });
	});

	it('emits a CSV as-is', async () => {
		const response = await serve(getReport).request('/reports/r1', {
			headers: { accept: 'text/csv' },
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/csv');
		expect(await response.text()).toBe('id,rows\nr1,3\n');
	});

	it('emits a PDF as its bytes', async () => {
		const response = await serve(getReport).request('/reports/r1', {
			headers: { accept: 'application/pdf' },
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/pdf');
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);
	});

	it('refuses a content type the response does not list', async () => {
		const xml = api
			.get('/xml')
			.response(200, { 'application/json': Report })
			.handle(async (_ctx, response) =>
				response.header('content-type', 'application/xml').send('<r/>'),
			);

		const endpoint = xml as unknown as Endpoint<any, any>;
		expect(() =>
			endpoint.contentTypeFor(200, { 'content-type': 'application/xml' }),
		).toThrow(UndeclaredResponseContentType);

		const response = await serve(xml).request('/xml');
		expect(response.status).toBe(500);
	});
});

describe('declared responses — the test adaptor', () => {
	it('checks a declared status against its own response', async () => {
		const response = await new TestEndpointAdaptor(putOrder).fullRequest({
			params: { id: 'o1' },
			services: {} as never,
			headers: { host: 'example.com', 'idempotency-replay': 'yes' },
		});

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ id: 'o1', retried: true });
	});
});

describe('declared responses — served by API Gateway', () => {
	const event = (headers: Record<string, string>) =>
		createMockV2Event({
			routeKey: 'GET /reports/{id}',
			rawPath: '/reports/r1',
			pathParameters: { id: 'r1' },
			headers,
		});

	it('emits a CSV as-is', async () => {
		const response = await new AmazonApiGatewayV2Endpoint(
			getReport as never,
		).handler(event({ accept: 'text/csv' }), createMockContext());

		expect(response.statusCode).toBe(200);
		expect(response.headers?.['content-type']).toBe('text/csv');
		expect(response.body).toBe('id,rows\nr1,3\n');
		expect(response.isBase64Encoded).toBeUndefined();
	});

	it('emits a PDF base64-encoded', async () => {
		const response = await new AmazonApiGatewayV2Endpoint(
			getReport as never,
		).handler(event({ accept: 'application/pdf' }), createMockContext());

		expect(response.statusCode).toBe(200);
		expect(response.headers?.['content-type']).toBe('application/pdf');
		expect(response.isBase64Encoded).toBe(true);
		expect(Buffer.from(response.body!, 'base64')).toEqual(Buffer.from(PDF));
	});

	it('JSON-encodes the default content type', async () => {
		const response = await new AmazonApiGatewayV2Endpoint(
			getReport as never,
		).handler(event({}), createMockContext());

		expect(response.statusCode).toBe(200);
		expect(JSON.parse(response.body!)).toEqual({ id: 'r1', rows: 3 });
	});
});
