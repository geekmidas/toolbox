/**
 * A subscriber bound to an inbox: a topic subscriber whose topic the inbox
 * declares and the provider publishes to, so it runs through the same adaptors
 * — Lambda, SNS push, a polled broker, a feature test.
 *
 * What it is delivered is a receipt notification; what its handler is handed
 * is the messages, parsed, one per envelope recipient the inbox receives at.
 * The inbox's own client does that, which is also why the handler can read
 * its inbox's raw messages without naming it in `.dependsOn`.
 */

import type { EventPublisher } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import { INBOX_EVENT, serviceKey } from '@geekmidas/manifest';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service, ServiceRecord } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Consumable, ServicesOf } from '../construct-interface';
import type { DatabaseContext } from '../functions/Function';
import type {
	Inbox,
	InboxClient,
	InboxMessage,
	ReceiptNotification,
} from '../inbox';
import type { Subscriber } from './Subscriber';
import type { SubscriberBuilder } from './SubscriberBuilder';

export type InboxSubscriber<
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	TDatabase = undefined,
	TDatabaseServiceName extends string = string,
> = Subscriber<
	TServices,
	TLogger,
	OutSchema,
	EventPublisher<{ type: typeof INBOX_EVENT; payload: ReceiptNotification }>,
	[typeof INBOX_EVENT],
	TDatabase,
	TDatabaseServiceName
>;

export type InboxSubscriberContext<
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	TDatabase = undefined,
> = {
	/** The messages received, one per envelope recipient the inbox takes. */
	messages: InboxMessage[];
	/** The inbox, under its own id too: its domain and its raw messages. */
	inbox: InboxClient;
	services: ServiceRecord<TServices>;
	logger: TLogger;
} & DatabaseContext<TDatabase>;

export type InboxSubscriberHandler<
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	TDatabase = undefined,
> = (
	ctx: InboxSubscriberContext<TServices, TLogger, TDatabase>,
) => OutSchema extends StandardSchemaV1
	? InferStandardSchema<OutSchema> | Promise<InferStandardSchema<OutSchema>>
	: any | Promise<any>;

export class InboxSubscriberBuilder<
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	TDatabase = undefined,
	TDatabaseServiceName extends string = string,
> {
	constructor(
		private readonly inner: SubscriberBuilder<
			any,
			any,
			any,
			any,
			any,
			any,
			any
		>,
		private readonly inbox: Inbox<string>,
	) {}

	dependsOn<const T extends readonly Consumable[]>(
		constructs: T,
	): InboxSubscriberBuilder<
		[...TServices, ...ServicesOf<T>],
		TLogger,
		OutSchema,
		TDatabase,
		TDatabaseServiceName
	> {
		return this.with(this.inner.dependsOn(constructs));
	}

	services<T extends Service[]>(
		services: T,
	): InboxSubscriberBuilder<
		[...TServices, ...T],
		TLogger,
		OutSchema,
		TDatabase,
		TDatabaseServiceName
	> {
		return this.with(this.inner.services(services));
	}

	database<T, TDbName extends string>(
		source: Consumable<TDbName, T> | Service<TDbName, T>,
	): InboxSubscriberBuilder<TServices, TLogger, OutSchema, T, TDbName> {
		return this.with(this.inner.database(source));
	}

	timeout(timeout: number): this {
		return this.with(this.inner.timeout(timeout)) as this;
	}

	output<T extends StandardSchemaV1>(
		schema: T,
	): InboxSubscriberBuilder<
		TServices,
		TLogger,
		T,
		TDatabase,
		TDatabaseServiceName
	> {
		return this.with(this.inner.output(schema));
	}

	logger<T extends Logger>(
		logger: T,
	): InboxSubscriberBuilder<
		TServices,
		T,
		OutSchema,
		TDatabase,
		TDatabaseServiceName
	> {
		return this.with(this.inner.logger(logger));
	}

	handle(
		fn: InboxSubscriberHandler<TServices, TLogger, OutSchema, TDatabase>,
	): InboxSubscriber<
		TServices,
		TLogger,
		OutSchema,
		TDatabase,
		TDatabaseServiceName
	> {
		const key = serviceKey(this.inbox.id);

		// Every adaptor hands the handler `{ type, payload }` messages; each
		// payload here is a receipt notification, and the inbox's client turns
		// it into the messages for the recipients it receives at.
		const handler = async (ctx: Record<string, any>) => {
			const inbox = ctx.services[key] as InboxClient;
			const notifications = (ctx.events as unknown[]).filter(
				(event): event is { type: string; payload: ReceiptNotification } =>
					(event as { type?: string })?.type === INBOX_EVENT,
			);
			const messages: InboxMessage[] = [];
			for (const { payload } of notifications) {
				messages.push(...(await inbox.messages(payload)));
			}
			if (messages.length === 0) return undefined;
			return fn({
				...ctx,
				messages,
				inbox,
			} as unknown as InboxSubscriberContext<TServices, TLogger, TDatabase>);
		};

		const subscriber = this.inner
			.subscribe([INBOX_EVENT] as never)
			.handle(handler as never) as unknown as InboxSubscriber<
			TServices,
			TLogger,
			OutSchema,
			TDatabase,
			TDatabaseServiceName
		>;
		subscriber.inboxName = this.inbox.id;
		subscriber.inboxAddressing = this.inbox.addressing;
		return subscriber;
	}

	private with(inner: SubscriberBuilder<any, any, any, any, any, any, any>) {
		return new InboxSubscriberBuilder<any, any, any, any, any>(
			inner,
			this.inbox,
		);
	}
}
