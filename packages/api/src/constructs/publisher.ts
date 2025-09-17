import type { Endpoint } from './Endpoint';

export async function publishEndpointEvents(
  endpoint: Endpoint<any, any, any, any, any, any, any, any>,
  response: any,
) {
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
    const resolvedPayload = await payload(response as any);
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
