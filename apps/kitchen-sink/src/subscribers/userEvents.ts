import { s } from '@geekmidas/constructs/subscribers';
import logger from '../config/logger.js';
import { database } from '../constructs/database.js';
import { users } from '../constructs/topics.js';

/**
 * A topic subscriber — fan-out. `.topic(users)` types the events and their
 * payloads from the topic's contract and records the binding for the manifest,
 * so infra wires the subscription.
 *
 * Binding is not depending: a consumer does not publish, so this subscriber is
 * never handed the topic's publisher connection string. Locally it runs as an
 * in-process pg-boss poller alongside the Hono server; deployed it is an SNS
 * subscription.
 */
export const userEventsSubscriber = s
	.logger(logger)
	.dependsOn([database])
	.topic(users)
	.subscribe(['user.created', 'user.updated'])
	.handle(async ({ events, logger }) => {
		for (const event of events) {
			if (event.type === 'user.created') {
				logger.info(
					{ userId: event.payload.userId, email: event.payload.email },
					'Fan-out: user.created',
				);
			} else {
				logger.info(
					{ userId: event.payload.userId, changes: event.payload.changes },
					'Fan-out: user.updated',
				);
			}
		}
	});
