import type { Logger } from '../logger';
import type { ServiceDiscovery } from '../services';
import type { Endpoint, EndpointOutput } from './Endpoint';
import type { EventPublisher } from './events';

export async function publishEndpointEvents<
  TLogger extends Logger,
  T extends Endpoint<any, any, any, any, any, TLogger, any, any>,
>(
  endpoint: T,
  response: EndpointOutput<T>,
  serviceDiscovery: ServiceDiscovery<any, any>,
  logger: Logger = endpoint.logger,
) {
  try {
    if (!endpoint.events?.length) {
      logger.debug('No events to publish');
      return;
    }

    if (!endpoint.publisherService) {
      logger.warn('No publisher service available');
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
      logger.debug({ eventCount: events.length }, 'Publishing events');

      await publisher.publish(events).catch((err) => {
        logger.error(err, 'Failed to publish events');
      });
    }
  } catch (error) {
    logger.error(error as any, 'Something went wrong publishing events');
  }
}
