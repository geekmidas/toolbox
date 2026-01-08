import { EnvironmentParser } from '@geekmidas/envkit';
import { createMockContext, createMockV2Event } from '@geekmidas/testkit/aws';
import type { Context } from 'aws-lambda';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AmazonApiGatewayV2Endpoint } from '../AmazonApiGatewayV2EndpointAdaptor';
import { e } from '../EndpointFactory';

describe('AmazonApiGatewayV2Endpoint', () => {
	let envParser: EnvironmentParser<{}>;
	let mockContext: Context;

	beforeEach(() => {
		envParser = new EnvironmentParser({});
		mockContext = createMockContext();
	});

	describe('getInput', () => {
		it('should parse request body, query, and params', () => {
			const endpoint = e.get('/test').handle(() => ({ success: true }));
			const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);

			const event = createMockV2Event({
				rawQueryString: 'foo=bar&baz=qux',
				queryStringParameters: { foo: 'bar', baz: 'qux' },
				pathParameters: { id: '123' },
				body: JSON.stringify({ name: 'test' }),
			});

			const result = adapter.getInput(event);

			expect(result).toEqual({
				body: { name: 'test' },
				query: { foo: 'bar', baz: 'qux' },
				params: { id: '123' },
			});
		});

		it('should handle missing body, query, and params', () => {
			const endpoint = e.get('/test').handle(() => ({ success: true }));
			const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);

			const event = createMockV2Event();

			const result = adapter.getInput(event);

			expect(result).toEqual({
				body: undefined,
				query: {},
				params: {},
			});
		});
	});

	describe('getLoggerContext', () => {
		it('should extract logger context from event and context', () => {
			const endpoint = e.get('/test').handle(() => ({ success: true }));
			const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);

			const event = createMockV2Event({
				requestContext: {
					...createMockV2Event().requestContext,
					http: {
						method: 'GET',
						path: '/test/123',
						protocol: 'HTTP/1.1',
						sourceIp: '192.168.1.1',
						userAgent: 'Mozilla/5.0 Test',
					},
					requestId: 'event-request-id',
				},
			});

			const result = adapter.getLoggerContext(event, mockContext);

			expect(result).toEqual({
				fn: {
					name: 'test-function',
					version: '1',
				},
				req: {
					id: 'event-request-id',
					awsRequestId: 'test-request-id',
					ip: '192.168.1.1',
					userAgent: 'Mozilla/5.0 Test',
					path: '/test/123',
				},
			});
		});

		it('should handle missing user agent', () => {
			const endpoint = e.get('/test').handle(() => ({ success: true }));
			const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);

			const event = createMockV2Event({
				requestContext: {
					...createMockV2Event().requestContext,
					http: {
						method: 'GET',
						path: '/test',
						protocol: 'HTTP/1.1',
						sourceIp: '127.0.0.1',
						userAgent: '',
					},
				},
			});

			const result = adapter.getLoggerContext(event, mockContext);

			expect(result.req.userAgent).toBeUndefined();
		});
	});

	describe('integration', () => {
		it('should handle endpoint with body schema validation', async () => {
			const endpoint = e
				.post('/users')
				.body(z.object({ name: z.string(), age: z.number() }))
				.output(z.object({ id: z.string(), name: z.string() }))
				.handle(async ({ body }) => ({
					id: '123',
					name: body.name,
				}));

			const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);

			const event = createMockV2Event({
				routeKey: 'POST /users',
				rawPath: '/users',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'John', age: 30 }),
			});
			// @ts-ignore
			const response = await adapter.handler(event, mockContext);

			expect(response).toEqual({
				statusCode: 200,
				body: JSON.stringify({ id: '123', name: 'John' }),
			});
		});

		it('should handle array query parameters (comma-separated)', async () => {
			const endpoint = e
				.get('/search')
				.query(
					z.object({
						tags: z.array(z.string()),
						limit: z.coerce.number().default(10),
					}),
				)
				.output(
					z.object({
						tags: z.array(z.string()),
						limit: z.number(),
					}),
				)
				.handle(async ({ query }) => ({
					tags: query.tags,
					limit: query.limit,
				}));

			const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);

			const event = createMockV2Event({
				routeKey: 'GET /search',
				rawPath: '/search',
				rawQueryString: 'tags=nodejs,typescript,javascript&limit=20',
				queryStringParameters: {
					tags: 'nodejs,typescript,javascript',
					limit: '20',
				},
			});
			// @ts-ignore
			const response = await adapter.handler(event, mockContext);

			expect(response).toEqual({
				statusCode: 200,
				body: JSON.stringify({
					tags: ['nodejs', 'typescript', 'javascript'],
					limit: 20,
				}),
			});
		});

		it('should handle object query parameters with dot notation', async () => {
			const endpoint = e
				.get('/search')
				.query(
					z.object({
						filter: z.object({
							category: z.string(),
							active: z.coerce.boolean(),
						}),
					}),
				)
				.output(
					z.object({
						filter: z.object({
							category: z.string(),
							active: z.boolean(),
						}),
					}),
				)
				.handle(async ({ query }) => ({
					filter: query.filter,
				}));

			const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);

			const event = createMockV2Event({
				routeKey: 'GET /search',
				rawPath: '/search',
				rawQueryString: 'filter.category=electronics&filter.active=true',
				queryStringParameters: {
					'filter.category': 'electronics',
					'filter.active': 'true',
				},
			});
			// @ts-ignore
			const response = await adapter.handler(event, mockContext);

			expect(response).toEqual({
				statusCode: 200,
				body: JSON.stringify({
					filter: {
						category: 'electronics',
						active: true,
					},
				}),
			});
		});

		it('should handle endpoint with query and params', async () => {
			const endpoint = e
				.get('/users/:id')
				.params(z.object({ id: z.string() }))
				.query(z.object({ include: z.string().optional() }))
				.output(z.object({ id: z.string(), include: z.string().optional() }))
				.handle(async ({ params, query }) => ({
					id: params.id,
					include: query.include,
				}));

			const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);

			const event = createMockV2Event({
				routeKey: 'GET /users/{id}',
				rawPath: '/users/123',
				rawQueryString: 'include=profile',
				queryStringParameters: { include: 'profile' },
				pathParameters: { id: '123' },
			});
			// @ts-ignore
			const response = await adapter.handler(event, mockContext);

			expect(response).toEqual({
				statusCode: 200,
				body: JSON.stringify({ id: '123', include: 'profile' }),
			});
		});

		describe('response metadata', () => {
			it('should set response cookies', async () => {
				const endpoint = e
					.get('/test')
					.output(z.object({ success: z.boolean() }))
					.handle((_, response) => {
						response.cookie('session', 'abc123', {
							httpOnly: true,
							secure: true,
						});
						return { success: true };
					});

				const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);
				const event = createMockV2Event();
				// @ts-ignore
				const response = await adapter.handler(event, mockContext);

				expect(response.multiValueHeaders?.['Set-Cookie']).toEqual([
					'session=abc123; HttpOnly; Secure',
				]);
				expect(response.statusCode).toBe(200);
				expect(response.body).toBe(JSON.stringify({ success: true }));
			});

			it('should set custom headers', async () => {
				const endpoint = e
					.get('/test')
					.output(z.object({ success: z.boolean() }))
					.handle((_, response) => {
						response.header('X-Custom-Header', 'custom-value');
						response.header('X-Request-Id', '12345');
						return { success: true };
					});

				const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);
				const event = createMockV2Event();
				// @ts-ignore
				const response = await adapter.handler(event, mockContext);

				expect(response.headers).toEqual({
					'X-Custom-Header': 'custom-value',
					'X-Request-Id': '12345',
				});
			});

			it('should set custom status code', async () => {
				const endpoint = e
					.post('/test')
					.output(z.object({ id: z.string() }))
					.handle((_, response) => {
						response.status(201);
						return { id: '123' };
					});

				const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);
				const event = createMockV2Event({ routeKey: 'POST /test' });
				// @ts-ignore
				const response = await adapter.handler(event, mockContext);

				expect(response.statusCode).toBe(201);
			});

			it('should combine cookies, headers, and status', async () => {
				const endpoint = e
					.post('/test')
					.output(z.object({ id: z.string() }))
					.handle((_, response) => {
						response
							.status(201)
							.header('Location', '/test/123')
							.cookie('session', 'abc123', { httpOnly: true })
							.cookie('theme', 'dark');
						return { id: '123' };
					});

				const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);
				const event = createMockV2Event({ routeKey: 'POST /test' });
				// @ts-ignore
				const response = await adapter.handler(event, mockContext);

				expect(response.statusCode).toBe(201);
				expect(response.headers).toEqual({ Location: '/test/123' });
				expect(response.multiValueHeaders?.['Set-Cookie']).toEqual([
					'session=abc123; HttpOnly',
					'theme=dark',
				]);
			});

			it('should delete cookies', async () => {
				const endpoint = e
					.get('/test')
					.output(z.object({ success: z.boolean() }))
					.handle((_, response) => {
						response.deleteCookie('session', {
							path: '/',
							domain: '.example.com',
						});
						return { success: true };
					});

				const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);
				const event = createMockV2Event();
				// @ts-ignore
				const response = await adapter.handler(event, mockContext);

				expect(response.multiValueHeaders?.['Set-Cookie']).toEqual([
					'session=; Domain=.example.com; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0',
				]);
			});

			it('should use send() method with metadata', async () => {
				const endpoint = e
					.get('/test')
					.output(z.object({ id: z.string() }))
					.handle((_, response) => {
						return response
							.status(201)
							.header('X-Custom', 'value')
							.cookie('session', 'abc123')
							.send({ id: '123' });
					});

				const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);
				const event = createMockV2Event();
				// @ts-ignore
				const response = await adapter.handler(event, mockContext);

				expect(response.statusCode).toBe(201);
				expect(response.headers).toEqual({ 'X-Custom': 'value' });
				expect(response.multiValueHeaders?.['Set-Cookie']).toEqual([
					'session=abc123',
				]);
				expect(response.body).toBe(JSON.stringify({ id: '123' }));
			});

			it('should return simple response without metadata when not using response builder', async () => {
				const endpoint = e
					.get('/test')
					.output(z.object({ success: z.boolean() }))
					.handle(() => ({ success: true }));

				const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);
				const event = createMockV2Event();
				// @ts-ignore
				const response = await adapter.handler(event, mockContext);

				expect(response).toEqual({
					statusCode: 200,
					body: JSON.stringify({ success: true }),
				});
				expect(response.headers).toBeUndefined();
				expect(response.multiValueHeaders).toBeUndefined();
			});
		});
	});
});
