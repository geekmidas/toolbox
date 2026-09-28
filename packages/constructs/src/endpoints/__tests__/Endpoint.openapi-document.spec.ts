import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { RestApi } from '../../rest-api';
import { Endpoint } from '../Endpoint';

/**
 * The document `buildOpenApiSchema` writes, checked the way an independent
 * validator would read it — each case is a defect Redocly and openapi-typescript
 * found in kitchen-sink's spec.
 */
const api = new RestApi('Docs', {
	path: '.',
	authorizers: ['iam'],
	defaultAuthorizer: 'none',
});

const User = z
	.object({ id: z.string(), name: z.string() })
	.meta({ id: 'DocUser' });

describe('the OpenAPI document', () => {
	it('keeps a registered schema as its definition, not a pointer to itself', async () => {
		const getUser = api
			.get('/users/:id')
			.params(z.object({ id: z.string() }))
			.output(User)
			.handle(async () => ({ id: '1', name: 'Ada' }));

		const doc = await Endpoint.buildOpenApiSchema([getUser]);
		const definition = (doc.components?.schemas as any).DocUser;

		expect(definition).not.toHaveProperty('$ref');
		expect(definition).toMatchObject({
			type: 'object',
			properties: { id: { type: 'string' }, name: { type: 'string' } },
		});
		expect(
			(doc.paths['/users/{id}'] as any).get.responses['200'].content[
				'application/json'
			].schema,
		).toEqual({ $ref: '#/components/schemas/DocUser' });
	});

	it('is OpenAPI 3.1, whose schemas are the JSON Schema dialect it contains', async () => {
		const list = api
			.get('/things')
			.output(z.object({ note: z.string().nullable() }))
			.handle(async () => ({ note: null }));

		const doc = await Endpoint.buildOpenApiSchema([list]);

		expect(doc.openapi).toBe('3.1.0');
		// No per-schema dialect marker: the document declares it once.
		expect(JSON.stringify(doc)).not.toContain('"$schema"');
	});

	it('documents who may call an endpoint an authorizer guards', async () => {
		const open = api.get('/open').handle(async () => ({}));
		const guarded = api
			.get('/guarded')
			.authorizer('iam')
			.handle(async () => ({}));

		const doc = await Endpoint.buildOpenApiSchema([open, guarded]);

		expect((doc.paths['/guarded'] as any).get.security).toEqual([{ iam: [] }]);
		expect((doc.paths['/open'] as any).get).not.toHaveProperty('security');
		expect(doc.components?.securitySchemes).toEqual({
			iam: expect.objectContaining({
				type: 'apiKey',
				in: 'header',
				name: 'Authorization',
			}),
		});
	});

	it('documents the status an endpoint answers with', async () => {
		const create = api
			.post('/things')
			.status(201)
			.body(z.object({ name: z.string() }))
			.output(z.object({ id: z.string() }))
			.handle(async () => ({ id: '1' }));

		const doc = await Endpoint.buildOpenApiSchema([create]);
		const responses = (doc.paths['/things'] as any).post.responses;

		expect(Object.keys(responses)).toEqual(['201']);
		expect(responses['201'].content['application/json'].schema).toMatchObject({
			type: 'object',
		});
	});
});
