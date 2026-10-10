import { EnvironmentParser } from '@geekmidas/envkit';
import { createMockContext, createMockV2Event } from '@geekmidas/testkit/aws';
import type { Context } from 'aws-lambda';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RestApi } from '../../rest-api';
import { AmazonApiGatewayEndpoint } from '../AmazonApiGatewayEndpointAdaptor';
import { AmazonApiGatewayV2Endpoint } from '../AmazonApiGatewayV2EndpointAdaptor';
import {
	MalformedRequestBody,
	UnsupportedRequestContentType,
} from '../readRequestBody';

/** Endpoints are built from a surface now, so the tests build one. */
const api = new RestApi('Test', { path: '.', defaultAuthorizer: 'none' });

describe('AmazonApiGatewayV2Endpoint', () => {
	let envParser: EnvironmentParser<{}>;
	let mockContext: Context;

	beforeEach(() => {
		envParser = new EnvironmentParser({});
		mockContext = createMockContext();
	});

	describe('getInput', () => {
		it('should parse request body, query, and params', async () => {
			const endpoint = api
				.post('/test')
				.body(z.any())
				.handle(() => ({ success: true }));
			const adapter = new AmazonApiGatewayV2Endpoint(endpoint);

			const event = createMockV2Event({
				rawQueryString: 'foo=bar&baz=qux',
				queryStringParameters: { foo: 'bar', baz: 'qux' },
				pathParameters: { id: '123' },
				body: JSON.stringify({ name: 'test' }),
			});

			const result = await adapter.getInput(event);

			expect(result).toEqual({
				body: { name: 'test' },
				query: { foo: 'bar', baz: 'qux' },
				params: { id: '123' },
			});
		});

		it('should parse JSON body when content-type is application/json', async () => {
			const endpoint = api
				.post('/test')
				.body(z.any())
				.handle(() => ({ success: true }));
			const adapter = new AmazonApiGatewayV2Endpoint(endpoint);

			const event = createMockV2Event({
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'test' }),
			});

			const result = await adapter.getInput(event);

			expect(result.body).toEqual({ name: 'test' });
		});

		it('should decode base64-encoded JSON body', async () => {
			const endpoint = api
				.post('/test')
				.body(z.any())
				.handle(() => ({ success: true }));
			const adapter = new AmazonApiGatewayV2Endpoint(endpoint);

			const event = createMockV2Event({
				headers: { 'content-type': 'application/json' },
				body: Buffer.from(JSON.stringify({ name: 'test' })).toString('base64'),
				isBase64Encoded: true,
			});

			const result = await adapter.getInput(event);

			expect(result.body).toEqual({ name: 'test' });
		});

		it('should decode a base64 form-urlencoded body into its fields', async () => {
			const endpoint = api
				.post('/test')
				.body(z.any())
				.handle(() => ({ success: true }));
			const adapter = new AmazonApiGatewayV2Endpoint(endpoint);

			const event = createMockV2Event({
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: Buffer.from('amount=100&currency=ZAR').toString('base64'),
				isBase64Encoded: true,
			});

			const result = await adapter.getInput(event);

			expect(result.body).toEqual({ amount: '100', currency: 'ZAR' });
		});

		it('should return raw string when content-type is text', async () => {
			const endpoint = api
				.post('/test')
				.body(z.any())
				.handle(() => ({ success: true }));
			const adapter = new AmazonApiGatewayV2Endpoint(endpoint);

			const event = createMockV2Event({
				headers: { 'content-type': 'text/plain' },
				body: 'plain-text-body',
			});

			const result = await adapter.getInput(event);

			expect(result.body).toBe('plain-text-body');
		});

		it('should default to JSON parsing when no content-type header', async () => {
			const endpoint = api
				.post('/test')
				.body(z.any())
				.handle(() => ({ success: true }));
			const adapter = new AmazonApiGatewayV2Endpoint(endpoint);

			const event = createMockV2Event({
				headers: {},
				body: JSON.stringify({ name: 'test' }),
			});

			const result = await adapter.getInput(event);

			expect(result.body).toEqual({ name: 'test' });
		});

		it('should handle missing body, query, and params', async () => {
			const endpoint = api
				.post('/test')
				.body(z.any())
				.handle(() => ({ success: true }));
			const adapter = new AmazonApiGatewayV2Endpoint(endpoint);

			const event = createMockV2Event();

			const result = await adapter.getInput(event);

			expect(result).toEqual({
				body: undefined,
				query: {},
				params: {},
			});
		});

		it('should not read the body of an endpoint without a body schema', async () => {
			const endpoint = api.post('/test').handle(() => ({ success: true }));
			const adapter = new AmazonApiGatewayV2Endpoint(endpoint);

			const event = createMockV2Event({
				headers: { 'content-type': 'application/xml' },
				body: '<ignored/>',
			});

			const result = await adapter.getInput(event);

			expect(result.body).toBeUndefined();
		});
	});

	describe('getLoggerContext', () => {
		it('should extract logger context from event and context', () => {
			const endpoint = api.get('/test').handle(() => ({ success: true }));
			const adapter = new AmazonApiGatewayV2Endpoint(endpoint);

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
			const endpoint = api.get('/test').handle(() => ({ success: true }));
			const adapter = new AmazonApiGatewayV2Endpoint(endpoint);

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
			const endpoint = api
				.post('/users')
				.body(z.object({ name: z.string(), age: z.number() }))
				.output(z.object({ id: z.string(), name: z.string() }))
				.handle(async ({ body }) => ({
					id: '123',
					name: body.name,
				}));

			const adapter = new AmazonApiGatewayV2Endpoint(endpoint);

			const event = createMockV2Event({
				routeKey: 'POST /users',
				rawPath: '/users',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'John', age: 30 }),
			});

			const response = await adapter.handler(event, mockContext);

			expect(response).toEqual({
				statusCode: 200,
				body: JSON.stringify({ id: '123', name: 'John' }),
			});
		});

		it('should handle array query parameters with bracket notation', async () => {
			const endpoint = api
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

			const adapter = new AmazonApiGatewayV2Endpoint(endpoint);

			const event = createMockV2Event({
				routeKey: 'GET /search',
				rawPath: '/search',
				rawQueryString:
					'tags%5B%5D=nodejs&tags%5B%5D=typescript&tags%5B%5D=javascript&limit=20',
				queryStringParameters: {
					'tags[]': 'nodejs,typescript,javascript',
					limit: '20',
				},
			});

			const response = await adapter.handler(event, mockContext);

			expect(response).toEqual({
				statusCode: 200,
				body: JSON.stringify({
					tags: ['nodejs', 'typescript', 'javascript'],
					limit: 20,
				}),
			});
		});

		it('should handle object query parameters with bracket notation', async () => {
			const endpoint = api
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

			const adapter = new AmazonApiGatewayV2Endpoint(endpoint);

			const event = createMockV2Event({
				routeKey: 'GET /search',
				rawPath: '/search',
				rawQueryString:
					'filter%5Bcategory%5D=electronics&filter%5Bactive%5D=true',
				queryStringParameters: {
					'filter[category]': 'electronics',
					'filter[active]': 'true',
				},
			});

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
			const endpoint = api
				.get('/users/:id')
				.params(z.object({ id: z.string() }))
				.query(z.object({ include: z.string().optional() }))
				.output(z.object({ id: z.string(), include: z.string().optional() }))
				.handle(async ({ params, query }) => ({
					id: params.id,
					include: query.include,
				}));

			const adapter = new AmazonApiGatewayV2Endpoint(endpoint);

			const event = createMockV2Event({
				routeKey: 'GET /users/{id}',
				rawPath: '/users/123',
				rawQueryString: 'include=profile',
				queryStringParameters: { include: 'profile' },
				pathParameters: { id: '123' },
			});

			const response = await adapter.handler(event, mockContext);

			expect(response).toEqual({
				statusCode: 200,
				body: JSON.stringify({ id: '123', include: 'profile' }),
			});
		});

		describe('response metadata', () => {
			it('should set response cookies', async () => {
				const endpoint = api
					.get('/test')
					.output(z.object({ success: z.boolean() }))
					.handle((_, response) => {
						response.cookie('session', 'abc123', {
							httpOnly: true,
							secure: true,
						});
						return { success: true };
					});

				const adapter = new AmazonApiGatewayV2Endpoint(endpoint);
				const event = createMockV2Event();

				const response = await adapter.handler(event, mockContext);

				expect(response.multiValueHeaders?.['Set-Cookie']).toEqual([
					'session=abc123; HttpOnly; Secure',
				]);
				expect(response.statusCode).toBe(200);
				expect(response.body).toBe(JSON.stringify({ success: true }));
			});

			it('should set custom headers', async () => {
				const endpoint = api
					.get('/test')
					.output(z.object({ success: z.boolean() }))
					.handle((_, response) => {
						response.header('X-Custom-Header', 'custom-value');
						response.header('X-Request-Id', '12345');
						return { success: true };
					});

				const adapter = new AmazonApiGatewayV2Endpoint(endpoint);
				const event = createMockV2Event();

				const response = await adapter.handler(event, mockContext);

				expect(response.headers).toEqual({
					'X-Custom-Header': 'custom-value',
					'X-Request-Id': '12345',
				});
			});

			it('should set custom status code', async () => {
				const endpoint = api
					.post('/test')
					.output(z.object({ id: z.string() }))
					.handle((_, response) => {
						response.status(201);
						return { id: '123' };
					});

				const adapter = new AmazonApiGatewayV2Endpoint(endpoint);
				const event = createMockV2Event({ routeKey: 'POST /test' });

				const response = await adapter.handler(event, mockContext);

				expect(response.statusCode).toBe(201);
			});

			it('should combine cookies, headers, and status', async () => {
				const endpoint = api
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

				const adapter = new AmazonApiGatewayV2Endpoint(endpoint);
				const event = createMockV2Event({ routeKey: 'POST /test' });

				const response = await adapter.handler(event, mockContext);

				expect(response.statusCode).toBe(201);
				expect(response.headers).toEqual({ Location: '/test/123' });
				expect(response.multiValueHeaders?.['Set-Cookie']).toEqual([
					'session=abc123; HttpOnly',
					'theme=dark',
				]);
			});

			it('should delete cookies', async () => {
				const endpoint = api
					.get('/test')
					.output(z.object({ success: z.boolean() }))
					.handle((_, response) => {
						response.deleteCookie('session', {
							path: '/',
							domain: '.example.com',
						});
						return { success: true };
					});

				const adapter = new AmazonApiGatewayV2Endpoint(endpoint);
				const event = createMockV2Event();

				const response = await adapter.handler(event, mockContext);

				expect(response.multiValueHeaders?.['Set-Cookie']).toEqual([
					'session=; Domain=.example.com; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0',
				]);
			});

			it('should use send() method with metadata', async () => {
				const endpoint = api
					.get('/test')
					.output(z.object({ id: z.string() }))
					.handle((_, response) => {
						return response
							.status(201)
							.header('X-Custom', 'value')
							.cookie('session', 'abc123')
							.send({ id: '123' });
					});

				const adapter = new AmazonApiGatewayV2Endpoint(endpoint);
				const event = createMockV2Event();

				const response = await adapter.handler(event, mockContext);

				expect(response.statusCode).toBe(201);
				expect(response.headers).toEqual({ 'X-Custom': 'value' });
				expect(response.multiValueHeaders?.['Set-Cookie']).toEqual([
					'session=abc123',
				]);
				expect(response.body).toBe(JSON.stringify({ id: '123' }));
			});

			it('should return simple response without metadata when not using response builder', async () => {
				const endpoint = api
					.get('/test')
					.output(z.object({ success: z.boolean() }))
					.handle(() => ({ success: true }));

				const adapter = new AmazonApiGatewayV2Endpoint(endpoint);
				const event = createMockV2Event();

				const response = await adapter.handler(event, mockContext);

				expect(response).toEqual({
					statusCode: 200,
					body: JSON.stringify({ success: true }),
				});
				expect(response.headers).toBeUndefined();
				expect(response.multiValueHeaders).toBeUndefined();
			});
		});

		describe('request cookies', () => {
			it('should load cookies from V2 cookies array', async () => {
				const endpoint = api
					.get('/test')
					.output(z.object({ session: z.string(), theme: z.string() }))
					.handle(async ({ cookie }) => ({
						session: cookie('session') ?? '',
						theme: cookie('theme') ?? '',
					}));

				const adapter = new AmazonApiGatewayV2Endpoint(endpoint);
				const event = createMockV2Event({
					cookies: ['session=abc123', 'theme=dark'],
				});

				const response = await adapter.handler(event, mockContext);

				expect(JSON.parse(response.body!)).toEqual({
					session: 'abc123',
					theme: 'dark',
				});
			});

			it('should fall back to headers.cookie when cookies array is absent', async () => {
				const endpoint = api
					.get('/test')
					.output(z.object({ session: z.string() }))
					.handle(async ({ cookie }) => ({
						session: cookie('session') ?? '',
					}));

				const adapter = new AmazonApiGatewayV2Endpoint(endpoint);
				const event = createMockV2Event({
					cookies: undefined,
					headers: {
						'content-type': 'application/json',
						cookie: 'session=from-header',
					},
				});

				const response = await adapter.handler(event, mockContext);

				expect(JSON.parse(response.body!)).toEqual({
					session: 'from-header',
				});
			});

			it('should prefer V2 cookies array over headers.cookie', async () => {
				const endpoint = api
					.get('/test')
					.output(z.object({ session: z.string() }))
					.handle(async ({ cookie }) => ({
						session: cookie('session') ?? '',
					}));

				const adapter = new AmazonApiGatewayV2Endpoint(endpoint);
				const event = createMockV2Event({
					cookies: ['session=from-array'],
					headers: {
						'content-type': 'application/json',
						cookie: 'session=from-header',
					},
				});

				const response = await adapter.handler(event, mockContext);

				expect(JSON.parse(response.body!)).toEqual({
					session: 'from-array',
				});
			});
		});
	});
});

