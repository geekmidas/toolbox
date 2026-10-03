import { describe, expect } from 'vitest';
import { it } from '#test';
import { quotesFor } from '../../../test/fakes/shipping.js';

/**
 * An external API, end to end. The endpoint calls the carrier over HTTP; the
 * test stage resolved `SHIPPING_URL` to the fake and `SHIPPING_CREDENTIALS` to
 * the key the fake accepts, and the harness serves the fake there. Nothing in
 * this file sets any of that up.
 */
describe('shipping', () => {
	it('quotes through the carrier', async ({ browser }) => {
		const quote = await browser.api.post('/shipping/quotes', {
			body: { destination: 'Cape Town', weightKg: 2 },
		});

		expect(quote).toEqual({ destination: 'Cape Town', amount: 70 });
	});

	it('asks the carrier for exactly the parcel it was given', async ({
		browser,
		faker,
	}) => {
		// A destination no other test uses: the fake keeps what it was asked
		// for the whole file, so this test reads only its own.
		const destination = faker.location.city();

		await browser.api.post('/shipping/quotes', {
			body: { destination, weightKg: 3.5 },
		});

		expect(quotesFor(destination)).toEqual([{ destination, weightKg: 3.5 }]);
	});
});
