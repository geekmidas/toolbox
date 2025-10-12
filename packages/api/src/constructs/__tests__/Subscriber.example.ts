import type { EventPublisher, PublishableMessage } from '@geekmidas/events';
import type { Service } from '../../services';
import { SubscriberBuilder } from '../Subscriber';

// Define event types for a user domain
type UserEvent =
  | PublishableMessage<
      'user.created',
      { userId: string; email: string; name: string }
    >
  | PublishableMessage<
      'user.updated',
      { userId: string; changes: Record<string, any> }
    >
  | PublishableMessage<'user.deleted', { userId: string; deletedAt: Date }>;

// Create a mock event publisher
class UserEventPublisher implements EventPublisher<UserEvent> {
  async publish(events: UserEvent[]): Promise<void> {
    // In a real implementation, this would send events to a message queue, event bus, etc.
    void events; // Suppress unused variable warning
  }
}

// Create a service that provides the event publisher
class UserEventService
  implements Service<'userEventPublisher', UserEventPublisher>
{
  readonly serviceName = 'userEventPublisher' as const;

  register() {
    return new UserEventPublisher();
  }
}

// Example: Create a subscriber that processes batches of user events
export const userEventSubscriber = new SubscriberBuilder()
  .publisher(new UserEventService())
  .subscribe('user.created') // Subscribe to a single event
  .subscribe('user.updated') // Can chain multiple subscriptions
  .handle(async ({ events, logger }) => {
    // The handler receives an array of events
    logger.info(`Processing batch of ${events.length} events`);

    // Process each event in the batch
    for (const event of events) {
      switch (event.type) {
        case 'user.created':
          // event.payload is typed as { userId: string; email: string; name: string }
          logger.info(
            `User ${event.payload.userId} created with email ${event.payload.email}`,
          );
          // Could use services here to persist to database, send notifications, etc.
          break;
        case 'user.updated':
          // event.payload is typed as { userId: string; changes: Record<string, any> }
          logger.info(`User ${event.payload.userId} updated`);
          logger.debug(`Changes: ${JSON.stringify(event.payload.changes)}`);
          break;
        // Note: 'user.deleted' case is not possible here since we didn't subscribe to it
      }
    }

    return { processed: events.length }; // Return value can be validated against output schema
  });

// The subscriber now has:
// - Type-safe event handling (only subscribed events are available)
// - Automatic payload typing based on the event type
// - Access to services and logger from the context
// - No need to define input schema (it's derived from the events)

// Alternative: Subscribe to multiple events at once using an array
export const multiEventSubscriber = new SubscriberBuilder()
  .publisher(new UserEventService())
  .subscribe(['user.created', 'user.updated', 'user.deleted']) // Subscribe to multiple events
  .handle(async ({ events, logger }) => {
    // Handle all three event types in batch
    const eventCounts = events.reduce(
      (acc, event) => {
        acc[event.type] = (acc[event.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    logger.info(`Event batch summary: ${JSON.stringify(eventCounts)}`);
  });
