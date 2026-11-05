/**
 * `WebSocketApi` — a surface that holds long-lived connections.
 *
 * A process of its own, like a `RestApi`: it owns an address, its routes are
 * built from it, and they run in its container and nowhere else. A frame is
 * routed on its `action` — `{ "action": "chat.send", "data": … }`, API
 * Gateway's shape — and the connection's lifecycle on `$connect` and
 * `$disconnect`. A surface whose clients already parse flat frames names the
 * key the action lives in instead — `frame: { discriminator: 'type' }` reads
 * and writes `{ "type": "chat.send", …data }`.
 *
 * Anything else reaches a socket through the surface's publisher:
 * `.dependsOn([realtime])` puts `services.realtime` in an endpoint, a cron or
 * a subscriber, and whichever replica holds the socket delivers. What it
 * sends is declared in `messages`, which the publisher is typed by.
 *
 * ```ts
 * export const realtime = new WebSocketApi('Realtime', {
 *   path: 'apps/realtime',
 *   messages: { 'chat.sent': z.object({ text: z.string() }) },
 *   logger,
 * });
 *
 * export const send = realtime
 *   .route('chat.send')
 *   .body(z.object({ text: z.string() }))
 *   .handle(async ({ body, sockets }) => sockets.broadcast('chat.sent', body));
 * ```
 */

import type { Server } from 'node:http';
import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { DEFAULT_LOGGER } from '@geekmidas/logger/console';
import {
	API_GATEWAY_WEBSOCKET_SCHEME,
	type ConstructName,
	canonicalId,
	type Declaration,
	providedKeyFor,
	serviceKey,
	type WebSocketEdgeLimits,
} from '@geekmidas/manifest';
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import type { Hono } from 'hono';
import {
	type Authenticator,
	type Declarable,
	edgeTo,
} from './construct-interface';
import { envParserFor } from './endpoints/surfaceEnv';
import { loadHono } from './optionalPeers';
import { onShutdown } from './shutdown';
import type { Telemetry } from './telemetry';
import { WebSocketCore } from './websocket/core';
import {
	UnregisteredWebSocketScheme,
	webSocketSinkDriverFor,
} from './websocket/drivers';
import { FrameShape, type WebSocketFrame } from './websocket/frame';
import {
	type ResolvedWebSocketLimits,
	resolveLimits,
	type WebSocketLimits,
} from './websocket/limits';
import {
	type NoMessages,
	type WebSocketMessages,
	WebSocketPublisher,
	type WebSocketSink,
} from './websocket/publisher';
import { WebSocketRoute, WebSocketRouteBuilder } from './websocket/route';
import { WebSocketSurfaceServer } from './websocket/server';
import { TestWebSocketPublisher } from './websocket/testing';
import {
	TransportSink,
	transportFromConnectionString,
} from './websocket/transport';

export {
	type ConnectOutcome,
	type ConnectRequest,
	type DisconnectOutcome,
	DuplicateWebSocketRoute,
	type MessageOutcome,
	type WebSocketCallOptions,
	WebSocketCore,
	type WebSocketCoreOptions,
	type WriteFrame,
} from './websocket/core';
export {
	registerWebSocketSinkDriver,
	UnregisteredWebSocketScheme,
	type WebSocketSinkDriver,
} from './websocket/drivers';
export {
	WebSocketDataHasDiscriminator,
	WebSocketDataNotAnObject,
	type WebSocketFrame,
	WebSocketMessageDeclaresDiscriminator,
	WebSocketMessageNotAnObject,
} from './websocket/frame';
export {
	DEFAULT_WEBSOCKET_LIMITS,
	InvalidWebSocketLimit,
	LIMIT_CLOSE,
	MemoryLimitStore,
	RedisLimitStore,
	type ResolvedWebSocketLimits,
	resolveLimits,
	TokenBucket,
	type WebSocketLimitStore,
	type WebSocketLimits,
} from './websocket/limits';
export {
	InvalidWebSocketMessage,
	type MessageAction,
	type MessageData,
	type NoMessages,
	UnknownWebSocketMessage,
	type WebSocketMessages,
	WebSocketPublisher,
	type WebSocketSink,
} from './websocket/publisher';
export type {
	ConnectContext,
	Connection,
	DisconnectContext,
	MessageContext,
	RouteKind,
	TestCallOverrides,
	WebSocketRouteRequest,
	WebSocketRouteResult,
} from './websocket/route';
export { WebSocketRoute, WebSocketRouteBuilder } from './websocket/route';
export {
	CLOSE,
	type WebSocketServerOptions,
	WebSocketSurfaceServer,
} from './websocket/server';
export {
	InvalidWebSocketRequest,
	type RecordedBroadcast,
	type RecordedClose,
	type RecordedMessage,
	type RecordedSend,
	RecordingSink,
	type TestConnection,
	type TestConnectRequest,
	type TestDisconnectRequest,
	type TestMessageRequest,
	type TestMessageResponse,
	TestWebSocketPublisher,
	type WebSocketTestSurface,
} from './websocket/testing';
export {
	type Delivery,
	MemoryTransport,
	RedisTransport,
	TransportSink,
	transportFromConnectionString,
	UnsupportedWebSocketTransport,
	type WebSocketTransport,
} from './websocket/transport';

