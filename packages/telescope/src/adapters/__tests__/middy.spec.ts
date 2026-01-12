import type {
	APIGatewayProxyEvent,
	APIGatewayProxyEventV2,
	Context,
} from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryStorage } from '../../storage/memory';
import { Telescope } from '../../Telescope';
import { createTelescopeHandler, telescopeMiddleware } from '../middy';

describe('Telescope Middy Middleware', () => {
	let telescope: Telescope;
	let storage: InMemoryStorage;
	let mockContext: Context;

	beforeEach(() => {
		storage = new InMemoryStorage();
		telescope = new Telescope({ storage });

		mockContext = {
			callbackWaitsForEmptyEventLoop: true,
			functionName: 'test-function',
			functionVersion: '1',
			invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789:function:test',
			memoryLimitInMB: '128',
			awsRequestId: 'test-request-id',
			logGroupName: '/aws/lambda/test',
			logStreamName: '2024/01/01/[$LATEST]abc123',
			getRemainingTimeInMillis: () => 10000,
			done: vi.fn(),
			fail: vi.fn(),
			succeed: vi.fn(),
		};
	});

	afterEach(() => {
		telescope.destroy();
	});

	describe('telescopeMiddleware', () => {
		describe('before hook', () => {
			it('should set callbackWaitsForEmptyEventLoop to false', async () => {
				const middleware = telescopeMiddleware(telescope);
				const request = {
					event: createV2Event(),
					context: mockContext,
					response: null,
					error: null,
					internal: {},
				};

				await middleware.before?.(request as any);

				expect(request.context.callbackWaitsForEmptyEventLoop).toBe(false);
			});

			it('should store start time on request', async () => {
				const middleware = telescopeMiddleware(telescope);
				const request = {
					event: createV2Event(),
					context: mockContext,
					response: null,
					error: null,
					internal: {},
				};

				await middleware.before?.(request as any);

				expect((request as any).__telescopeStartTime).toBeDefined();
				expect(typeof (request as any).__telescopeStartTime).toBe('number');
			});
		});

		describe('after hook', () => {
			it('should record request to Telescope for v2 events', async () => {
				const middleware = telescopeMiddleware(telescope);
				const event = createV2Event({
					method: 'POST',
					path: '/api/users',
					body: JSON.stringify({ name: 'John' }),
				});
				const request = {
					event,
					context: mockContext,
					response: { statusCode: 201, body: JSON.stringify({ id: '123' }) },
					error: null,
					internal: {},
					__telescopeStartTime: Date.now() - 100,
				};

				await middleware.after?.(request as any);

				const requests = await storage.getRequests();
				expect(requests).toHaveLength(1);
				expect(requests[0].method).toBe('POST');
				expect(requests[0].path).toBe('/api/users');
				expect(requests[0].status).toBe(201);
				expect(requests[0].duration).toBeGreaterThanOrEqual(100);
			});

			it('should record request to Telescope for v1 events', async () => {
				const middleware = telescopeMiddleware(telescope);
				const event = createV1Event({
					method: 'GET',
					path: '/api/items',
					query: { page: '1' },
				});
				const request = {
					event,
					context: mockContext,
					response: { statusCode: 200, body: JSON.stringify({ items: [] }) },
					error: null,
					internal: {},
					__telescopeStartTime: Date.now() - 50,
				};

				await middleware.after?.(request as any);

				const requests = await storage.getRequests();
				expect(requests).toHaveLength(1);
				expect(requests[0].method).toBe('GET');
				expect(requests[0].path).toBe('/api/items');
				expect(requests[0].status).toBe(200);
			});

			it('should respect recordBody option when false', async () => {
				const middleware = telescopeMiddleware(telescope, {
					recordBody: false,
				});
				const event = createV2Event({
					method: 'POST',
					path: '/api/users',
					body: JSON.stringify({ secret: 'password123' }),
				});
				const request = {
					event,
					context: mockContext,
					response: {
						statusCode: 200,
						body: JSON.stringify({ token: 'secret-token' }),
					},
					error: null,
					internal: {},
					__telescopeStartTime: Date.now(),
				};

				await middleware.after?.(request as any);

				const requests = await storage.getRequests();
				expect(requests).toHaveLength(1);
				expect(requests[0].body).toBeUndefined();
				expect(requests[0].responseBody).toBeUndefined();
			});

			it('should include body when recordBody is true (default)', async () => {
				const middleware = telescopeMiddleware(telescope);
				const event = createV2Event({
					method: 'POST',
					path: '/api/users',
					body: JSON.stringify({ name: 'Test' }),
				});
				const request = {
					event,
					context: mockContext,
					response: { statusCode: 200, body: JSON.stringify({ id: '1' }) },
					error: null,
					internal: {},
					__telescopeStartTime: Date.now(),
				};

				await middleware.after?.(request as any);

				const requests = await storage.getRequests();
				expect(requests[0].body).toEqual({ name: 'Test' });
				expect(requests[0].responseBody).toEqual({ id: '1' });
			});

			it('should extract IP from v2 event', async () => {
				const middleware = telescopeMiddleware(telescope);
				const event = createV2Event({ ip: '192.168.1.1' });
				const request = {
					event,
					context: mockContext,
					response: { statusCode: 200 },
					error: null,
					internal: {},
					__telescopeStartTime: Date.now(),
				};

				await middleware.after?.(request as any);

				const requests = await storage.getRequests();
				expect(requests[0].ip).toBe('192.168.1.1');
			});

			it('should extract IP from v1 event', async () => {
				const middleware = telescopeMiddleware(telescope);
				const event = createV1Event({ ip: '10.0.0.1' });
				const request = {
					event,
					context: mockContext,
					response: { statusCode: 200 },
					error: null,
					internal: {},
					__telescopeStartTime: Date.now(),
				};

				await middleware.after?.(request as any);

				const requests = await storage.getRequests();
				expect(requests[0].ip).toBe('10.0.0.1');
			});
		});

		describe('onError hook', () => {
			it('should record exception to Telescope', async () => {
				const middleware = telescopeMiddleware(telescope);
				const error = new Error('Something went wrong');
				const request = {
					event: createV2Event({ path: '/api/error' }),
					context: mockContext,
					response: null,
					error,
					internal: {},
					__telescopeStartTime: Date.now(),
				};

				await middleware.onError?.(request as any);

				const exceptions = await storage.getExceptions();
				expect(exceptions).toHaveLength(1);
				expect(exceptions[0].message).toBe('Something went wrong');
			});

			it('should record failed request with 500 status', async () => {
				const middleware = telescopeMiddleware(telescope);
				const error = new Error('Database connection failed');
				const request = {
					event: createV2Event({ method: 'POST', path: '/api/data' }),
					context: mockContext,
					response: null,
					error,
					internal: {},
					__telescopeStartTime: Date.now() - 200,
				};

				await middleware.onError?.(request as any);

				const requests = await storage.getRequests();
				expect(requests).toHaveLength(1);
				expect(requests[0].status).toBe(500);
				expect(requests[0].path).toBe('/api/data');
				expect(requests[0].responseBody).toEqual({
					error: 'Database connection failed',
				});
			});
		});
	});

	describe('createTelescopeHandler', () => {
		it('should wrap handler and record successful request', async () => {
			const baseHandler = async () => ({
				statusCode: 200,
				body: JSON.stringify({ success: true }),
			});

			const handler = createTelescopeHandler(telescope, baseHandler);
			const event = createV2Event({ method: 'GET', path: '/api/health' });

			const result = await handler(event, mockContext);

			expect(result).toEqual({
				statusCode: 200,
				body: JSON.stringify({ success: true }),
			});

			const requests = await storage.getRequests();
			expect(requests).toHaveLength(1);
			expect(requests[0].method).toBe('GET');
			expect(requests[0].path).toBe('/api/health');
			expect(requests[0].status).toBe(200);
		});

		it('should set callbackWaitsForEmptyEventLoop to false', async () => {
			const baseHandler = async () => ({ statusCode: 200 });
			const handler = createTelescopeHandler(telescope, baseHandler);
			const event = createV2Event();

			await handler(event, mockContext);

			expect(mockContext.callbackWaitsForEmptyEventLoop).toBe(false);
		});

		it('should record exception on error and rethrow', async () => {
			const error = new Error('Handler failed');
			const baseHandler = async () => {
				throw error;
			};
			const handler = createTelescopeHandler(telescope, baseHandler);
			const event = createV2Event({ path: '/api/failing' });

			await expect(handler(event, mockContext)).rejects.toThrow(
				'Handler failed',
			);

			const exceptions = await storage.getExceptions();
			expect(exceptions).toHaveLength(1);
			expect(exceptions[0].message).toBe('Handler failed');
		});

		it('should respect recordBody option', async () => {
			const baseHandler = async () => ({
				statusCode: 200,
				body: JSON.stringify({ token: 'secret' }),
			});

			const handler = createTelescopeHandler(telescope, baseHandler, {
				recordBody: false,
			});
			const event = createV2Event({
				method: 'POST',
				body: JSON.stringify({ password: 'secret' }),
			});

			await handler(event, mockContext);

			const requests = await storage.getRequests();
			expect(requests[0].body).toBeUndefined();
			expect(requests[0].responseBody).toBeUndefined();
		});

		it('should calculate duration correctly', async () => {
			const baseHandler = async () => {
				await new Promise((resolve) => setTimeout(resolve, 50));
				return { statusCode: 200 };
			};

			const handler = createTelescopeHandler(telescope, baseHandler);
			const event = createV2Event();

			await handler(event, mockContext);

			const requests = await storage.getRequests();
			expect(requests[0].duration).toBeGreaterThanOrEqual(50);
		});
	});

	describe('request data extraction', () => {
		it('should handle base64 encoded body', async () => {
			const middleware = telescopeMiddleware(telescope);
			const bodyContent = { data: 'test' };
			const base64Body = Buffer.from(JSON.stringify(bodyContent)).toString(
				'base64',
			);

			const event: APIGatewayProxyEventV2 = {
				...createV2Event(),
				body: base64Body,
				isBase64Encoded: true,
			};

			const request = {
				event,
				context: mockContext,
				response: { statusCode: 200 },
				error: null,
				internal: {},
				__telescopeStartTime: Date.now(),
			};

			await middleware.after?.(request as any);

			const requests = await storage.getRequests();
			expect(requests[0].body).toEqual({ data: 'test' });
		});

		it('should handle non-JSON body gracefully', async () => {
			const middleware = telescopeMiddleware(telescope);
			const event = createV2Event({ body: 'plain text body' });
			const request = {
				event,
				context: mockContext,
				response: { statusCode: 200 },
				error: null,
				internal: {},
				__telescopeStartTime: Date.now(),
			};

			await middleware.after?.(request as any);

			const requests = await storage.getRequests();
			expect(requests[0].body).toBe('plain text body');
		});

		it('should handle null body', async () => {
			const middleware = telescopeMiddleware(telescope);
			const event = createV2Event({ body: null });
			const request = {
				event,
				context: mockContext,
				response: { statusCode: 200 },
				error: null,
				internal: {},
				__telescopeStartTime: Date.now(),
			};

			await middleware.after?.(request as any);

			const requests = await storage.getRequests();
			expect(requests[0].body).toBeUndefined();
		});

		it('should construct URL with query string for v2 events', async () => {
			const middleware = telescopeMiddleware(telescope);
			const event = createV2Event({
				path: '/api/search',
				queryString: 'q=test&page=1',
			});
			const request = {
				event,
				context: mockContext,
				response: { statusCode: 200 },
				error: null,
				internal: {},
				__telescopeStartTime: Date.now(),
			};

			await middleware.after?.(request as any);

			const requests = await storage.getRequests();
			expect(requests[0].url).toBe('/api/search?q=test&page=1');
		});

		it('should normalize headers to lowercase', async () => {
			const middleware = telescopeMiddleware(telescope);
			const event = createV2Event();
			event.headers = {
				'Content-Type': 'application/json',
				'X-Custom-Header': 'value',
				Authorization: 'Bearer token',
			};
			const request = {
				event,
				context: mockContext,
				response: { statusCode: 200 },
				error: null,
				internal: {},
				__telescopeStartTime: Date.now(),
			};

			await middleware.after?.(request as any);

			const requests = await storage.getRequests();
			expect(requests[0].headers).toEqual({
				'content-type': 'application/json',
				'x-custom-header': 'value',
				authorization: 'Bearer token',
			});
		});
	});

	describe('response data extraction', () => {
		it('should handle response without statusCode', async () => {
			const middleware = telescopeMiddleware(telescope);
			const request = {
				event: createV2Event(),
				context: mockContext,
				response: { data: 'raw response' }, // No statusCode
				error: null,
				internal: {},
				__telescopeStartTime: Date.now(),
			};

			await middleware.after?.(request as any);

			const requests = await storage.getRequests();
			expect(requests[0].status).toBe(200); // Default status
		});

		it('should parse JSON response body', async () => {
			const middleware = telescopeMiddleware(telescope);
			const request = {
				event: createV2Event(),
				context: mockContext,
				response: {
					statusCode: 200,
					body: JSON.stringify({ items: [1, 2, 3] }),
				},
				error: null,
				internal: {},
				__telescopeStartTime: Date.now(),
			};

			await middleware.after?.(request as any);

			const requests = await storage.getRequests();
			expect(requests[0].responseBody).toEqual({ items: [1, 2, 3] });
		});

		it('should handle non-JSON response body', async () => {
			const middleware = telescopeMiddleware(telescope);
			const request = {
				event: createV2Event(),
				context: mockContext,
				response: {
					statusCode: 200,
					body: '<html>Hello</html>',
				},
				error: null,
				internal: {},
				__telescopeStartTime: Date.now(),
			};

			await middleware.after?.(request as any);

			const requests = await storage.getRequests();
			expect(requests[0].responseBody).toBe('<html>Hello</html>');
		});
	});

	describe('size tracking', () => {
		it('should capture request size from Content-Length header', async () => {
			const middleware = telescopeMiddleware(telescope);
			const body = JSON.stringify({ name: 'John', data: 'test payload' });
			const event = createV2Event({
				method: 'POST',
				path: '/api/data',
				body,
				headers: { 'content-length': String(Buffer.byteLength(body)) },
			});
			const request = {
				event,
				context: mockContext,
				response: { statusCode: 200, body: '{"ok":true}' },
				error: null,
				internal: {},
				__telescopeStartTime: Date.now(),
			};

			await middleware.after?.(request as any);

			const requests = await storage.getRequests();
			expect(requests[0].requestSize).toBe(Buffer.byteLength(body));
		});

		it('should capture response size from Content-Length header', async () => {
			const middleware = telescopeMiddleware(telescope);
			const responseBody = JSON.stringify({ users: ['alice', 'bob'] });
			const event = createV2Event({ method: 'GET', path: '/api/users' });
			const request = {
				event,
				context: mockContext,
				response: {
					statusCode: 200,
					headers: {
						'Content-Length': String(Buffer.byteLength(responseBody)),
					},
					body: responseBody,
				},
				error: null,
				internal: {},
				__telescopeStartTime: Date.now(),
			};

			await middleware.after?.(request as any);

			const requests = await storage.getRequests();
			expect(requests[0].responseSize).toBe(Buffer.byteLength(responseBody));
		});

		it('should calculate response size from body when Content-Length not set', async () => {
			const middleware = telescopeMiddleware(telescope);
			const responseBody = JSON.stringify({ items: [1, 2, 3, 4, 5] });
			const event = createV2Event({ method: 'GET', path: '/api/items' });
			const request = {
				event,
				context: mockContext,
				response: {
					statusCode: 200,
					body: responseBody,
				},
				error: null,
				internal: {},
				__telescopeStartTime: Date.now(),
			};

			await middleware.after?.(request as any);

			const requests = await storage.getRequests();
			expect(requests[0].responseSize).toBe(Buffer.byteLength(responseBody));
		});

		it('should handle multi-byte characters in response size', async () => {
			const middleware = telescopeMiddleware(telescope);
			const responseBody = JSON.stringify({ message: '你好世界' });
			const event = createV2Event({ method: 'GET', path: '/api/unicode' });
			const request = {
				event,
				context: mockContext,
				response: {
					statusCode: 200,
					body: responseBody,
				},
				error: null,
				internal: {},
				__telescopeStartTime: Date.now(),
			};

			await middleware.after?.(request as any);

			const requests = await storage.getRequests();
			// UTF-8 bytes for Chinese characters are more than string length
			expect(requests[0].responseSize).toBe(
				Buffer.byteLength(responseBody, 'utf8'),
			);
		});

		it('should track request size for v1 events', async () => {
			const middleware = telescopeMiddleware(telescope);
			const body = JSON.stringify({ data: 'v1 payload' });
			const event = createV1Event({
				method: 'POST',
				path: '/api/v1/data',
				body,
				headers: { 'content-length': String(Buffer.byteLength(body)) },
			});
			const request = {
				event,
				context: mockContext,
				response: { statusCode: 201, body: '{"id":"123"}' },
				error: null,
				internal: {},
				__telescopeStartTime: Date.now(),
			};

			await middleware.after?.(request as any);

			const requests = await storage.getRequests();
			expect(requests[0].requestSize).toBe(Buffer.byteLength(body));
		});
	});
});

