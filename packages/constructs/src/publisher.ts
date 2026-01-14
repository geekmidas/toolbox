import type { AuditStorage } from '@geekmidas/audit';
import type { EventPublisher, MappedEvent } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service, ServiceDiscovery } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Construct } from './Construct';

export async function publishEvents<
	T extends EventPublisher<any> | undefined,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	TServiceName extends string = string,
	TPublisherService extends Service<TServiceName, T> | undefined = undefined,
>(
	logger: Logger,
	serviceDiscovery: ServiceDiscovery<any>,
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

export async function publishConstructEvents<
	T extends EventPublisher<any> | undefined,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	TServiceName extends string = string,
	TServices extends Service[] = [],
	TAuditStorageServiceName extends string = string,
	TAuditStorage extends AuditStorage | undefined = undefined,
>(
	construct: Construct<
		Logger,
		TServiceName,
		T,
		OutSchema,
		TServices,
		TAuditStorageServiceName,
		TAuditStorage
	>,
	response: InferStandardSchema<OutSchema>,
	serviceDiscovery: ServiceDiscovery<any>,
	logger: Logger = construct.logger,
) {
	return publishEvents(
		logger,
		serviceDiscovery,
		construct.events,
		response,
		construct.publisherService,
	);
}
