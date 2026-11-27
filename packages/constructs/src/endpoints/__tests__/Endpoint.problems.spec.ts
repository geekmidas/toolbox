import { EnvironmentParser } from '@geekmidas/envkit';
import { createHttpError } from '@geekmidas/errors';
import { ServiceDiscovery } from '@geekmidas/services';
import { createMockContext, createMockV2Event } from '@geekmidas/testkit/aws';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { RestApi } from '../../rest-api';
import { AmazonApiGatewayV2Endpoint } from '../AmazonApiGatewayV2EndpointAdaptor';
import { Endpoint } from '../Endpoint';
import { HonoEndpoint } from '../HonoEndpointAdaptor';
import { ErrorStatusNotARefusal } from '../problems';

/**
 * The refusals an endpoint declares with `.error()`: in the document as
 * `application/problem+json`, and on the wire as RFC 9457 problem details
 * when the surface answers that way.
 */
const problems = new RestApi('Problems', {
	path: '.',
	defaultAuthorizer: 'none',
	errors: 'problem',
});
const legacy = new RestApi('Legacy', { path: '.', defaultAuthorizer: 'none' });

const serviceDiscovery = ServiceDiscovery.getInstance(
	new EnvironmentParser({}),
);

function mount(...endpoints: Endpoint<any, any, any, any, any, any>[]): Hono {
	const app = new Hono();
	HonoEndpoint.addRoutes(endpoints, serviceDiscovery, app);
	return app;
}

function createUser(api: RestApi<string>) {
	return api
		.post('/users')
		.body(z.object({ name: z.string(), email: z.email() }))
		.output(z.object({ id: z.string() }))
		.error(409, 'EMAIL_TAKEN', {
			description: 'The email is already registered.',
			details: z.object({ email: z.email() }),
		})
		.error(422, 'NAME_RESERVED', { description: 'The name is reserved.' })
		.handle(async ({ body }) => {
			if (body.name === 'admin') {
				throw createHttpError(422, 'That name is reserved', {
					code: 'NAME_RESERVED',
				});
			}
			throw createHttpError(409, 'That email is registered', {
				code: 'EMAIL_TAKEN',
				details: { email: body.email },
			});
		});
}

const post = (body: unknown) => ({
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(body),
});

