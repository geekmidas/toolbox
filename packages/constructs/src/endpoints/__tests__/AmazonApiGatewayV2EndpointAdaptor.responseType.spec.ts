import { EnvironmentParser } from '@geekmidas/envkit';
import { createMockContext, createMockV2Event } from '@geekmidas/testkit/aws';
import type { Context } from 'aws-lambda';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RestApi } from '../../rest-api';
import { AmazonApiGatewayV2Endpoint } from '../AmazonApiGatewayV2EndpointAdaptor';

/** Endpoints are built from a surface now, so this builds one. */
const api = new RestApi('Test', { default: 'none' });

describe('AmazonApiGatewayV2Endpoint — responseType', () => {
	let envParser: EnvironmentParser<{}>;
	let mockContext: Context;

	beforeEach(() => {
		envParser = new EnvironmentParser({});
		mockContext = createMockContext();
	});

	it('JSON-stringifies body with no content-type header when responseType is default', async () => {
		const endpoint = api
			.get('/users/:id')
			.params(z.object({ id: z.string() }))
			.output(z.object({ id: z.string() }))
			.handle(async ({ params }) => ({ id: params.id }));

		const adapter = new AmazonApiGatewayV2Endpoint(endpoint);

		const event = createMockV2Event({
			routeKey: 'GET /users/{id}',
			rawPath: '/users/123',
			pathParameters: { id: '123' },
		});

		const response = await adapter.handler(event, mockContext);

		expect(response.statusCode).toBe(200);
		expect(response.body).toBe(JSON.stringify({ id: '123' }));
		// Default JSON responseType should not inject a default content-type
		expect(response.headers?.['content-type']).toBeUndefined();
	});

	it('emits raw string body and text/html header when responseType is text/html', async () => {
		const html = '<html><body>Checkout</body></html>';
		const endpoint = api
			.get('/checkout-page')
			.output(z.string())
			.responseType('text/html')
			.handle(async () => html);

		const adapter = new AmazonApiGatewayV2Endpoint(endpoint);

		const event = createMockV2Event({
			routeKey: 'GET /checkout-page',
			rawPath: '/checkout-page',
		});

		const response = await adapter.handler(event, mockContext);

		expect(response.statusCode).toBe(200);
		// Body emitted as-is, NOT JSON-encoded (would be `"<html>..."`)
		expect(response.body).toBe(html);
		expect(response.body?.startsWith('"')).toBe(false);
		expect(response.headers?.['content-type']).toBe('text/html');
	});

	it('emits raw plain text for text/plain', async () => {
		const endpoint = api
			.get('/robots.txt')
			.output(z.string())
			.responseType('text/plain')
			.handle(async () => 'User-agent: *');

		const adapter = new AmazonApiGatewayV2Endpoint(endpoint);

		const event = createMockV2Event({
			routeKey: 'GET /robots.txt',
			rawPath: '/robots.txt',
		});

		const response = await adapter.handler(event, mockContext);

		expect(response.statusCode).toBe(200);
		expect(response.body).toBe('User-agent: *');
		expect(response.headers?.['content-type']).toBe('text/plain');
	});

	it('lets r.header() runtime override win over endpoint.responseType', async () => {
		const endpoint = api
			.get('/dynamic')
			.output(z.string())
			.responseType('text/html')
			.handle(async (_ctx, r) => {
				r.header('content-type', 'text/xml');
				return r.send('<xml></xml>');
			});

		const adapter = new AmazonApiGatewayV2Endpoint(endpoint);

		const event = createMockV2Event({
			routeKey: 'GET /dynamic',
			rawPath: '/dynamic',
		});

		const response = await adapter.handler(event, mockContext);

		expect(response.statusCode).toBe(200);
		// Body still emitted raw because responseType is not JSON
		expect(response.body).toBe('<xml></xml>');
		// Runtime r.header() wins over the declared responseType default
		expect(response.headers?.['content-type']).toBe('text/xml');
	});
});
