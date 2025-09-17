import type { Endpoint, EndpointOutput } from './Endpoint';

export async function publishEndpointEvents<
  T extends Endpoint<any, any, any, any, any, any, any, any>,
>(endpoint: T, response: EndpointOutput<T>) {
  if (!endpoint.events?.length) {
    endpoint.logger.debug('No events to publish');
    return;
  }
  if (!endpoint.publisher) {
    endpoint.logger.warn('No publisher available');
    return;
  }

  const events: any[] = [];

  for (const { when, payload, type, ...e } of endpoint.events) {
    endpoint.logger.debug({ event: type }, 'Processing event');
    const resolvedPayload = await payload(response);
    const event = {
      ...e,
      type,
      payload: resolvedPayload,
    };

    if (!when || when(response as any)) {
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
