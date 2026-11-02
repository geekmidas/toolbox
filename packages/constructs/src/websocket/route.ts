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
import {
	requestConnect,
	requestDisconnect,
	requestMessage,
	type TestConnectRequest,
	type TestDisconnectRequest,
	type TestMessageRequest,
	type TestMessageResponse,
	type TestWebSocketPublisher,
	type WebSocketTestSurface,
} from './testing';

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
export class WebSocketRoute<
	TKind extends RouteKind = RouteKind,
	TSchema extends StandardSchemaV1 | undefined = StandardSchemaV1 | undefined,
	TServices extends Service[] = Service[],
	/** What the handler returns. */
	TReturn = unknown,
	TMessages extends WebSocketMessages = WebSocketMessages,
> {
	readonly __IS_WEBSOCKET_ROUTE__ = true;

	static isRoute(value: unknown): value is WebSocketRoute {
		return Boolean(
			value &&
				(value as { __IS_WEBSOCKET_ROUTE__?: unknown })
					.__IS_WEBSOCKET_ROUTE__ === true,
		);
	}

	constructor(
		readonly kind: TKind,
		/** The `action` it answers; `$connect` and `$disconnect` for the lifecycle. */
		readonly action: string,
		/** The surface it was built from — what `request()` builds a core on. */
		readonly surface: WebSocketTestSurface,
		readonly services: readonly Service[],
		/** Construct ids it depends on — its edges in the manifest. */
		readonly constructs: readonly string[],
		readonly handler: (context: never) => unknown,
		readonly schema?: TSchema,
	) {}

	/**
	 * Run the handler as its surface would, with no server and no socket —
	 * as `endpoint.request()` runs an endpoint.
	 *
	 * - `connect`: resolves with the connection's `data`, or rejects with what
	 *   refused it (an `UnauthorizedError` stays a 401).
	 * - a message route: `body` is encoded as a frame and checked by the
	 *   route's schema; resolves with the handler's return, or rejects with
	 *   what it threw or an `InvalidWebSocketRequest`.
	 * - `disconnect`: resolves once the handler has run, or rejects with what
	 *   it threw.
	 */
	request(
		...[request]: RequestArgs<TKind, TSchema, TServices, TMessages>
	): Promise<WebSocketRouteResult<TKind, TReturn>> {
		const route = this as AnyRoute;
		const given = (request ?? {}) as TestConnectRequest & TestDisconnectRequest;
		if (this.kind === 'connect') {
			return requestConnect(route, this.surface, given) as never;
		}
		if (this.kind === 'disconnect') {
			return requestDisconnect(route, this.surface, given) as never;
		}
		return requestMessage(
			route,
			this.surface,
			given as unknown as TestMessageRequest,
		).then(({ returned }) => returned) as never;
	}

	/**
	 * A message route's `request()`, with every frame it wrote back to the
	 * connection — each `reply()` and the reply itself — beside its return.
	 */
	fullRequest(
		this: WebSocketRoute<'message', TSchema, TServices, TReturn, TMessages>,
		request: WebSocketRouteRequest<'message', TSchema, TServices, TMessages>,
	): Promise<TestMessageResponse<Awaited<TReturn>>> {
		return requestMessage(
			this as AnyRoute,
			this.surface,
			request as unknown as TestMessageRequest,
		) as Promise<TestMessageResponse<Awaited<TReturn>>>;
	}
}

type AnyRoute = WebSocketRoute<any, any, any, any, any>;

/** A message route needs a body; the lifecycle's request may be left out. */
type RequestArgs<
	TKind extends RouteKind,
	TSchema extends StandardSchemaV1 | undefined,
	TServices extends Service[],
	TMessages extends WebSocketMessages,
> = TKind extends 'message'
	? [request: WebSocketRouteRequest<TKind, TSchema, TServices, TMessages>]
	: [request?: WebSocketRouteRequest<TKind, TSchema, TServices, TMessages>];

/** What `request()` takes for each kind of route. */
export type WebSocketRouteRequest<
	TKind extends RouteKind,
	TSchema extends StandardSchemaV1 | undefined,
	TServices extends Service[],
	TMessages extends WebSocketMessages,
> = TestCallOverrides<TServices, TMessages> &
	(TKind extends 'connect'
		? Omit<TestConnectRequest, 'services' | 'sockets'>
		: TKind extends 'disconnect'
			? Omit<TestDisconnectRequest, 'services' | 'sockets'>
			: Omit<
					TestMessageRequest<
						TSchema extends StandardSchemaV1
							? StandardSchemaV1.InferInput<TSchema>
							: unknown
					>,
					'services' | 'sockets'
				>);

/** `services` typed by what the route depends on; `sockets` by the surface. */
export interface TestCallOverrides<
	TServices extends Service[],
	TMessages extends WebSocketMessages,
> {
	/**
	 * Instances for the route's dependencies — a test's transaction for
	 * `database`. Any it depends on and is not handed here is registered.
	 */
	services?: Partial<ServiceRecord<TServices>>;
	/** The handler's `sockets` — `surface.testPublisher()` to assert on. */
	sockets?: TestWebSocketPublisher<TMessages>;
}

/** What `request()` resolves with for each kind of route. */
export type WebSocketRouteResult<
	TKind extends RouteKind,
	TReturn,
> = TKind extends 'connect'
	? ConnectData<Awaited<TReturn>>
	: TKind extends 'disconnect'
		? undefined
		: Awaited<TReturn>;

/** A connect handler's return as the connection keeps it: `{}` for nothing. */
type ConnectData<T> = T extends undefined ? {} : T;

/** What a handler may return, by kind: connect's becomes `data`. */
type HandlerReturn<TKind extends RouteKind> = TKind extends 'connect'
	?
			| Record<string, unknown>
			| undefined
			| Promise<Record<string, unknown> | undefined>
	: unknown;

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
		private readonly surface: WebSocketTestSurface,
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
		[...TServices, ...ServicesOf<T>],
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
	handle<TReturn extends HandlerReturn<TKind>>(
		handler: TKind extends 'connect'
			? (context: ConnectContext<TServices, TMessages>) => TReturn
			: TKind extends 'disconnect'
				? (context: DisconnectContext<TServices, TMessages>) => TReturn
				: (
						context: MessageContext<
							TSchema extends StandardSchemaV1
								? InferStandardSchema<TSchema>
								: unknown,
							TServices,
							TMessages
						>,
					) => TReturn,
	): WebSocketRoute<TKind, TSchema, TServices, TReturn, TMessages> {
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
