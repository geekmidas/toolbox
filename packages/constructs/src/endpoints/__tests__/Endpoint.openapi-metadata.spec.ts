import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { RestApi } from '../../rest-api';
import { Endpoint } from '../Endpoint';
import { NotAnExtension } from '../EndpointBuilder';

/**
 * What an operation says about itself beyond its inputs and outputs — a
 * summary, whether it is deprecated, vendor extensions, the tags it is
 * grouped under and what each tag is.
 */
const api = new RestApi('Payments', { path: '.', defaultAuthorizer: 'none' });

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

	it('groups a branch’s endpoints under its tag, described once', async () => {
		const payments = api.tag('payments', 'Taking money');
		const refunds = api.tag('refunds', 'Giving it back');

		const charge = payments.post('/charges').handle(async () => ({}));
		const refund = refunds.post('/refunds').handle(async () => ({}));

		const doc = await Endpoint.buildOpenApiSchema([charge, refund]);

		expect((doc.paths['/charges'] as any).post.tags).toEqual(['payments']);
		expect(doc.tags).toEqual([
			{ name: 'payments', description: 'Taking money' },
			{ name: 'refunds', description: 'Giving it back' },
		]);
	});

	it('chains tags, from the branch and the endpoint alike', async () => {
		const payments = api.tag('payments', 'Taking money').tag('cards');

		const charge = payments
			.post('/charges')
			.tag('beta', 'Not yet stable')
			.tags(['internal'])
			.handle(async () => ({}));

		const doc = await Endpoint.buildOpenApiSchema([charge]);

		expect((doc.paths['/charges'] as any).post.tags).toEqual([
			'payments',
			'cards',
			'beta',
			'internal',
		]);
		expect(doc.tags).toEqual([
			{ name: 'payments', description: 'Taking money' },
			{ name: 'cards' },
			{ name: 'beta', description: 'Not yet stable' },
			{ name: 'internal' },
		]);
	});

	it('lists a tag once, with the description any endpoint gave it', async () => {
		const list = api
			.get('/charges')
			.tags(['payments'])
			.handle(async () => []);
		const charge = api
			.tag('payments', 'Taking money')
			.post('/charges')
			.handle(async () => ({}));

		const doc = await Endpoint.buildOpenApiSchema([list, charge]);

		expect(doc.tags).toEqual([
			{ name: 'payments', description: 'Taking money' },
		]);
	});

	it('leaves the branch it came from untagged', async () => {
		api.tag('payments');
		const health = api.get('/health').handle(async () => ({}));

		expect(
			(await Endpoint.buildOpenApiSchema([health])).paths['/health'],
		).not.toHaveProperty('get.tags');
	});

	it('titles the document after the surface, unless the caller says otherwise', async () => {
		const list = api.get('/charges').handle(async () => []);

		expect((await Endpoint.buildOpenApiSchema([list])).info.title).toBe(
			'Payments',
		);
		expect(
			(await Endpoint.buildOpenApiSchema([list], { title: 'Override' })).info
				.title,
		).toBe('Override');
	});
});
