import { fake } from '@geekmidas/constructs/external-api';
import type { shipping } from '@kitchen-sink/constructs/shipping.js';
import { Hono } from 'hono';

/**
 * The carrier, as far as kitchen-sink needs one: it checks the key and quotes
 * a flat rate by weight.
 *
 * A working implementation of the carrier's interface rather than a mock — the
 * client talks HTTP to it exactly as it would to the carrier. Found by its
 * path, `test/fakes/<construct>.ts`; the construct never imports it, so it is
 * in no deployed bundle.
 */
const carrier = new Hono().post('/quotes', async (c) => {
	if (c.req.header('authorization') !== 'Bearer fake-key') {
		return c.json({ error: 'unknown key' }, 401);
	}

	const { destination, weightKg } = await c.req.json<{
		destination: string;
		weightKg: number;
	}>();

	return c.json({ destination, amount: 50 + weightKg * 10 });
});

export default fake.app<typeof shipping>(carrier, {
	credentials: { apiKey: 'fake-key' },
});
