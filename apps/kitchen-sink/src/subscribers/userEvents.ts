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
 *
 * It writes a row rather than logging one. That is the difference between
 * fan-out being *real* and being *observable*: a log line can only be asserted
 * on by scraping stdout, which passes for the wrong reasons as often as it
 * fails, while a row is evidence a query can ask for and a person can look at.
 * It is also the feature — `GET /notifications` is this table.
 *
 * The handler takes a batch and inserts once. Both transports deliver in
 * batches, and a per-event insert would be a round trip per event for no reason.
 */
export const userEventsSubscriber = s
	.logger(logger)
	.dependsOn([database])
	.topic(users)
	.subscribe(['user.created', 'user.updated'])
	.handle(async ({ events, services, logger }) => {
		const rows = events.map((event) =>
			event.type === 'user.created'
				? {
						user_id: event.payload.userId,
						type: event.type,
						body: `${event.payload.name} joined`,
					}
				: {
						user_id: event.payload.userId,
						type: event.type,
						body: `Profile updated: ${event.payload.changes.join(', ')}`,
					},
		);

		if (rows.length === 0) return;

		await services.kitchenSink
			.insertInto('notifications')
			.values(rows)
			.execute();

		logger.info(
			{ count: rows.length, types: rows.map((r) => r.type) },
			'Fan-out: wrote notifications',
		);
	});
