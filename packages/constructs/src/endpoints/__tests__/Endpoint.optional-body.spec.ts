import { EnvironmentParser } from '@geekmidas/envkit';
import { ServiceDiscovery } from '@geekmidas/services';
import { createMockContext, createMockV2Event } from '@geekmidas/testkit/aws';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RestApi } from '../../rest-api';
import { AmazonApiGatewayV2Endpoint } from '../AmazonApiGatewayV2EndpointAdaptor';
import { Endpoint } from '../Endpoint';
import { HonoEndpoint } from '../HonoEndpointAdaptor';
import { TestEndpointAdaptor } from '../TestEndpointAdaptor';

/**
 * A body whose schema accepts `undefined` may be left out: the document says
 * `required: false`, and every adaptor hands the handler `undefined` rather
 * than refusing the request.
 */

const api = new RestApi('OptionalBody', {
	path: '.',
	defaultAuthorizer: 'none',
});

const touch = api
	.post('/touch')
	.body(z.object({ note: z.string() }).optional())
	.output(z.object({ note: z.string().nullable() }))
	.handle(async ({ body }) => ({ note: body?.note ?? null }));

const create = api
	.post('/things')
	.body(z.object({ name: z.string() }))
	.output(z.object({ name: z.string() }))
	.handle(async ({ body }) => ({ name: body.name }));

function app() {
	const hono = new Hono();
	HonoEndpoint.addRoutes(
		[touch, create] as any,
		ServiceDiscovery.getInstance(new EnvironmentParser({})),
		hono,
		{ docsPath: false },
	);
	return hono;
}

describe('an optional request body', () => {
	it('is documented as optional, and a required one as required', async () => {
		const doc = await Endpoint.buildOpenApiSchema([touch, create]);

		expect((doc.paths['/touch'] as any).post.requestBody.required).toBe(false);
		expect((doc.paths['/things'] as any).post.requestBody.required).toBe(true);
	});

	it('is accepted when absent on a server', async () => {
		const response = await app().request('/touch', { method: 'POST' });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ note: null });
	});

	it('is still validated when sent', async () => {
		const sent = await app().request('/touch', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ note: 'hi' }),
		});
		expect(await sent.json()).toEqual({ note: 'hi' });

		const wrong = await app().request('/touch', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ note: 1 }),
		});
		expect(wrong.status).toBe(422);
	});

	it('leaves a required body required', async () => {
		const response = await app().request('/things', { method: 'POST' });

		expect(response.status).toBe(422);
	});

	it('is accepted when absent on API Gateway', async () => {
		const response = await new AmazonApiGatewayV2Endpoint(touch).handler(
			createMockV2Event({ routeKey: 'POST /touch', rawPath: '/touch' }),
			createMockContext(),
		);

		expect(response.statusCode).toBe(200);
		expect(JSON.parse(response.body!)).toEqual({ note: null });
	});

	it('is accepted when absent in a test', async () => {
		const result = await new TestEndpointAdaptor(touch).request({
			services: {},
			headers: {},
		} as any);

		expect(result).toEqual({ note: null });
	});
});
