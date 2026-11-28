/**
 * How a delivery's request leaves the process — the one seam between a
 * `Webhooks` construct and the network.
 *
 * Deployed, it is `fetch` with redirects left unfollowed: a receiver that
 * answers 3xx has not accepted the delivery, and following it would send a
 * signed body to wherever the redirect points. A test hands the construct
 * one that never reaches the network.
 */
export type WebhookTransport = (request: Request) => Promise<Response>;

/** `fetch`, refusing to follow a redirect. */
export const fetchTransport: WebhookTransport = (request) =>
	fetch(request, { redirect: 'manual' });