export interface WebSocketApiConfig<
	TMessages extends WebSocketMessages = NoMessages,
> {
	/** The app that serves it, relative to the workspace root. */
	path: string;
	/**
	 * What it sends its sockets, by action — each with the schema its `data`
	 * is checked by before it is sent.
	 *
	 * ```ts
	 * messages: {
	 *   announcement: z.object({ text: z.string() }),
	 *   'chat.said': z.object({ from: z.string(), text: z.string() }),
	 * }
	 * ```
	 *
	 * The publisher is typed by it — `services.realtime.broadcast(
	 * 'announcement', { text })` — in an endpoint and in a route's `sockets`
	 * alike. Absent, any action and any data go, unchecked.
	 */
	messages?: TMessages;
	/**
	 * The shape its frames take. Absent, `{ "action": …, "id"?: …, "data": … }`.
	 *
	 * With a `discriminator`, frames are flat — the action under that key and
	 * the data's fields beside it, both ways, `$error` replies included:
	 *
	 * ```ts
	 * frame: { discriminator: 'type' },
	 * // realtime.send(ids, 'chat.message.created', { chatId, message })
	 * // wire: {"type":"chat.message.created","chatId":"…","message":{…}}
	 * ```
	 *
	 * Every message must then be an object schema that has no field of that
	 * name; one that is not is refused when the surface is built. A flat frame
	 * carries no `id`: every other field is the data.
	 */
	frame?: WebSocketFrame;
	/** The label it answers on. Absent, its id kebab-cased. */
	subdomain?: string;
	/** How many processes serve it on one machine. Default 1. */
	replicas?: number;
	logger?: Logger;
	envParser?: EnvironmentParser<{}>;
	telemetry?: Telemetry;
	/** Seconds between pings; a socket that misses one is dropped. Default 30. */
	heartbeat?: number;
	/**
	 * The largest frame accepted, in bytes. Default 1 MiB. A surface that
	 * only pushes — its clients write over HTTP — declares no routes and
	 * sets this small.
	 */
	maxPayload?: number;
	/**
	 * What one client may ask of it: handshakes a minute, handshakes in
	 * flight and open sockets per client address, frames a second per
	 * socket, and — with `maxConnectionsPer` — sockets per identity. All but
	 * the last are on by default; on the Redis transport they hold across
	 * every replica. See `WebSocketLimits`.
	 *
	 * ```ts
	 * limits: {
	 *   messagesPerSecond: 20,
	 *   maxConnectionsPer: (data) => data.userId as string,
	 *   maxConnections: 5,
	 *   overflow: 'closeOldest',
	 * }
	 * ```
	 */
	limits?: WebSocketLimits;
	/**
	 * Refuse, with 403, an upgrade that sends no `Origin` — which no browser
	 * and no native client omits, but a script does. Default false: a server
	 * may hold a socket too, and the limits apply to it either way.
	 */
	requireOrigin?: boolean;
}

