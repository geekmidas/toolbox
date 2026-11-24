import { describe, expect } from 'vitest';
import { it } from '#test';

/**
 * A `Maps`, end to end. The endpoint geocodes through the client its
 * `.dependsOn([maps])` hands it; under `gkm test` the stage holds no key
 * Google issued, and Google's hosts are answered in-process by the built-in
 * fake. Nothing in this file sets any of that up.
 */
describe('places', () => {
	it('geocodes an address through the Maps client', async ({ browser }) => {
		const { results } = await browser.api.post('/places/geocode', {
			body: { address: '1 Main Road, Woodstock' },
		});

		expect(results).toEqual([
			{
				address: '1 Main Road, Woodstock',
				lat: expect.any(Number),
				lng: expect.any(Number),
			},
		]);
	});

	it('answers the same point for the same address', async ({ browser }) => {
		const ask = () =>
			browser.api.post('/places/geocode', {
				body: { address: 'Observatory, Cape Town' },
			});

		expect(await ask()).toEqual(await ask());
	});
});
