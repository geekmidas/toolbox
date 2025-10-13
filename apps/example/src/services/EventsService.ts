import type { EnvironmentParser } from '@geekmidas/envkit';
import {
  EventConnectionFactory,
  type EventPublisher,
  type PublishableMessage,
  Publisher,
} from '@geekmidas/events';

type UserEvents =
  | PublishableMessage<'user.created', { userId: string; email: string }>
  | PublishableMessage<
      'user.updated',
      { userId: string; changes: Record<string, any> }
    >
  | PublishableMessage<'user.deleted', { userId: string }>;

type EventsServicePublisher = EventPublisher<UserEvents>;
export class EventsService {
  public static instance: EventsServicePublisher;
  static serviceName = 'events' as const;

  public static config = (envParser: EnvironmentParser<{}>) =>
    envParser.create((get) => ({
      connectionString: get('EVENT_SUBSCRIBER_CONNECTION_STRING').string(),
    }));

  static async register(
    envParser: EnvironmentParser<{}>,
  ): Promise<EventsServicePublisher> {
    if (!EventsService.instance) {
      const config = EventsService.config(envParser).parse();
      const connection = await EventConnectionFactory.fromConnectionString(
        config.connectionString,
      );

      EventsService.instance = await Publisher.fromConnection(connection);
    }

    return EventsService.instance;
  }
}
