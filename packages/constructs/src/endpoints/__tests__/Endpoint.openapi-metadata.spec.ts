import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { RestApi } from '../../rest-api';
import { Endpoint } from '../Endpoint';
import { NotAnExtension } from '../EndpointBuilder';

/**
 * What an operation says about itself beyond its inputs and outputs — a
 * summary, whether it is deprecated, vendor extensions — and what the
 * surface says once for all of them: tag descriptions and their order.
 */
const api = new RestApi('Payments', {
	path: '.',
	defaultAuthorizer: 'none',
	openapi: {
		title: 'Payments API',
		version: '2.1.0',
		tags: [
			{ name: 'payments', description: 'Taking money' },
			{ name: 'refunds', description: 'Giving it back' },
		],
	},
});

describe('operation metadata', () => {
	it('documents a summary, deprecation and vendor extensions', async () => {
		const charge = api
			.post('/charges')
			.summary('Take a payment')
			.description('Charges the card on file.')
			.deprecated()
			.extensions({ 'x-internal': true })
			.extensions({ 'x-rate-class': 'write' })
			.tags(['payments'])
			.body(z.object({ amount: z.number() }))
			.handle(async () => ({}));

		const doc = await Endpoint.buildOpenApiSchema([charge]);
		const operation = (doc.paths['/charges'] as any).post;

		expect(operation).toMatchObject({
			summary: 'Take a payment',
			description: 'Charges the card on file.',
			deprecated: true,
			'x-internal': true,
			'x-rate-class': 'write',
		});
	});

	it('writes neither summary nor deprecated for an endpoint that says neither', async () => {
		const list = api.get('/charges').handle(async () => []);

		const doc = await Endpoint.buildOpenApiSchema([list]);
		const operation = (doc.paths['/charges'] as any).get;

		expect(operation).not.toHaveProperty('summary');
		expect(operation).not.toHaveProperty('deprecated');
	});

	it('refuses an extension key OpenAPI does not leave open', () => {
		expect(() =>
			api.get('/x').extensions({ summary: 'nope' } as never),
		).toThrow(NotAnExtension);
	});

	it('lists the surface’s tags with descriptions, in its order, then any undeclared', async () => {
		const refund = api
			.post('/refunds')
			.tags(['refunds'])
			.handle(async () => ({}));
		const charge = api
			.post('/charges')
			.tags(['payments', 'cards'])
			.handle(async () => ({}));

		const doc = await Endpoint.buildOpenApiSchema([refund, charge]);

		expect(doc.tags).toEqual([
			{ name: 'payments', description: 'Taking money' },
			{ name: 'refunds', description: 'Giving it back' },
			{ name: 'cards' },
		]);
	});

	it('titles the document from the surface, unless the caller says otherwise', async () => {
		const list = api.get('/charges').handle(async () => []);
		const plain = new RestApi('Plain', { path: '.', defaultAuthorizer: 'none' })
			.get('/x')
			.handle(async () => ({}));

		expect((await Endpoint.buildOpenApiSchema([list])).info).toMatchObject({
			title: 'Payments API',
			version: '2.1.0',
		});
		expect((await Endpoint.buildOpenApiSchema([plain])).info.title).toBe(
			'Plain',
		);
		expect(
			(await Endpoint.buildOpenApiSchema([list], { title: 'Override' })).info
				.title,
		).toBe('Override');
	});
});
