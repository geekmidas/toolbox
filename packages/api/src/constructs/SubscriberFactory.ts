import { SubscriberBuilder } from './Subscriber';

/**
 * The default subscriber factory for building event subscribers
 *
 * @example
 * ```typescript
 * import { s } from '@geekmidas/api/subscriber';
 *
 * const userSubscriber = s
 *   .publisher(userEventService)
 *   .subscribe('user.created')
 *   .handle(async ({ events, logger }) => {
 *     logger.info(`Processing ${events.length} events`);
 *     // Process events...
 *   });
 * ```
 */
export const s = new SubscriberBuilder();
