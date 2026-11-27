import { describe, expect, it } from 'vitest';
import { RestApi } from '../../rest-api';
import { Endpoint } from '../Endpoint';

/**
 * What the document says about the API as a whole: who to contact, its
 * licence, and where it is reached.
 */
const derived = [
	{ url: 'https://api.staging.myapp.com', description: 'staging' },
	{ url: 'https://api.myapp.com', description: 'production' },
];

describe('the document’s info and servers', () => {
	it('carries the contact and licence the surface gives', async () => {
		const health = new RestApi('Api', {
			path: '.',
			defaultAuthorizer: 'none',
			contact: { name: 'Platform', email: 'platform@example.com' },
			license: { name: 'Apache-2.0', identifier: 'Apache-2.0' },
		})
			.get('/health')
			.handle(async () => ({}));

		const doc = await Endpoint.buildOpenApiSchema([health]);

		expect(doc.info).toEqual({
			title: 'Api',
			version: '1.0.0',
			contact: { name: 'Platform', email: 'platform@example.com' },
			license: { name: 'Apache-2.0', identifier: 'Apache-2.0' },
		});
	});

	it('lists the servers a build derived from the stages', async () => {
		const health = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' })
			.get('/health')
			.handle(async () => ({}));

		const doc = await Endpoint.buildOpenApiSchema([health], {
			servers: derived,
		});

		expect(doc.servers).toEqual(derived);
	});

	it('lists no servers when none are known', async () => {
		const health = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' })
			.get('/health')
			.handle(async () => ({}));

		expect(await Endpoint.buildOpenApiSchema([health])).not.toHaveProperty(
			'servers',
		);
	});
});
