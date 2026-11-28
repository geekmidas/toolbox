/**
 * A `Webhooks` construct in a feature test: its deliveries answered by MSW,
 * its schedule read off the test's clock.
 *
 * Everything else — subscriptions, fan-out, signing, retries, the rows they
 * leave — runs as deployed, in the test's transaction. Only the hop to the
 * customer's server and the time are replaced, each at the seam the construct
 * offers for it: `hooks.transport` and `hooks.clock`.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { http } from 'msw';
import type { WebhookTransport } from '../webhooks/transport';
import type { Webhooks } from '../webhooks/Webhooks';

/** Set while a delivery's request is in flight, so its fallback can tell. */
const inFlight = new AsyncLocalStorage<{ unmatched: boolean }>();

/**
 * A delivery no handler answered. Raised as a connection failure would be —
 * a `TypeError`, as `fetch` rejects with — so it is recorded as a failed
 * attempt, and the delivery is retried like any other.
 */
export class WebhookReceiverNotFaked extends TypeError {
	constructor(
		readonly method: string,
		readonly url: string,
	) {
		super(
			`${method} ${url} reached no handler, so the delivery failed as an ` +
				`unreachable server would. In a featureTest a webhook never leaves ` +
				`the process: answer it with msw.use(http.post('${url}', …)).`,
		);
		this.name = 'WebhookReceiverNotFaked';
	}
}

/**
 * How a delivery leaves the process in a feature test: through `fetch`, which
 * MSW intercepts, with redirects left unfollowed as deployed. A request no
 * handler answers fails like a connection, rather than reaching the network.
 */
export const testTransport: WebhookTransport = async (request) => {
	const flight = { unmatched: false };
	try {
		return await inFlight.run(flight, () =>
			fetch(request, { redirect: 'manual' }),
		);
	} catch (error) {
		if (flight.unmatched) {
			throw new WebhookReceiverNotFaked(request.method, request.url);
		}
		throw error;
	}
};

/**
 * The last handler of a feature test's network: a delivery that nothing
 * before it answered gets a network error. Any other request is left alone —
 * a local service is still let through, and anything else still reported as
 * unhandled.
 */
export const unmatchedDelivery = http.all('*', () => {
	const flight = inFlight.getStore();
	if (!flight) return undefined;
	flight.unmatched = true;
	return Response.error();
});

/**
 * Put each construct's delivery on MSW and its schedule on `now`, until the
 * returned function puts back what it had.
 */
export function onTestSeams(
	constructs: readonly Webhooks<any, any, any>[],
	now: (fallback: () => Date) => Date,
): () => void {
	const swapped = constructs.map((hooks) => {
		const { transport, clock } = hooks;
		hooks.transport = testTransport;
		hooks.clock = () => now(clock);
		return () => {
			hooks.transport = transport;
			hooks.clock = clock;
		};
	});
	return () => {
		for (const restore of swapped) restore();
	};
}
