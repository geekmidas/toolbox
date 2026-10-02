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
/** A quote the carrier was asked for. */
export interface QuoteRequest {
	destination: string;
	weightKg: number;
}

/**
 * Every quote the carrier was asked for, by destination — what a test asserts
 * on, by importing it from here.
 *
 * Keyed by something the test chooses, because this module is loaded once per
 * test file: a test reading the whole list would see the tests before it.
 */
const asked = new Map<string, QuoteRequest[]>();

/** The quotes asked for a destination. */
export function quotesFor(destination: string): QuoteRequest[] {
	return asked.get(destination) ?? [];
}

const carrier = new Hono().post('/quotes', async (c) => {
	if (c.req.header('authorization') !== 'Bearer fake-key') {
		return c.json({ error: 'unknown key' }, 401);
	}

	const request = await c.req.json<QuoteRequest>();
	asked.set(request.destination, [...quotesFor(request.destination), request]);

	return c.json({
		destination: request.destination,
		amount: 50 + request.weightKg * 10,
	});
});

export default fake.app<typeof shipping>(carrier, {
	credentials: { apiKey: 'fake-key' },
});