describe('the refusals an endpoint declares', () => {
	describe('in the OpenAPI document', () => {
		it('documents each status as problem+json, its codes an enum on a shared Problem', async () => {
			const doc = await Endpoint.buildOpenApiSchema([createUser(problems)]);
			const responses = (doc.paths['/users'] as any).post.responses;

			expect(Object.keys(responses)).toEqual(['200', '409', '422']);
			expect(responses['409']).toEqual({
				description: 'The email is already registered.',
				content: {
					'application/problem+json': {
						schema: {
							allOf: [
								{ $ref: '#/components/schemas/Problem' },
								{
									type: 'object',
									properties: {
										code: { type: 'string', enum: ['EMAIL_TAKEN'] },
										details: expect.objectContaining({
											type: 'object',
											required: ['email'],
										}),
									},
									required: ['code'],
								},
							],
						},
					},
				},
			});
			// The body schema's own 422 sits beside the one the handler declared.
			expect(
				responses['422'].content['application/problem+json'].schema.allOf[1]
					.properties.code,
			).toEqual({
				type: 'string',
				enum: ['VALIDATION_FAILED', 'NAME_RESERVED'],
			});
			expect((doc.components?.schemas as any).Problem).toMatchObject({
				type: 'object',
				required: ['type', 'title', 'status', 'detail'],
				properties: {
					type: { type: 'string' },
					code: { type: 'string' },
				},
			});
		});

		it('declares a refusal shared by a branch on every endpoint built from it', async () => {
			const router = problems.error(401, 'SIGNED_OUT');
			const me = router.get('/me').handle(async () => ({}));
			const settings = router
				.get('/settings')
				.error(403, 'NOT_OWNER')
				.handle(async () => ({}));
			const health = problems.get('/health').handle(async () => ({}));

			const doc = await Endpoint.buildOpenApiSchema([me, settings, health]);
			const responsesOf = (path: string) =>
				Object.keys((doc.paths[path] as any).get.responses);

			expect(responsesOf('/me')).toEqual(['200', '401']);
			expect(responsesOf('/settings')).toEqual(['200', '401', '403']);
			// The surface itself is left as it was.
			expect(responsesOf('/health')).toEqual(['200']);
		});

		it('documents the statuses on a surface answering the default body, claiming no body', async () => {
			const doc = await Endpoint.buildOpenApiSchema([createUser(legacy)]);
			const responses = (doc.paths['/users'] as any).post.responses;

			expect(responses['409']).toEqual({
				description: 'The email is already registered.',
			});
			expect(responses['422']).toEqual({
				description: 'The name is reserved.',
			});
			expect(doc.components?.schemas ?? {}).not.toHaveProperty('Problem');
		});

		it('refuses a status that is not a refusal', () => {
			expect(() => problems.get('/x').error(204 as never, 'NOTHING')).toThrow(
				ErrorStatusNotARefusal,
			);
		});
	});

	describe('on Hono, with errors: problem', () => {
		it('answers a declared refusal as problem details', async () => {
			const app = mount(createUser(problems));

			const response = await app.request(
				'/users',
				post({ name: 'Ada', email: 'ada@example.com' }),
			);

			expect(response.status).toBe(409);
			expect(response.headers.get('content-type')).toBe(
				'application/problem+json',
			);
			expect(await response.json()).toEqual({
				type: 'about:blank',
				title: 'Conflict',
				status: 409,
				detail: 'That email is registered',
				code: 'EMAIL_TAKEN',
				details: { email: 'ada@example.com' },
			});
		});

		it('answers a rejected body with the 422 the document describes', async () => {
			const endpoint = createUser(problems);
			const app = mount(endpoint);
			const doc = await Endpoint.buildOpenApiSchema([endpoint]);
			const documented = (doc.paths['/users'] as any).post.responses['422']
				.content['application/problem+json'].schema.allOf[1];

			const response = await app.request(
				'/users',
				post({ name: 'Ada', email: 'not-an-email' }),
			);
			const body = await response.json();

			expect(response.status).toBe(422);
			expect(response.headers.get('content-type')).toBe(
				'application/problem+json',
			);
			expect(body).toMatchObject({
				type: 'about:blank',
				title: 'Unprocessable Entity',
				status: 422,
				detail: 'Validation failed',
				code: 'VALIDATION_FAILED',
			});
			expect(documented.properties.code.enum).toContain(body.code);
			expect(body.details).toEqual([
				expect.objectContaining({ message: expect.any(String) }),
			]);
		});

		it('answers a declared 422 the handler throws', async () => {
			const app = mount(createUser(problems));

			const response = await app.request(
				'/users',
				post({ name: 'admin', email: 'root@example.com' }),
			);

			expect(response.status).toBe(422);
			expect(await response.json()).toEqual({
				type: 'about:blank',
				title: 'Unprocessable Entity',
				status: 422,
				detail: 'That name is reserved',
				code: 'NAME_RESERVED',
			});
		});

		it('answers a refused authorization as a 403 problem', async () => {
			const endpoint = problems
				.authorize(async () => false)
				.get('/secret')
				.handle(async () => ({}));

			const response = await mount(endpoint).request('/secret');

			expect(response.status).toBe(403);
			expect(response.headers.get('content-type')).toBe(
				'application/problem+json',
			);
			expect(await response.json()).toMatchObject({
				type: 'about:blank',
				title: 'Forbidden',
				status: 403,
			});
		});

		it("hides a server failure's details outside dev", async () => {
			const endpoint = problems.get('/boom').handle(async () => {
				throw createHttpError(500, 'It broke', {
					details: { query: 'select secret' },
				});
			});

			const response = await mount(endpoint).request('/boom');

			expect(response.status).toBe(500);
			expect(await response.json()).toEqual({
				type: 'about:blank',
				title: 'Internal Server Error',
				status: 500,
				detail: 'It broke',
			});
		});
	});

	describe('on Hono, by default', () => {
		it('answers with the body it always has', async () => {
			const app = mount(createUser(legacy));

			const conflict = await app.request(
				'/users',
				post({ name: 'Ada', email: 'ada@example.com' }),
			);
			expect(conflict.status).toBe(409);
			expect(conflict.headers.get('content-type')).toBe('application/json');
			expect(await conflict.json()).toMatchObject({
				name: 'ConflictError',
				message: 'That email is registered',
				statusCode: 409,
				statusMessage: 'Conflict',
				code: 'EMAIL_TAKEN',
				details: { email: 'ada@example.com' },
			});

			const invalid = await app.request(
				'/users',
				post({ name: 'Ada', email: 'not-an-email' }),
			);
			expect(invalid.status).toBe(422);
			expect(invalid.headers.get('content-type')).toBe('application/json');
			// The issues themselves, as before.
			expect(Array.isArray(await invalid.json())).toBe(true);
		});
	});

	describe('on API Gateway, with errors: problem', () => {
		const invoke = (api: RestApi<string>, body: unknown) =>
			new AmazonApiGatewayV2Endpoint(createUser(api)).handler(
				createMockV2Event({
					routeKey: 'POST /users',
					rawPath: '/users',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body),
				}),
				createMockContext(),
			);

		it('answers a declared refusal as problem details', async () => {
			const response = await invoke(problems, {
				name: 'Ada',
				email: 'ada@example.com',
			});

			expect(response.statusCode).toBe(409);
			expect(response.headers?.['Content-Type']).toBe(
				'application/problem+json',
			);
			expect(JSON.parse(response.body as string)).toEqual({
				type: 'about:blank',
				title: 'Conflict',
				status: 409,
				detail: 'That email is registered',
				code: 'EMAIL_TAKEN',
				details: { email: 'ada@example.com' },
			});
		});

		it('answers a rejected body as a VALIDATION_FAILED problem', async () => {
			const response = await invoke(problems, {
				name: 'Ada',
				email: 'nope',
			});

			expect(response.statusCode).toBe(422);
			expect(JSON.parse(response.body as string)).toMatchObject({
				type: 'about:blank',
				title: 'Unprocessable Entity',
				status: 422,
				detail: 'Validation failed',
				code: 'VALIDATION_FAILED',
				details: [expect.objectContaining({ message: expect.any(String) })],
			});
		});

		it('answers with the body it always has by default', async () => {
			const response = await invoke(legacy, {
				name: 'Ada',
				email: 'ada@example.com',
			});

			expect(response.statusCode).toBe(409);
			expect(response.headers?.['Content-Type']).toBeUndefined();
			expect(JSON.parse(response.body as string)).toEqual({
				message: 'That email is registered',
				code: 'EMAIL_TAKEN',
				error: { email: 'ada@example.com' },
			});
		});
	});
});
