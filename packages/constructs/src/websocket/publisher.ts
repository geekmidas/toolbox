import type { StandardSchemaV1 } from '@standard-schema/spec';
import { FrameShape } from './frame';

/**
 * Where a publisher's frames go once they are encoded — the one thing a
 * runtime supplies to send to its sockets.
 *
 * On Node it is a `TransportSink`: each id's process, over Redis or memory.
 * On API Gateway it would be the management API's `postToConnection`; under
 * test, a recording. A payload is the frame already serialised, once, however
 * many ids it goes to. An id that is gone is dropped, not an error.
 */
export interface WebSocketSink {
	send(ids: readonly string[], payload: string): Promise<void>;
	/** Every open connection but `except`. */
	broadcast(payload: string, except?: readonly string[]): Promise<void>;
	close(ids: readonly string[], code: number, reason: string): Promise<void>;
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
 * A message is `{ action, data }`, the shape a client's frames arrive in —
 * or, where the surface names a `frame.discriminator`, flat: `{ [key]: action,
 * ...data }`.
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
		/** Where an encoded frame goes. */
		private readonly sink: WebSocketSink,
		/** The surface's declared messages, which every send is checked by. */
		private readonly declared?: { surface: string; messages: TMessages },
		/** How the surface writes a frame. Absent, `{ action, data }`. */
		private readonly frame: FrameShape = new FrameShape(
			declared?.surface ?? '',
		),
	) {}

	/** Send `action`'s message to each connection. */
	async send<TAction extends MessageAction<TMessages>>(
		ids: string | readonly string[],
		action: TAction,
		data: MessageData<TMessages, TAction>,
	): Promise<void> {
		const payload = await this.payload(action, data);
		await this.sink.send(listOf(ids), payload);
	}

	/** Send `action`'s message to every open connection, on every process. */
	async broadcast<TAction extends MessageAction<TMessages>>(
		action: TAction,
		data: MessageData<TMessages, TAction>,
		options: { except?: readonly string[] } = {},
	): Promise<void> {
		const payload = await this.payload(action, data);
		await this.sink.broadcast(
			payload,
			options.except?.length ? options.except : undefined,
		);
	}

	/** Close each connection, with a close code and reason its client sees. */
	async close(
		ids: string | readonly string[],
		code = 1000,
		reason = '',
	): Promise<void> {
		await this.sink.close(listOf(ids), code, reason);
	}

	/**
	 * The frame, checked by the action's schema where the surface declares
	 * its messages.
	 *
	 * @throws {UnknownWebSocketMessage}, {InvalidWebSocketMessage}, and for a
	 *   flat frame {WebSocketDataNotAnObject}, {WebSocketDataHasDiscriminator}
	 */
	private async payload(action: string, data: unknown): Promise<string> {
		if (!this.declared) return this.frame.encode(action, data);

		const { surface, messages } = this.declared;
		const schema = messages[action];
		if (!schema) {
			throw new UnknownWebSocketMessage(surface, action, Object.keys(messages));
		}
		const result = await schema['~standard'].validate(data);
		if (result.issues) {
			throw new InvalidWebSocketMessage(surface, action, result.issues);
		}
		return this.frame.encode(action, result.value);
	}
}

function listOf(ids: string | readonly string[]): readonly string[] {
	return typeof ids === 'string' ? [ids] : ids;
}
