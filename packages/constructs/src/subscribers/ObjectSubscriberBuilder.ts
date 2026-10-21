import type { EventPublisher } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service, ServiceRecord } from '@geekmidas/services';
import type {
	ObjectEvent,
	ObjectEventType,
	ObjectFilter,
	ObjectMessage,
} from '@geekmidas/storage/events';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Consumable, ServicesOf } from '../construct-interface';
import type { DatabaseContext } from '../functions/Function';
import type { Subscriber } from './Subscriber';
import type { SubscriberBuilder } from './SubscriberBuilder';

/**
 * A subscriber bound to a bucket: a topic subscriber whose topic is the
 * storage itself, so it runs through the same adaptors — Lambda, SNS push,
 * a polled broker, a feature test.
 */
export type ObjectSubscriber<
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	TEvents extends ObjectEventType[] = ObjectEventType[],
	TDatabase = undefined,
	TDatabaseServiceName extends string = string,
> = Subscriber<
	TServices,
	TLogger,
	OutSchema,
	EventPublisher<ObjectMessage>,
	TEvents,
	TDatabase,
	TDatabaseServiceName
>;

/** What a bucket's subscriber is handed: the objects, and how each changed. */
export type ObjectSubscriberContext<
	TEvents extends ObjectEventType[],
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	TDatabase = undefined,
> = {
	/** Each object that changed, in the order the storage reported them. */
	objects: ObjectEvent[];
	/** The same objects with what happened to each — for a handler of both. */
	events: ObjectMessage<TEvents[number]>[];
	services: ServiceRecord<TServices>;
	logger: TLogger;
} & DatabaseContext<TDatabase>;

export type ObjectSubscriberHandler<
	TEvents extends ObjectEventType[],
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	TDatabase = undefined,
> = (
	ctx: ObjectSubscriberContext<TEvents, TServices, TLogger, TDatabase>,
) => OutSchema extends StandardSchemaV1
	? InferStandardSchema<OutSchema> | Promise<InferStandardSchema<OutSchema>>
	: any | Promise<any>;

/** `.on()` was given no event to react to. */
export class ObjectSubscriberHasNoEvents extends Error {
	constructor(readonly bucket: string) {
		super(
			`A subscriber bound to '${bucket}' names no event. Name what it reacts ` +
				`to: .on(['object.created']), .on(['object.deleted']), or both.`,
		);
		this.name = 'ObjectSubscriberHasNoEvents';
	}
}

/**
 * A subscriber to a bucket's objects, from `worker.objects(bucket)`.
 *
 * Built on the topic subscriber's builder, which it wraps rather than
 * extends: the services, database, owner and edges are configured exactly as
 * a topic subscriber's, and only the trigger differs — the storage, filtered
 * by event and key.
 */
export class ObjectSubscriberBuilder<
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	TEvents extends ObjectEventType[] = [],
	TDatabase = undefined,
	TDatabaseServiceName extends string = string,
