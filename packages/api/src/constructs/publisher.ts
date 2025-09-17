import type { ServiceDiscovery } from '../services';
import type { Endpoint, EndpointOutput } from './Endpoint';

export async function publishEndpointEvents<
  T extends Endpoint<any, any, any, any, any, any, any, any>,
>(
  endpoint: T,
  response: EndpointOutput<T>,
  serviceDiscovery?: ServiceDiscovery<any, any>,
) {
  if (!endpoint.events?.length) {
    endpoint.logger.debug('No events to publish');
    return;
  }

  if (!endpoint.publisherService) {
    endpoint.logger.warn('No publisher service available');
    return;
  }

  if (!serviceDiscovery) {
    endpoint.logger.warn(
      'No service discovery available for publisher resolution',
    );
    return;
  }

  let publisher: any;
  try {
    // Check if the service is already registered
    if (serviceDiscovery.has(endpoint.publisherService.serviceName)) {
      publisher = await serviceDiscovery.get(
        endpoint.publisherService.serviceName,
      );
    } else {
      // Register the service and get the instance
      const services = await serviceDiscovery.register([
        endpoint.publisherService,
      ]);
      publisher = services[endpoint.publisherService.serviceName];
    }
  } catch (error) {
    endpoint.logger.error({ error }, 'Failed to resolve publisher service');
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

    await publisher.publish(events).catch((err: any) => {
      endpoint.logger.error({ err }, 'Failed to publish events');
    });
  }
}
