/**
 * Where SNS pushes a topic subscriber's messages, on the server that runs it:
 * named after the subscriber's export.
 *
 * One definition for both sides — the generated server mounts the route, and
 * the stack exposes exactly these paths on a worker's host — so the path the
 * edge lets through and the path the worker answers cannot drift.
 */
export const SUBSCRIBER_ROUTE_PREFIX = '/__gkm/subscribers/';

/** The route a subscriber's pushes arrive on. */
export function subscriberRoute(exportName: string): string {
	return `${SUBSCRIBER_ROUTE_PREFIX}${exportName}`;
}

/**
 * Where the deploy hands a server the SNS subscriptions it made for its
 * routes: a JSON object of subscriber export → subscription ARN. Against SNS
 * itself a server mounts a route only for a subscription recorded here, and
 * refuses a notification that names another.
 */
export const SNS_SUBSCRIPTIONS_KEY = 'GKM_SNS_SUBSCRIPTIONS';
