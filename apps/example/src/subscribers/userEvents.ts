import { SubscriberBuilder } from '@geekmidas/constructs/subscribers';
import { z } from 'zod';

/**
 * User events subscriber
 *
 * Listens for user-related events and processes them
 */
export const userEventsSubscriber = new SubscriberBuilder()
  .subscribe(['user.created', 'user.updated', 'user.deleted'])
  .timeout(30000)
  .output(
    z.object({
      processed: z.number(),
      success: z.boolean(),
    }),
  )
  .handle(async ({ events, logger }) => {
    logger.info(
      { eventCount: events.length, eventTypes: events.map((e) => e.type) },
      'Processing user events',
    );

    for (const event of events) {
      try {
        // Process each event based on type
        switch (event.type) {
          case 'user.created':
            logger.info({ userId: event.data.userId }, 'User created');
            // Handle user creation logic
            break;
          case 'user.updated':
            logger.info({ userId: event.data.userId }, 'User updated');
            // Handle user update logic
            break;
          case 'user.deleted':
            logger.info({ userId: event.data.userId }, 'User deleted');
            // Handle user deletion logic
            break;
        }
      } catch (error) {
        logger.error({ error, event }, 'Failed to process event');
        throw error;
      }
    }

    return {
      processed: events.length,
      success: true,
    };
  });