describe('AmazonApiGatewayEndpoint.decodeBody', () => {
	const decodeBody = AmazonApiGatewayEndpoint.decodeBody;

	it('should return undefined for null/undefined body', async () => {
		expect(
			await decodeBody(undefined, false, 'application/json'),
		).toBeUndefined();
		expect(await decodeBody(null, false, 'application/json')).toBeUndefined();
		expect(await decodeBody('', false, 'application/json')).toBeUndefined();
	});

	it('should JSON.parse when content-type is application/json', async () => {
		const result = await decodeBody(
			'{"name":"test"}',
			false,
			'application/json',
		);
		expect(result).toEqual({ name: 'test' });
	});

	it('should JSON.parse when content-type includes application/json with charset', async () => {
		const result = await decodeBody(
			'{"name":"test"}',
			false,
			'application/json; charset=utf-8',
		);
		expect(result).toEqual({ name: 'test' });
	});

	it('should JSON.parse a +json media type', async () => {
		const result = await decodeBody(
			'{"op":"replace"}',
			false,
			'application/merge-patch+json',
		);
		expect(result).toEqual({ op: 'replace' });
	});

	it('should decode base64 then JSON.parse for base64-encoded JSON', async () => {
		const encoded = Buffer.from('{"name":"test"}').toString('base64');
		const result = await decodeBody(encoded, true, 'application/json');
		expect(result).toEqual({ name: 'test' });
	});

	it('should read a form-urlencoded body into its fields', async () => {
		const result = await decodeBody(
			'amount=100&currency=ZAR',
			false,
			'application/x-www-form-urlencoded',
		);
		expect(result).toEqual({ amount: '100', currency: 'ZAR' });
	});

	it('should decode a base64 form-urlencoded body into its fields', async () => {
		const encoded = Buffer.from('amount=100&currency=ZAR').toString('base64');
		const result = await decodeBody(
			encoded,
			true,
			'application/x-www-form-urlencoded',
		);
		expect(result).toEqual({ amount: '100', currency: 'ZAR' });
	});

	it('should read a repeated form field as an array', async () => {
		const result = await decodeBody(
			'tag=a&tag=b&tag=c&name=x',
			false,
			'application/x-www-form-urlencoded',
		);
		expect(result).toEqual({ tag: ['a', 'b', 'c'], name: 'x' });
	});

	it('should decode a base64 multipart body, with a file part as a File', async () => {
		const form = new FormData();
		form.append('name', 'avatar');
		form.append('file', new File([new Uint8Array([0, 255, 1])], 'a.bin'));
		const request = new Request('http://localhost/', {
			method: 'POST',
			body: form,
		});
		const contentType = request.headers.get('content-type') ?? undefined;
		const encoded = Buffer.from(await request.arrayBuffer()).toString('base64');

		const result = (await decodeBody(encoded, true, contentType)) as Record<
			string,
			unknown
		>;

		expect(result.name).toBe('avatar');
		expect(result.file).toBeInstanceOf(File);
		const file = result.file as File;
		expect(file.name).toBe('a.bin');
		expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([0, 255, 1]);
	});

	it('should return raw string for text/plain', async () => {
		const result = await decodeBody('hello world', false, 'text/plain');
		expect(result).toBe('hello world');
	});

	it('should default to JSON parsing when content-type is undefined', async () => {
		const result = await decodeBody('{"name":"test"}', false, undefined);
		expect(result).toEqual({ name: 'test' });
	});

	it('should not JSON.parse a string that happens to be valid JSON when content-type is not JSON', async () => {
		const result = await decodeBody(
			'{"looks":"like json"}',
			false,
			'text/plain',
		);
		expect(result).toBe('{"looks":"like json"}');
	});

	it('should refuse a content type it cannot read', async () => {
		await expect(
			decodeBody('<a/>', false, 'application/xml'),
		).rejects.toBeInstanceOf(UnsupportedRequestContentType);
	});

	it('should refuse malformed JSON', async () => {
		await expect(
			decodeBody('{nope', false, 'application/json'),
		).rejects.toBeInstanceOf(MalformedRequestBody);
	});
});
