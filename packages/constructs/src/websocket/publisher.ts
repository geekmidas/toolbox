import type { StandardSchemaV1 } from '@standard-schema/spec';
import {
	type Delivery,
	EVERY_INSTANCE,
	type WebSocketTransport,
} from './transport';

/** The instance a connection id was issued by: everything before its dot. */
export function instanceOf(connectionId: string): string | undefined {
	const dot = connectionId.indexOf('.');
	return dot > 0 ? connectionId.slice(0, dot) : undefined;
}

/**
 * What a surface sends its sockets, by action — `WebSocketApiConfig.messages`.
 */
export type WebSocketMessages = Record<string, StandardSchemaV1>;

/** A surface that declares no messages: any action, any data. */
export type NoMessages = Record<never, never>;

/** The actions a publisher sends: the declared ones, or any. */
export type MessageAction<TMessages extends WebSocketMessages> = [
	keyof TMessages,
] extends [never]
	? string
	: keyof TMessages & string;

/** What `action`'s data is, as its schema takes it. */
export type MessageData<
	TMessages extends WebSocketMessages,
	TAction extends string,
> = TAction extends keyof TMessages
	? StandardSchemaV1.InferInput<TMessages[TAction]>
	: unknown;

/** A message sent on an action the surface does not declare. */
export class UnknownWebSocketMessage extends Error {
	constructor(
		readonly surface: string,
		readonly action: string,
		readonly declared: readonly string[],
	) {
		super(
			`${surface} sends no '${action}' message. It declares ${declared
				.map((a) => `'${a}'`)
				.join(', ')} — send one of them, or add '${action}' to its messages.`,
		);
		this.name = 'UnknownWebSocketMessage';
	}
}

/** A message whose data its action's schema refused. */
export class InvalidWebSocketMessage extends Error {
	constructor(
		readonly surface: string,
		readonly action: string,
		readonly issues: readonly StandardSchemaV1.Issue[],
	) {
		super(
			`${surface}'s '${action}' message was refused by its schema: ${issues
				.map((issue) => issue.message)
				.join('; ')}. Nothing was sent.`,
		);
		this.name = 'InvalidWebSocketMessage';
	}
}

/**
 * How anything reaches a socket — `services.realtime` in an endpoint, and
 * `sockets` in a route of the surface itself.
 *
 * A message is `{ action, data }`, the shape a client's frames arrive in.
 * Where the surface declares its messages, `action` is one of them and
 * `data` is typed and checked by its schema before anything is sent; where it
 * declares none, any action and any JSON value go. A message is serialised
 * once, whatever the number of sockets it goes to. An id whose process has
 * gone is dropped silently, as API Gateway's `postToConnection` to a closed
 * connection is a no-op the sender rarely wants to handle.
 */
export class WebSocketPublisher<
	TMessages extends WebSocketMessages = NoMessages,
> {
	constructor(
		private readonly transport: WebSocketTransport,
		/**
		 * Delivers to this process's own sockets without a round trip through
		 * the transport — set on the server's own publisher.
		 */
		private readonly local?: {
			instance: string;
			deliver(delivery: Delivery): void;
		},
		/** The surface's declared messages, which every send is checked by. */
		private readonly declared?: { surface: string; messages: TMessages },
	) {}

	/** Send `action`'s message to each connection. */
	async send<TAction extends MessageAction<TMessages>>(
		ids: string | readonly string[],
		action: TAction,
		data: MessageData<TMessages, TAction>,
	): Promise<void> {
		const payload = await this.payload(action, data);
		await this.each(ids, (group) => ({ kind: 'send', ids: group, payload }));
	}

	/** Send `action`'s message to every open connection, on every process. */
	async broadcast<TAction extends MessageAction<TMessages>>(
		action: TAction,
		data: MessageData<TMessages, TAction>,
		options: { except?: readonly string[] } = {},
	): Promise<void> {
		const payload = await this.payload(action, data);
		await this.transport.publish(EVERY_INSTANCE, {
			kind: 'broadcast',
			payload,
			...(options.except?.length ? { except: options.except } : {}),
		});
	}

	/** Close each connection, with a close code and reason its client sees. */
	async close(
		ids: string | readonly string[],
		code = 1000,
		reason = '',
	): Promise<void> {
		await this.each(ids, (group) => ({
			kind: 'close',
			ids: group,
			code,
			reason,
		}));
	}

	/**
	 * The frame, checked by the action's schema where the surface declares
	 * its messages.
	 *
	 * @throws {UnknownWebSocketMessage}, {InvalidWebSocketMessage}
	 */
	private async payload(action: string, data: unknown): Promise<string> {
		if (!this.declared) return JSON.stringify({ action, data });

		const { surface, messages } = this.declared;
		const schema = messages[action];
		if (!schema) {
			throw new UnknownWebSocketMessage(surface, action, Object.keys(messages));
		}
		const result = await schema['~standard'].validate(data);
		if (result.issues) {
			throw new InvalidWebSocketMessage(surface, action, result.issues);
		}
		return JSON.stringify({ action, data: result.value });
	}

	/** One delivery per process that holds any of `ids`. */
	private async each(
		ids: string | readonly string[],
		delivery: (group: string[]) => Delivery,
	): Promise<void> {
		const byInstance = new Map<string, string[]>();
		for (const id of typeof ids === 'string' ? [ids] : ids) {
			const instance = instanceOf(id);
			if (!instance) continue;
			const group = byInstance.get(instance) ?? [];
			group.push(id);
			byInstance.set(instance, group);
		}

		await Promise.all(
			[...byInstance].map(([instance, group]) =>
				this.local?.instance === instance
					? this.local.deliver(delivery(group))
					: this.transport.publish(instance, delivery(group)),
			),
		);
	}
}
