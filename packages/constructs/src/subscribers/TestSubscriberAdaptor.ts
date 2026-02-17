import { EnvironmentParser } from '@geekmidas/envkit';
import type {
	EventPublisher,
	ExtractPublisherMessage,
} from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service, ServiceRecord } from '@geekmidas/services';
import { ServiceDiscovery } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { publishEvents } from '../publisher';
import type { Subscriber } from './Subscriber';

// Helper type to extract payload types for subscribed events
type ExtractEventPayloads<
	TPublisher extends EventPublisher<any> | undefined,
	TEventTypes extends any[],
> = TPublisher extends EventPublisher<any>
	? Extract<ExtractPublisherMessage<TPublisher>, { type: TEventTypes[number] }>
	: never;

export class TestSubscriberAdaptor<
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	TEventPublisher extends EventPublisher<any> | undefined = undefined,
	TEventPublisherServiceName extends string = string,
	TSubscribedEvents extends
		ExtractPublisherMessage<TEventPublisher>['type'][] = ExtractPublisherMessage<TEventPublisher>['type'][],
> {
	static getDefaultServiceDiscovery() {
		return ServiceDiscovery.getInstance(new EnvironmentParser({}));
	}

	constructor(
		private readonly subscriber: Subscriber<
			TServices,
			TLogger,
			OutSchema,
			TEventPublisher,
			TEventPublisherServiceName,
			TSubscribedEvents
		>,
		private serviceDiscovery: ServiceDiscovery<any> = TestSubscriberAdaptor.getDefaultServiceDiscovery(),
	) {}

	async invoke(
		request: TestSubscriberRequest<
			TEventPublisher,
			TSubscribedEvents,
			TServices
		>,
	): Promise<InferStandardSchema<OutSchema>> {
		// Create logger with test context
		const logger = this.subscriber.logger.child({
			test: true,
		}) as TLogger;

		// Resolve services (use provided or auto-register)
		let services: ServiceRecord<TServices>;
		if (request.services) {
			services = request.services;
		} else {
			services = await this.serviceDiscovery.register(this.subscriber.services);
		}

		// Filter events to only subscribed types
		const filteredEvents = this.filterEvents(request.events);

		// Return early if no events after filtering (mirrors AWSLambdaSubscriber)
		if (filteredEvents.length === 0) {
			return { batchItemFailures: [] } as any;
		}

		// Execute the subscriber handler
		const result = await this.subscriber.handler({
			events: filteredEvents,
			services,
			logger,
		});

		// Validate output if schema is provided
		let output = result;
		if (this.subscriber.outputSchema && result) {
			const validationResult =
				await this.subscriber.outputSchema['~standard'].validate(result);

			if (validationResult.issues) {
				throw new Error('Subscriber output validation failed');
			}

			output = validationResult.value;
		}

		// Publish events if configured
		await publishEvents(
			logger,
			this.serviceDiscovery,
			this.subscriber.events,
			output,
			this.subscriber.publisherService,
		);

		return output;
	}

	private filterEvents(
		events: ExtractEventPayloads<TEventPublisher, TSubscribedEvents>[],
	): ExtractEventPayloads<TEventPublisher, TSubscribedEvents>[] {
		if (!this.subscriber.subscribedEvents) {
			return events;
		}

		return events.filter((event: any) =>
			this.subscriber.subscribedEvents!.includes(event.type),
		);
	}
}

export type TestSubscriberRequest<
	TEventPublisher extends EventPublisher<any> | undefined = undefined,
	TSubscribedEvents extends any[] = [],
	TServices extends Service[] = [],
> = {
	events: ExtractEventPayloads<TEventPublisher, TSubscribedEvents>[];
	services?: ServiceRecord<TServices>;
};
