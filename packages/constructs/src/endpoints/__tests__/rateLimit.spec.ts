import { InMemoryCache } from '@geekmidas/cache/memory';
import { EnvironmentParser } from '@geekmidas/envkit';
import { ConflictError, HttpError } from '@geekmidas/errors';
import { TooManyRequestsError } from '@geekmidas/rate-limit';
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
import { HonoEndpoint } from '../HonoEndpointAdaptor';
import { TestEndpointAdaptor } from '../TestEndpointAdaptor';

/**
 * An endpoint over its `.rateLimit()` answers 429 — with `Retry-After`, the
 * seconds until the window resets, and the `X-RateLimit-*` headers — on every
 * adaptor that serves it. It used to answer 500: the limiter's error carried a
 * `statusCode` but was not an `HttpError`, so every adaptor flattened it.
 */

const api = new RestApi('Limited', { path: '.', defaultAuthorizer: 'none' });

/** One request per minute, counted in a cache of its own. */
const limited = () =>
	api
		.get('/limited')
		.rateLimit({ limit: 1, windowMs: 60_000, cache: new InMemoryCache() })
		.output(z.object({ ok: z.boolean() }))
		.handle(() => ({ ok: true }));

function hono(endpoints: unknown[]): Hono {
	const app = new Hono();
	HonoEndpoint.addRoutes(
		endpoints as any,
		ServiceDiscovery.getInstance(new EnvironmentParser({})),
		app,
		{ docsPath: false },
	);
	return app;
}

describe('a rate-limited endpoint, over its limit', () => {
	it('answers 429 with Retry-After through Hono', async () => {
		const app = hono([limited()]);

		const first = await app.request('/limited');
		expect(first.status).toBe(200);
		expect(first.headers.get('x-ratelimit-limit')).toBe('1');
		expect(first.headers.get('x-ratelimit-remaining')).toBe('0');

		const second = await app.request('/limited');
		expect(second.status).toBe(429);
		const retryAfter = Number(second.headers.get('retry-after'));
		expect(retryAfter).toBeGreaterThan(0);
		expect(retryAfter).toBeLessThanOrEqual(60);
		expect(second.headers.get('x-ratelimit-limit')).toBe('1');
		expect(second.headers.get('x-ratelimit-remaining')).toBe('0');
		expect(second.headers.get('x-ratelimit-reset')).toEqual(expect.any(String));
		expect(await second.json()).toMatchObject({
			name: 'TooManyRequestsError',
			statusCode: 429,
			statusMessage: 'Too Many Requests',
			message: 'Too many requests, please try again later.',
			details: { retryAfter },
		});
	});

	it('answers 429 with Retry-After through an HTTP API Lambda (v2)', async () => {
		const handler = new AmazonApiGatewayV2Endpoint(limited()).handler;
		const event = () =>
			createMockV2Event({
				routeKey: 'GET /limited',
				rawPath: '/limited',
				headers: { 'x-forwarded-for': '203.0.113.7' },
			});

		const first = await handler(event(), createMockContext());
		expect(first.statusCode).toBe(200);
		expect(first.headers).toMatchObject({ 'X-RateLimit-Limit': '1' });

		const second = await handler(event(), createMockContext());
		expect(second.statusCode).toBe(429);
		expect(Number(second.headers?.['Retry-After'])).toBeGreaterThan(0);
		expect(second.headers).toMatchObject({
			'X-RateLimit-Limit': '1',
			'X-RateLimit-Remaining': '0',
		});
	});

	it('answers 429 with Retry-After through a REST API Lambda (v1)', async () => {
		const handler = new AmazonApiGatewayV1Endpoint(limited()).handler;
		const event = () =>
			createMockV1Event({
				path: '/limited',
				httpMethod: 'GET',
				headers: { 'x-forwarded-for': '203.0.113.7' },
			});

		expect((await handler(event(), createMockContext())).statusCode).toBe(200);
		const second = await handler(event(), createMockContext());
		expect(second.statusCode).toBe(429);
		expect(Number(second.headers?.['Retry-After'])).toBeGreaterThan(0);
	});

	it('throws the 429 from the test adaptor, with its headers', async () => {
		const adaptor = new TestEndpointAdaptor(limited());
		const request = () =>
			adaptor.fullRequest({ services: {}, headers: { host: 'example.com' } });

		const first = await request();
		expect(first.status).toBe(200);
		expect(first.headers).toMatchObject({ 'X-RateLimit-Remaining': '0' });

		const error = await request().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(TooManyRequestsError);
		expect(error).toMatchObject({
			statusCode: 429,
			headers: { 'Retry-After': expect.any(String) },
		});
	});
});

describe('an error a handler throws, through Hono', () => {
	const throwing = (error: unknown) =>
		api
			.get('/throws')
			.output(z.object({ ok: z.boolean() }))
			.handle(() => {
				throw error;
			});

	it('passes an HttpError through, its status and headers with it', async () => {
		const response = await hono([
			throwing(
				new HttpError(401, 'Sign in first', {
					headers: { 'WWW-Authenticate': 'Bearer' },
				}),
			),
		]).request('/throws');

		expect(response.status).toBe(401);
		expect(response.headers.get('www-authenticate')).toBe('Bearer');
	});

	it('passes a subclass of HttpError through', async () => {
		const response = await hono([
			throwing(new ConflictError('Already there')),
		]).request('/throws');

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ message: 'Already there' });
	});

	it('answers 500 for an error that is not an HttpError, whatever it carries', async () => {
		const shaped = Object.assign(new Error('Looks like a 429'), {
			statusCode: 429,
			headers: { 'Retry-After': '5' },
		});

		const response = await hono([throwing(shaped)]).request('/throws');

		expect(response.status).toBe(500);
		expect(response.headers.get('retry-after')).toBeNull();
		expect(await response.json()).toMatchObject({
			message: 'Internal Server Error',
		});
	});
});
