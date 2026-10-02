import { ExternalApi } from '@geekmidas/constructs/external-api';
import { z } from 'zod';

/** What the carrier quotes for a parcel. */
export interface Quote {
	destination: string;
	amount: number;
}

/**
 * A carrier's API — somebody else's server, with an address that changes by
 * stage.
 *
 * Deployed it is the carrier: its live host on `production`, its sandbox on
 * any other stage. Locally and in tests it is `test/fakes/shipping.ts`, served
 * by gkm at the URL the stage resolves, so no test sets anything up and nothing
 * local ever calls the carrier. Nothing here names the fake — that is what
 * keeps it out of the deployed bundle. The credentials are one JSON value per
 * stage:
 *
 * ```
 * gkm secrets:set SHIPPING_CREDENTIALS '{"apiKey":"…"}' --stage production
 * ```
 */
export const shipping = new ExternalApi('Shipping', {
	url: {
		production: 'https://api.carrier.example',
		default: 'https://sandbox.carrier.example',
	},
	credentials: z.object({ apiKey: z.string().min(1) }),
	client: ({ url, credentials }) => ({
		async quote(destination: string, weightKg: number): Promise<Quote> {
			const response = await fetch(`${url}/quotes`, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${credentials.apiKey}`,
					'content-type': 'application/json',
				},
				body: JSON.stringify({ destination, weightKg }),
			});
			if (!response.ok) throw new QuoteRefused(response.status);

			return (await response.json()) as Quote;
		},
	}),
});

/** The carrier answered a quote with an error. */
export class QuoteRefused extends Error {
	constructor(readonly status: number) {
		super(
			`The carrier refused the quote with ${status}. A 401 is the stage's ` +
				`SHIPPING_CREDENTIALS; anything else is the carrier's to explain.`,
		);
		this.name = 'QuoteRefused';
	}
}
