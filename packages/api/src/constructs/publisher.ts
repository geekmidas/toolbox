import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Logger } from '../logger';
import type { Endpoint, EndpointEvent } from './Endpoint';
import type { EventPublisher } from './events';
import type { InferComposableStandardSchema } from './types';

export async function publishEndpointEvents<
  TPublisher extends EventPublisher<any>,
  OutSchema extends StandardSchemaV1 | undefined,
  T extends Endpoint<any, any, any, OutSchema, any, Logger, any, TPublisher>,
>(endpoint: T, response: InferComposableStandardSchema<OutSchema>) {
  if (!endpoint.events?.length) {
    endpoint.logger.debug('No events to publish');
    return;
  }
  if (!endpoint.publisher) {
    endpoint.logger.warn('No publisher available');
    return;
  }

  const events: EndpointEvent<T>[] = [];

  for (const { when, payload, type, ...e } of endpoint.events) {
    endpoint.logger.debug({ event: type }, 'Processing event');
    const resolvedPayload = await payload(response);
    const event = {
      ...e,
      type,
      payload: resolvedPayload,
    } as unknown as EndpointEvent<T>;

    if (!when || when(response)) {
      events.push(event);
    }
  }

  if (events.length) {
    endpoint.logger.debug({ eventCount: events.length }, 'Publishing events');

    await endpoint.publisher.publish(events).catch((err) => {
      endpoint.logger.error({ err }, 'Failed to publish events');
    });
  }
}