/** A replica count that is not a whole number of at least one. */
export class InvalidReplicaCount extends Error {
	constructor(
		readonly id: string,
		readonly replicas: number,
	) {
		super(
			`${id} asks for ${replicas} replicas. A surface runs on at least one process — give a whole number of 1 or more.`,
		);
		this.name = 'InvalidReplicaCount';
	}
}

export class WebSocketApi<
	TName extends string = string,
	TMessages extends WebSocketMessages = NoMessages,
> implements Declarable<TName>
{
	readonly id: TName;

	readonly keys: {
		url: string;
		trustedOrigins: string;
		publisherConnectionString: string;
	};

	readonly logger: Logger;
	readonly envParser: EnvironmentParser<{}>;
	readonly telemetry?: Telemetry;
	/**
	 * The shape its frames take — `{ action, data }`, or flat under
	 * `discriminator`. What a client of the surface decodes by.
	 */
	readonly frame: { readonly discriminator?: string };
	/** What one client may ask of it, defaults filled in. */
	readonly limits: ResolvedWebSocketLimits;

	/**
	 * The surface as a dependency: `services.<id>` is its publisher, so an
	 * endpoint sends to a socket the way a route beside it does.
	 */
	readonly service: Service<Uncapitalize<TName>, WebSocketPublisher<TMessages>>;

	constructor(
		id: ConstructName<TName>,
		private readonly config: WebSocketApiConfig<TMessages>,
		/** Internal: how `.auth()` carries the authenticator into its copy. */
		readonly authenticator?: Authenticator,
	) {
		const canonical = canonicalId(id as string);
		this.id = canonical as TName;

		const replicas = config.replicas ?? 1;
		if (!Number.isInteger(replicas) || replicas < 1) {
			throw new InvalidReplicaCount(canonical, replicas);
		}

		const frame = new FrameShape(canonical, config.frame?.discriminator);
		if (config.messages) frame.check(config.messages);
		this.frame = config.frame
			? { discriminator: config.frame.discriminator }
			: {};
		this.limits = resolveLimits(canonical, config.limits);

		this.keys = {
			url: providedKeyFor(canonical, 'websocket-api', 'url'),
			trustedOrigins: providedKeyFor(
				canonical,
				'websocket-api',
				'trustedOrigins',
			),
			publisherConnectionString: providedKeyFor(
				canonical,
				'websocket-api',
				'publisherConnectionString',
			),
		};
		this.logger = config.logger ?? DEFAULT_LOGGER;
		this.telemetry = config.telemetry;
		this.envParser = envParserFor(
			config.envParser
				? { id: canonical, envParser: config.envParser }
				: undefined,
		);

		const envVar = this.keys.publisherConnectionString;
		const channel = channelOf(canonical);
		this.service = {
			serviceName: serviceKey(canonical) as Uncapitalize<TName>,
			// The same publisher an adaptor builds over a sink of its own: only
			// where the sink sends differs, by the string's scheme.
			register: async ({ envParser }) => {
				const { connectionString } = envParser
					.create((get) => ({ connectionString: get(envVar).string() }))
					.parse();
				return this.publisher(
					await sinkFromConnectionString(this.id, connectionString, channel),
				);
			},
		};
	}

	/** The handler a connection's upgrade runs: refuse it, or say who it is. */
	connect(): WebSocketRouteBuilder<'connect', undefined, [], TMessages> {
		return new WebSocketRouteBuilder('connect', '$connect', this);
	}

	/** The handler a closed connection runs. */
	disconnect(): WebSocketRouteBuilder<'disconnect', undefined, [], TMessages> {
		return new WebSocketRouteBuilder('disconnect', '$disconnect', this);
	}

	/**
	 * The handler for frames whose `action` — or, for flat frames, whose
	 * discriminator — is `action`. `$default` answers
	 * any action nothing else does.
	 */
	route(
		action: string,
	): WebSocketRouteBuilder<'message', undefined, [], TMessages> {
		return new WebSocketRouteBuilder('message', action, this);
	}

	/** What authenticates a connection — its session reaches `connect()`. */
	auth(construct: Authenticator): WebSocketApi<TName, TMessages> {
		return new WebSocketApi<TName, TMessages>(
			this.id as ConstructName<TName>,
			this.config,
			construct,
		);
	}

	/**
	 * Serve it: the routes exported by `modules` that were built from this
	 * surface, on whatever HTTP server `attach` is handed.
	 *
	 * `app` answers plain HTTP — the generated entry puts `/health` in front
	 * of it — and `attach` takes over the server's upgrades. The sockets are
	 * closed with 1012 when the server shuts down.
	 */
	async server(
		options: ServiceRegisterOptions & { modules?: readonly object[] },
	): Promise<{
		app: Hono;
		attach(server: Server): void;
		/** Close every socket with 1012, so the HTTP server can close. */
		release(): Promise<void>;
		server: WebSocketSurfaceServer<TMessages>;
	}> {
		const { Hono } = await loadHono('A WebSocketApi');

		const { connectionString, origins, url } = options.envParser
			.create((get) => ({
				connectionString: get(this.keys.publisherConnectionString)
					.string()
					// One process with nobody else sending: the sockets and the
					// routes meet in memory.
					.default(`memory://${channelOf(this.id)}`),
				origins: get(this.keys.trustedOrigins)
					.string()
					.default('')
					.transform((value: string) =>
						value
							.split(',')
							.map((origin) => origin.trim())
							.filter(Boolean),
					),
				// Its own address: a native client sends that origin.
				url: get(this.keys.url).string().optional(),
			}))
			.parse();

		const server = await WebSocketSurfaceServer.start<TMessages>({
			core: (sink) =>
				this.core({
					envParser: options.envParser,
					sink,
					...(options.modules ? { modules: options.modules } : {}),
				}),
			transport: await transportFromConnectionString(
				connectionString,
				channelOf(this.id),
			),
			trustedOrigins: origins,
			...(this.config.requireOrigin ? { requireOrigin: true } : {}),
			limits: this.limits,
			logger: this.logger,
			...(url ? { url } : {}),
			...(this.config.heartbeat
				? { heartbeatMs: this.config.heartbeat * 1000 }
				: {}),
			...(this.config.maxPayload ? { maxPayload: this.config.maxPayload } : {}),
		});
		onShutdown(() => server.close());

		const app = new Hono();
		// Its own, so a process with nothing in front of it — `gkm dev`'s —
		// answers a probe too. A production entry puts one before it anyway.
		app.get('/health', (c) =>
			c.json({ status: 'ok', connections: server.size }),
		);
		app.get('/', (c) =>
			c.json({ surface: this.id, connections: server.size }, 426, {
				Upgrade: 'websocket',
			}),
		);

		return {
			app,
			attach: (http) => server.attach(http),
			release: () => server.close(),
			server,
		};
	}

	/**
	 * The surface with no socket in it — what every runtime serves. The
	 * routes exported by `modules` that were built from this surface answer
	 * its frames; `sink` is where its handlers' `sockets` send.
	 *
	 * `server()` is the Node adaptor over it. Another runtime (a Lambda
	 * behind API Gateway, a test) builds one with a sink of its own and
	 * calls `connect()`, `message()` and `disconnect()` per connection id.
	 *
	 * @throws {DuplicateWebSocketRoute} when two routes answer one action.
	 */
	core(options: {
		envParser: EnvironmentParser<{}>;
		sink: WebSocketSink;
		modules?: readonly object[];
	}): WebSocketCore<TMessages> {
		return new WebSocketCore<TMessages>({
			surface: this.id,
			routes: (options.modules ?? []).flatMap((module) =>
				Object.values(module).filter(WebSocketRoute.isRoute),
			),
			sink: options.sink,
			envParser: options.envParser,
			logger: this.logger,
			...(this.config.frame ? { frame: this.config.frame } : {}),
			...(this.declared ? { messages: this.declared.messages } : {}),
			...(this.authenticator ? { authenticator: this.authenticator } : {}),
		});
	}

	/**
	 * The surface's publisher over `sink` — typed, checked and encoded as
	 * `services.<id>` is. What an adaptor with a sink of its own (MSW, a
	 * Lambda) hands the code that sends to its connections.
	 */
	publisher(sink: WebSocketSink): WebSocketPublisher<TMessages> {
		return new WebSocketPublisher<TMessages>(
			sink,
			this.declared,
			new FrameShape(this.id, this.config.frame?.discriminator),
		);
	}

	/**
	 * A publisher of the type `services.<id>` is, that records rather than
	 * sends — hand it to an endpoint's spec, or to a route's `request()` as
	 * `sockets`, and assert on `sent`, `broadcasts` and `closed`.
	 *
	 * Every send is checked by the declared `messages` and encoded by `frame`,
	 * as deployed: an invalid push rejects, and each record carries the
	 * frame a client would parse.
	 *
	 * ```ts
	 * const realtime = surface.testPublisher();
	 * await sendMessage.request({ services: { realtime }, … });
	 * expect(realtime.sent).toEqual([
	 *   { ids: ['a.1'], action: 'chat.sent', data: { text: 'hi' }, frame: … },
	 * ]);
	 * ```
	 */
	testPublisher(): TestWebSocketPublisher<TMessages> {
		return new TestWebSocketPublisher<TMessages>(
			new FrameShape(this.id, this.config.frame?.discriminator),
			this.declared,
		);
	}

	/**
	 * The per-address limits the edge in front of it enforces too, so a
	 * flood is refused before it reaches a replica.
	 */
	private get edgeLimits(): WebSocketEdgeLimits | undefined {
		const { handshakesPerMinute, connectionsPerIp } = this.limits;
		if (!handshakesPerMinute && !connectionsPerIp) return undefined;
		return {
			...(handshakesPerMinute ? { handshakesPerMinute } : {}),
			...(connectionsPerIp ? { connectionsPerIp } : {}),
		};
	}

	/** The declared messages, with the surface they are checked for. */
	private get declared(): { surface: string; messages: TMessages } | undefined {
		return this.config.messages
			? { surface: this.id, messages: this.config.messages }
			: undefined;
	}

	declare(): Declaration[] {
		return [
			{
				kind: 'websocket-api',
				id: this.id,
				path: this.config.path,
				...(this.config.subdomain ? { subdomain: this.config.subdomain } : {}),
				...(this.config.frame?.discriminator
					? { discriminator: this.config.frame.discriminator }
					: {}),
				...(this.authenticator ? { auth: edgeTo(this.authenticator) } : {}),
				...(this.config.telemetry
					? { telemetry: this.config.telemetry.id }
					: {}),
				...(this.config.replicas && this.config.replicas > 1
					? { replicas: this.config.replicas }
					: {}),
				...(this.edgeLimits ? { limits: this.edgeLimits } : {}),
				provides: [
					this.keys.url,
					this.keys.trustedOrigins,
					this.keys.publisherConnectionString,
				],
			},
		];
	}
}

/**
 * Where `services.<surface>` sends, by the publisher string's scheme: a
 * registered driver's sink — API Gateway's management API on an AWS stage,
 * registered by the build's entry — or else whichever process holds the
 * sockets (`redis://`, `memory://`).
 *
 * @throws {UnregisteredWebSocketScheme} for `apigateway://` with no driver.
 */
async function sinkFromConnectionString(
	surface: string,
	connectionString: string,
	channel: string,
): Promise<WebSocketSink> {
	const driver = webSocketSinkDriverFor(connectionString);
	if (driver) return driver.sink(connectionString);
	if (connectionString.startsWith(API_GATEWAY_WEBSOCKET_SCHEME)) {
		throw new UnregisteredWebSocketScheme(
			surface,
			API_GATEWAY_WEBSOCKET_SCHEME,
		);
	}
	const transport = await transportFromConnectionString(
		connectionString,
		channel,
	);
	onShutdown(() => transport.close());
	return new TransportSink(transport);
}

/** The prefix a surface's channels are named under. */
function channelOf(id: string): string {
	return `gkm:ws:${id}`;
}
