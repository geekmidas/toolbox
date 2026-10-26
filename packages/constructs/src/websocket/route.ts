import type { Logger } from '@geekmidas/logger';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service, ServiceRecord } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import {
	type Consumable,
	idsOf,
	type ServicesOf,
	servicesOf,
} from '../construct-interface';
import type {
	NoMessages,
	WebSocketMessages,
	WebSocketPublisher,
} from './publisher';

/** One open connection, as a handler sees it. */
export interface Connection {
	readonly id: string;
	/**
	 * What the connect handler returned — who the connection is for, the room
	 * it joined. `{}` when it returned nothing.
	 */
	readonly data: Record<string, unknown>;
}

interface BaseContext<
	TServices extends Service[],
	TMessages extends WebSocketMessages,
> {
	services: ServiceRecord<TServices>;
	logger: Logger;
	/** Every socket this surface holds, on whichever process holds it. */
	sockets: WebSocketPublisher<TMessages>;
}

export interface ConnectContext<
	TServices extends Service[],
	TMessages extends WebSocketMessages = NoMessages,
> extends BaseContext<TServices, TMessages> {
	connectionId: string;
	headers: Headers;
	query: URLSearchParams;
	/**
	 * Whose connection it is, from the surface's `.auth()` — `null` when the
	 * upgrade carried no session, and when the surface names no authenticator.
	 * Throw an `UnauthorizedError` to refuse it.
	 */
	session: unknown;
}

export interface MessageContext<
	TBody,
	TServices extends Service[],
	TMessages extends WebSocketMessages = NoMessages,
> extends BaseContext<TServices, TMessages> {
	connection: Connection;
	body: TBody;
	/** Send to this connection alone. */
	reply(message: unknown): void;
}

export interface DisconnectContext<
	TServices extends Service[],
	TMessages extends WebSocketMessages = NoMessages,
> extends BaseContext<TServices, TMessages> {
	connection: Connection;
	code: number;
	reason: string;
}

/** What a frame is dispatched on: an action, or the connection's lifecycle. */
export type RouteKind = 'connect' | 'disconnect' | 'message';

/**
 * A handler bound to a WebSocket surface — what `realtime.route('chat.send')
 * …handle()` returns, and what a file exports.
 *
 * Carries `surface` and `constructs` the way an endpoint does, so discovery
 * records what its process reaches without knowing what a route is.
 */
export class WebSocketRoute {
	readonly __IS_WEBSOCKET_ROUTE__ = true;

	static isRoute(value: unknown): value is WebSocketRoute {
		return Boolean(
			value &&
				(value as { __IS_WEBSOCKET_ROUTE__?: unknown })
					.__IS_WEBSOCKET_ROUTE__ === true,
		);
	}

	constructor(
		readonly kind: RouteKind,
		/** The `action` it answers; `$connect` and `$disconnect` for the lifecycle. */
		readonly action: string,
		readonly surface: { id: string },
		readonly services: readonly Service[],
		/** Construct ids it depends on — its edges in the manifest. */
		readonly constructs: readonly string[],
		readonly handler: (context: never) => unknown,
		readonly schema?: StandardSchemaV1,
	) {}
}

/** The builder `connect()`, `disconnect()` and `route()` start. */
export class WebSocketRouteBuilder<
	TKind extends RouteKind,
	TSchema extends StandardSchemaV1 | undefined = undefined,
	TServices extends Service[] = [],
	/** The surface's declared messages, which `sockets` sends. */
	TMessages extends WebSocketMessages = NoMessages,
> {
	constructor(
		private readonly kind: TKind,
		private readonly action: string,
		private readonly surface: { id: string },
		private readonly _services: readonly Service[] = [],
		private readonly _constructs: readonly string[] = [],
		private readonly schema?: TSchema,
	) {}

	/** The schema a frame's `data` must satisfy before the handler runs. */
	body<S extends StandardSchemaV1>(
		schema: S,
	): WebSocketRouteBuilder<TKind, S, TServices, TMessages> {
		return new WebSocketRouteBuilder(
			this.kind,
			this.action,
			this.surface,
			this._services,
			this._constructs,
			schema,
		);
	}

	/** What the handler reaches, as `services.<id>` — per route, as an endpoint's. */
	dependsOn<const T extends readonly Consumable[]>(
		constructs: T,
	): WebSocketRouteBuilder<
		TKind,
		TSchema,
		[...TServices, ...(ServicesOf<T> extends Service[] ? ServicesOf<T> : [])],
		TMessages
	> {
		return new WebSocketRouteBuilder(
			this.kind,
			this.action,
			this.surface,
			[...this._services, ...(servicesOf(constructs) as Service[])],
			idsOf(constructs, this._constructs),
			this.schema,
		) as never;
	}

	/**
	 * The handler. A message handler's return value, when there is one, is
	 * sent back to the connection as the reply to that frame; a connect
	 * handler's is kept as the connection's `data`.
	 */
	handle(
		handler: TKind extends 'connect'
			? (
					context: ConnectContext<TServices, TMessages>,
				) =>
					| Record<string, unknown>
					| undefined
					| Promise<Record<string, unknown> | undefined>
			: TKind extends 'disconnect'
				? (context: DisconnectContext<TServices, TMessages>) => unknown
				: (
						context: MessageContext<
							TSchema extends StandardSchemaV1
								? InferStandardSchema<TSchema>
								: unknown,
							TServices,
							TMessages
						>,
					) => unknown,
	): WebSocketRoute {
		return new WebSocketRoute(
			this.kind,
			this.action,
			this.surface,
			this._services,
			this._constructs,
			handler as (context: never) => unknown,
			this.schema,
		);
	}
}
