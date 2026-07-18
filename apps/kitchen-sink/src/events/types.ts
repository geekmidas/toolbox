import type { PublishableMessage } from '@geekmidas/events';

/**
 * The app's domain events — published to a topic (SNS deployed, pg-boss locally)
 * and fanned out to any number of subscribers (`s`). Distinct from a *queue*
 * message, which is point-to-point work for a single consumer.
 */
export type AppEvents =
	| PublishableMessage<
			'user.created',
			{ userId: string; email: string; name: string }
	  >
	| PublishableMessage<'user.updated', { userId: string; changes: string[] }>;
