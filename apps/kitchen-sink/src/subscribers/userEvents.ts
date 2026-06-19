import { s } from '@geekmidas/constructs/subscribers';
import logger from '../config/logger.js';
import { DatabaseService } from '../services/DatabaseService.js';
import { EventsService } from '../services/EventsService.js';

/**
 * A topic subscriber — fan-out. Chaining `.publisher(EventsService)` types the
 * subscribed events (and their payloads) from `AppEvents`, so `event.payload` is
 * narrowed per `event.type`. Many subscribers can each subscribe to the same
 * stream; this one reacts to user lifecycle events.
 *
 * Locally it runs as an in-process pg-boss poller alongside the Hono server;
 * deployed it's an SNS subscription.
 */
export const userEventsSubscriber = s
	.logger(logger)
	.services([DatabaseService])
	.publisher(EventsService)
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
