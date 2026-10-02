import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readFakes } from '../../reconcile/fakes';
import { closeFakes, type ServedFake, serveFakes } from '../fakes';

const root = join(
	dirname(fileURLToPath(import.meta.url)),
	'../../reconcile/__tests__/__fixtures__/fakes',
);

const manifest = {
	Polar: {
		kind: 'external-api' as const,
		id: 'Polar',
		url: 'https://www.polaraccesslink.com',
		provides: ['POLAR_URL', 'POLAR_CREDENTIALS'],
	},
	Stripe: {
		kind: 'external-api' as const,
		id: 'Stripe',
		url: 'https://api.stripe.com',
		provides: ['STRIPE_URL', 'STRIPE_CREDENTIALS'],
	},
};

describe('serveFakes', () => {
	let served: ServedFake[] = [];
	afterEach(() => closeFakes(served));

	it('serves each app fake on its allocated port, and leaves image fakes to their containers', async () => {
		const fakes = await readFakes(root, manifest);
		served = await serveFakes(fakes, {
			'polar-fake': 47_811,
			'stripe-fake': 47_812,
		});

		expect(served.map(({ id, port }) => ({ id, port }))).toEqual([
			{ id: 'Polar', port: 47_811 },
		]);

		const response = await fetch('http://localhost:47811/anything');
		expect(await response.json()).toEqual({ ok: true });
	});
});
