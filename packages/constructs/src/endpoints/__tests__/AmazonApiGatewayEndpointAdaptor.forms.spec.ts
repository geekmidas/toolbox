import {
	createMockContext,
	createMockV1Event,
	createMockV2Event,
} from '@geekmidas/testkit/aws';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RestApi } from '../../rest-api';
import { AmazonApiGatewayV1Endpoint } from '../AmazonApiGatewayV1EndpointAdaptor';
import { AmazonApiGatewayV2Endpoint } from '../AmazonApiGatewayV2EndpointAdaptor';

/**
 * API Gateway hands a Lambda a form post as a string — base64 when it is
 * binary or the API says so — and the adaptor reads it as a Hono server does.
 */

const api = new RestApi('Site', { path: '.', defaultAuthorizer: 'none' });

const login = api
	.post('/login')
	.body(z.object({ email: z.email(), tag: z.array(z.string()) }))
	.output(z.object({ email: z.string(), tags: z.number() }))
	.handle(async ({ body }) => ({ email: body.email, tags: body.tag.length }));

const signIn = api
	.post('/sign-in')
	.body(z.object({ password: z.string() }))
	.output(z.string())
	.responseType('text/html')
	.handle(async (_, response) =>
		response.cookie('session', 'abc', { path: '/' }).redirect('/ios'),
	);

const form = 'email=ada%40example.com&tag=a&tag=b';

describe('API Gateway — form bodies', () => {
	it('reads a base64-encoded form body from an HTTP API (v2)', async () => {
		const response = await new AmazonApiGatewayV2Endpoint(login).handler(
			createMockV2Event({
				routeKey: 'POST /login',
				rawPath: '/login',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: Buffer.from(form).toString('base64'),
				isBase64Encoded: true,
			}),
			createMockContext(),
		);

		expect(response.statusCode).toBe(200);
		expect(JSON.parse(response.body!)).toEqual({
			email: 'ada@example.com',
			tags: 2,
		});
	});

	it('reads a base64-encoded form body from a REST API (v1)', async () => {
		const response = await new AmazonApiGatewayV1Endpoint(login).handler(
			createMockV1Event({
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: Buffer.from(form).toString('base64'),
				isBase64Encoded: true,
			}),
			createMockContext(),
		);

		expect(response.statusCode).toBe(200);
		expect(JSON.parse(response.body!)).toEqual({
			email: 'ada@example.com',
			tags: 2,
		});
	});

	it('answers a content type it cannot read with a 415', async () => {
		const response = await new AmazonApiGatewayV2Endpoint(login).handler(
			createMockV2Event({
				routeKey: 'POST /login',
				rawPath: '/login',
				headers: { 'content-type': 'application/xml' },
				body: '<login/>',
			}),
			createMockContext(),
		);

		expect(response.statusCode).toBe(415);
	});
});

describe('API Gateway — redirects', () => {
	it('answers response.redirect() with a 303, Location and no body', async () => {
		const response = await new AmazonApiGatewayV2Endpoint(signIn).handler(
			createMockV2Event({
				routeKey: 'POST /sign-in',
				rawPath: '/sign-in',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: 'password=hunter2',
			}),
			createMockContext(),
		);

		expect(response.statusCode).toBe(303);
		expect(response.headers?.location).toBe('/ios');
		expect(response.body).toBeUndefined();
		expect(response.multiValueHeaders?.['Set-Cookie']?.[0]).toContain(
			'session=abc',
		);
	});
});
