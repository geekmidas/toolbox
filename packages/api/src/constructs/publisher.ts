import type { Logger } from '../logger';
import type { ServiceDiscovery } from '../services';
import type { Endpoint, EndpointOutput } from './Endpoint';
import type { EventPublisher } from './events';

export async function publishEndpointEvents<
  T extends Endpoint<any, any, any, any, any, Logger, any, any>,
>(
  endpoint: T,
  response: EndpointOutput<T>,
  serviceDiscovery: ServiceDiscovery<any, any>,
) {
  try {
    if (!endpoint.events?.length) {
      endpoint.logger.debug('No events to publish');
      return;
    }

    if (!endpoint.publisherService) {
      endpoint.logger.warn('No publisher service available');
      return;
    }

    // Register the service and get the instance
    const services = await serviceDiscovery.register([
      endpoint.publisherService,
    ]);

    const publisher = services[
      endpoint.publisherService.serviceName
    ] as EventPublisher<any>;

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

      await publisher.publish(events).catch((err) => {
        endpoint.logger.error(err, 'Failed to publish events');
      });
    }
  } catch (error) {
    endpoint.logger.error(
      error as any,
      'Something went wrong publishing events',
    );
  }
}
