import { fake } from '@geekmidas/constructs/external-api';
import type {
	QuoteRequest,
	shipping,
} from '@kitchen-sink/constructs/shipping.js';
import { Hono } from 'hono';

/**
 * The carrier, as far as kitchen-sink needs one: it checks the key, quotes a
 * flat rate by weight, and lists what it was asked — the carrier's own API,
 * `POST /quotes` and `GET /quotes`.
 *
 * A working implementation of that interface rather than a mock, and hidden: a
 * test never imports this. It asserts through the client a handler gets,
 * `services.get('shipping')`, so the same assertion holds against the
 * carrier's sandbox. Found by its path, `test/fakes/<construct>.ts`; the
 * construct never imports it, so it is in no deployed bundle.
 */

/**
 * Every quote the carrier was asked for, by destination. This module is loaded
 * once per test file, so a test reads by a destination it chose, never the
 * whole list.
 */
const asked = new Map<string, QuoteRequest[]>();

const authorized = (header: string | undefined) => header === 'Bearer fake-key';

const carrier = new Hono()
	.post('/quotes', async (c) => {
		if (!authorized(c.req.header('authorization'))) {
			return c.json({ error: 'unknown key' }, 401);
		}

		const request = await c.req.json<QuoteRequest>();
		asked.set(request.destination, [
			...(asked.get(request.destination) ?? []),
			request,
		]);

		return c.json({
			destination: request.destination,
			amount: 50 + request.weightKg * 10,
		});
	})
	.get('/quotes', (c) => {
		if (!authorized(c.req.header('authorization'))) {
			return c.json({ error: 'unknown key' }, 401);
		}

		return c.json(asked.get(c.req.query('destination') ?? '') ?? []);
	});

export default fake.app<typeof shipping>(carrier, {
	credentials: { apiKey: 'fake-key' },
});