// Helper functions to create mock events

function createV2Event(
	options: {
		method?: string;
		path?: string;
		body?: string | null;
		query?: Record<string, string>;
		queryString?: string;
		ip?: string;
		headers?: Record<string, string>;
	} = {},
): APIGatewayProxyEventV2 {
	return {
		version: '2.0',
		routeKey: `${options.method || 'GET'} ${options.path || '/'}`,
		rawPath: options.path || '/',
		rawQueryString: options.queryString || '',
		headers: options.headers || {},
		queryStringParameters: options.query || {},
		body: options.body ?? null,
		isBase64Encoded: false,
		requestContext: {
			accountId: '123456789',
			apiId: 'api123',
			domainName: 'api.example.com',
			domainPrefix: 'api',
			http: {
				method: options.method || 'GET',
				path: options.path || '/',
				protocol: 'HTTP/1.1',
				sourceIp: options.ip || '127.0.0.1',
				userAgent: 'test-agent',
			},
			requestId: 'test-request-id',
			routeKey: `${options.method || 'GET'} ${options.path || '/'}`,
			stage: '$default',
			time: '01/Jan/2024:00:00:00 +0000',
			timeEpoch: Date.now(),
		},
	};
}

function createV1Event(
	options: {
		method?: string;
		path?: string;
		body?: string | null;
		query?: Record<string, string>;
		ip?: string;
		headers?: Record<string, string>;
	} = {},
): APIGatewayProxyEvent {
	return {
		httpMethod: options.method || 'GET',
		path: options.path || '/',
		headers: options.headers || {},
		multiValueHeaders: {},
		queryStringParameters: options.query || null,
		multiValueQueryStringParameters: null,
		pathParameters: null,
		stageVariables: null,
		body: options.body ?? null,
		isBase64Encoded: false,
		resource: options.path || '/',
		requestContext: {
			accountId: '123456789',
			apiId: 'api123',
			authorizer: null,
			httpMethod: options.method || 'GET',
			identity: {
				accessKey: null,
				accountId: null,
				apiKey: null,
				apiKeyId: null,
				caller: null,
				clientCert: null,
				cognitoAuthenticationProvider: null,
				cognitoAuthenticationType: null,
				cognitoIdentityId: null,
				cognitoIdentityPoolId: null,
				principalOrgId: null,
				sourceIp: options.ip || '127.0.0.1',
				user: null,
				userAgent: 'test-agent',
				userArn: null,
			},
			path: options.path || '/',
			protocol: 'HTTP/1.1',
			requestId: 'test-request-id',
			requestTimeEpoch: Date.now(),
			resourceId: 'resource123',
			resourcePath: options.path || '/',
			stage: 'test',
		},
	};
}
