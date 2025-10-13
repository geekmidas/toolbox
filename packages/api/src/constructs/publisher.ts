import type { Logger } from '@geekmidas/logger';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Service, ServiceDiscovery } from '../services';
import type { Endpoint, EndpointOutput } from './Endpoint';

import type { EventPublisher, MappedEvent } from '@geekmidas/events';
import type { InferStandardSchema } from './types';

export async function publishEvents<
  T extends EventPublisher<any> | undefined,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TServiceName extends string = string,
  TPublisherService extends Service<TServiceName, T> | undefined = undefined,
>(
  logger: Logger,
  serviceDiscovery: ServiceDiscovery<any, any>,
  ev: MappedEvent<T, OutSchema>[] = [],
  response: InferStandardSchema<OutSchema>,
  publisherService: TPublisherService,
) {
  try {
    if (!ev?.length) {
      logger.debug('No events to publish');
      return;
    }
    if (!publisherService) {
      logger.warn('No publisher service available');
      return;
    }

    const services = await serviceDiscovery.register([publisherService]);

    const publisher = services[
      publisherService.serviceName
    ] as EventPublisher<any>;

    const events: MappedEvent<T, OutSchema>[] = [];

    for (const { when, payload, type, ...e } of ev) {
      logger.debug({ event: type }, 'Processing event');
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
      logger.debug({ eventCount: ev.length }, 'Publishing events');

      await publisher.publish(events).catch((err) => {
        logger.error(err, 'Failed to publish events');
      });
    }
  } catch (error) {
    logger.error(error as any, 'Something went wrong publishing events');
  }
}

export async function publishEndpointEvents<
  TLogger extends Logger,
  T extends Endpoint<any, any, any, any, any, TLogger, any, any>,
>(
  endpoint: T,
  response: EndpointOutput<T>,
  serviceDiscovery: ServiceDiscovery<any, any>,
  logger: Logger = endpoint.logger,
) {
  return publishEvents(
    logger,
    serviceDiscovery,
    endpoint.events,
    response,
    endpoint.publisherService,
  );
}
