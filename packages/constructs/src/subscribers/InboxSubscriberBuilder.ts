/**
 * A subscriber bound to an inbox: a topic subscriber whose topic the inbox
 * declares and the provider publishes to, so it runs through the same adaptors
 * — Lambda, SNS push, a polled broker, a feature test.
 *
 * What it is delivered is a receipt notification; what its handler is handed
 * is the messages, parsed, one per envelope recipient the inbox receives at.
 * The inbox's own client does that, which is also why the handler can read
 * its inbox's raw messages without naming it in `.dependsOn`.
 *
 * **Loops.** Mail sent while the handler runs is marked
 * `Auto-Submitted: auto-replied`, and mail that arrives marked automatic is
 * dropped before the handler sees it (RFC 3834). Together they stop a reply
 * coming back to an inbox and being answered again — the app's own inboxes, or
 * someone's out-of-office. `.automated()` hands a handler that mail instead.
 * This is the handler every adaptor runs, so dev, tests and SES drop alike.
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
		private readonly acceptsAutomated = false,
	) {}

	/**
	 * Hands this handler mail marked `Auto-Submitted` too — auto-replies,
	 * out-of-office notices, bounces — which are otherwise dropped so a reply
	 * can never be answered by another. A handler that takes them should not
	 * reply to them.
	 */
	automated(): this {
		return new InboxSubscriberBuilder<any, any, any, any, any>(
			this.inner,
			this.inbox,
			true,
		) as this;
	}

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
		const acceptsAutomated = this.acceptsAutomated;

		// Every adaptor hands the handler `{ type, payload }` messages; each
		// payload here is a receipt notification, and the inbox's client turns
		// it into the messages for the recipients it receives at.
		const handler = async (ctx: Record<string, any>) => {
			const inbox = ctx.services[key] as InboxClient;
			const notifications = (ctx.events as unknown[]).filter(
				(event): event is { type: string; payload: ReceiptNotification } =>
					(event as { type?: string })?.type === INBOX_EVENT,
			);
			if (notifications.length === 0) return undefined;
			// emailkit is an optional peer: loaded here, by a worker that
			// receives mail, so a worker that never does still starts without it.
			// The `.catch` is what lets a bundler (esbuild, `gkm build`) leave a
			// missing emailkit to run time instead of failing the build — and it
			// is bundled in like any import wherever it is installed.
			const { autoReplying, isAutoSubmitted } = await import(
				'@geekmidas/emailkit/autoSubmitted'
			).catch((error: unknown) => {
				throw new InboxNeedsEmailkit(error);
			});
			const messages: InboxMessage[] = [];
			for (const { payload } of notifications) {
				for (const message of await inbox.messages(payload)) {
					if (!acceptsAutomated && isAutoSubmitted(message.headers)) {
						ctx.logger.debug(
							{
								recipient: message.recipient.address,
								autoSubmitted: message.headers['auto-submitted'],
							},
							'Dropped automatic mail: it is never answered',
						);
						continue;
					}
					messages.push(message);
				}
			}
			if (messages.length === 0) return undefined;
			return autoReplying(() =>
				fn({
					...ctx,
					messages,
					inbox,
				} as unknown as InboxSubscriberContext<TServices, TLogger, TDatabase>),
			);
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
			this.acceptsAutomated,
		);
	}
}

/** A worker received mail for an inbox, and `@geekmidas/emailkit` is not installed. */
export class InboxNeedsEmailkit extends Error {
	constructor(override readonly cause: unknown) {
		super(
			'A worker received mail for an inbox, and reading it needs ' +
				'@geekmidas/emailkit, which is not installed. Add it to the app that ' +
				'runs the worker: pnpm add @geekmidas/emailkit',
		);
		this.name = 'InboxNeedsEmailkit';
	}
}