> {
	constructor(
		/** The topic subscriber's builder, already owned by its worker. */
		private readonly inner: SubscriberBuilder<
			any,
			any,
			any,
			any,
			any,
			any,
			any
		>,
		/** The bucket's id — what the build binds the subscriber to. */
		private readonly bucket: string,
		private readonly events: readonly ObjectEventType[] = [],
		private readonly filter: ObjectFilter = {},
	) {}

	/**
	 * What it reacts to: the events, and — optionally — only keys under a
	 * prefix and ending in a suffix. Repeatable; the last filter wins.
	 */
	on<const T extends ObjectEventType[]>(
		events: T,
		filter: ObjectFilter = {},
	): ObjectSubscriberBuilder<
		TServices,
		TLogger,
		OutSchema,
		[...TEvents, ...T],
		TDatabase,
		TDatabaseServiceName
	> {
		return new ObjectSubscriberBuilder(
			this.inner,
			this.bucket,
			[...new Set([...this.events, ...events])],
			{
				...(filter.prefix ? { prefix: filter.prefix } : {}),
				...(filter.suffix ? { suffix: filter.suffix } : {}),
			},
		);
	}

	/** See {@link SubscriberBuilder.dependsOn}. */
	dependsOn<const T extends readonly Consumable[]>(
		constructs: T,
	): ObjectSubscriberBuilder<
		[...TServices, ...ServicesOf<T>],
		TLogger,
		OutSchema,
		TEvents,
		TDatabase,
		TDatabaseServiceName
	> {
		return this.with(this.inner.dependsOn(constructs));
	}

	services<T extends Service[]>(
		services: T,
	): ObjectSubscriberBuilder<
		[...TServices, ...T],
		TLogger,
		OutSchema,
		TEvents,
		TDatabase,
		TDatabaseServiceName
	> {
		return this.with(this.inner.services(services));
	}

	/** See {@link SubscriberBuilder.database}. */
	database<T, TDbName extends string>(
		source: Consumable<TDbName, T> | Service<TDbName, T>,
	): ObjectSubscriberBuilder<
		TServices,
		TLogger,
		OutSchema,
		TEvents,
		T,
		TDbName
	> {
		return this.with(this.inner.database(source));
	}

	timeout(timeout: number): this {
		return this.with(this.inner.timeout(timeout)) as this;
	}

	output<T extends StandardSchemaV1>(
		schema: T,
	): ObjectSubscriberBuilder<
		TServices,
		TLogger,
		T,
		TEvents,
		TDatabase,
		TDatabaseServiceName
	> {
		return this.with(this.inner.output(schema));
	}

	logger<T extends Logger>(
		logger: T,
	): ObjectSubscriberBuilder<
		TServices,
		T,
		OutSchema,
		TEvents,
		TDatabase,
		TDatabaseServiceName
	> {
		return this.with(this.inner.logger(logger));
	}

	handle(
		fn: ObjectSubscriberHandler<
			TEvents,
			TServices,
			TLogger,
			OutSchema,
			TDatabase
		>,
	): ObjectSubscriber<
		TServices,
		TLogger,
		OutSchema,
		TEvents,
		TDatabase,
		TDatabaseServiceName
	> {
		if (this.events.length === 0) {
			throw new ObjectSubscriberHasNoEvents(this.bucket);
		}
		const events = [...this.events];
		const filter = this.filter;

		// Every adaptor hands the handler `events` as `{ type, payload }`
		// messages; this narrows them to the ones this subscriber wants — the
		// adaptor's word is final on the key, whatever filtered at the source
		// — and hands over the objects.
		const handler = async (ctx: Record<string, any>) => {
			const { matchesObjectFilter } = await import('@geekmidas/storage/events');
			const wanted = (ctx.events as unknown[]).filter(
				(event): event is ObjectMessage =>
					isObjectMessage(event) &&
					events.includes(event.type) &&
					matchesObjectFilter(event.payload, filter),
			);
			if (wanted.length === 0) return undefined;
			return fn({
				...ctx,
				events: wanted,
				objects: wanted.map((event) => event.payload),
			} as unknown as ObjectSubscriberContext<
				TEvents,
				TServices,
				TLogger,
				TDatabase
			>);
		};

		const subscriber = this.inner
			.subscribe(events as never)
			.handle(handler as never) as unknown as ObjectSubscriber<
			TServices,
			TLogger,
			OutSchema,
			TEvents,
			TDatabase,
			TDatabaseServiceName
		>;
		subscriber.bucketName = this.bucket;
		subscriber.objectFilter = filter;
		return subscriber;
	}

	private with(inner: SubscriberBuilder<any, any, any, any, any, any, any>) {
		return new ObjectSubscriberBuilder<any, any, any, any, any, any>(
			inner,
			this.bucket,
			this.events,
			this.filter,
		);
	}
}

function isObjectMessage(value: unknown): value is ObjectMessage {
	const message = value as ObjectMessage | undefined;
	return (
		typeof message === 'object' &&
		message !== null &&
		(message.type === 'object.created' || message.type === 'object.deleted') &&
		typeof message.payload?.key === 'string'
	);
}
