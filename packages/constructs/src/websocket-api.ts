/**
 * `WebSocketApi` — a surface that holds long-lived connections.
 *
 * A process of its own, like a `RestApi`: it owns an address, its routes are
 * built from it, and they run in its container and nowhere else. A frame is
 * routed on its `action` — `{ "action": "chat.send", "data": … }`, API
 * Gateway's shape — and the connection's lifecycle on `$connect` and
 * `$disconnect`.
 *
 * Anything else reaches a socket through the surface's publisher:
 * `.dependsOn([realtime])` puts `services.realtime` in an endpoint, a cron or
 * a subscriber, and whichever replica holds the socket delivers.
 *
 * ```ts
 * export const realtime = new WebSocketApi('Realtime', {
 *   path: 'apps/realtime',
 *   logger,
 * });
 *
 * export const send = realtime
 *   .route('chat.send')
 *   .body(z.object({ text: z.string() }))
 *   .handle(async ({ body, sockets }) => sockets.broadcast(body));
 * ```
 */

import type { Server } from 'node:http';
import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { DEFAULT_LOGGER } from '@geekmidas/logger/console';
import {
	type ConstructName,
	canonicalId,
	type Declaration,
	type Dependency,
	provideKey,
	serviceKey,
} from '@geekmidas/manifest';
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import type { Hono } from 'hono';
import {
	type Authenticator,
	type Declarable,
	edgeTo,
} from './construct-interface';
import { envParserFor } from './endpoints/surfaceEnv';
import { onShutdown } from './shutdown';
import type { Telemetry } from './telemetry';
import { WebSocketPublisher } from './websocket/publisher';
import { WebSocketRoute, WebSocketRouteBuilder } from './websocket/route';
import { WebSocketSurfaceServer } from './websocket/server';
import { transportFromConnectionString } from './websocket/transport';

export { WebSocketPublisher } from './websocket/publisher';
export type {
	ConnectContext,
	Connection,
	DisconnectContext,
	MessageContext,
	RouteKind,
} from './websocket/route';
export { WebSocketRoute, WebSocketRouteBuilder } from './websocket/route';
export {
	CLOSE,
	DuplicateWebSocketRoute,
	type WebSocketServerOptions,
	WebSocketSurfaceServer,
} from './websocket/server';
export {
	type Delivery,
	MemoryTransport,
	RedisTransport,
	transportFromConnectionString,
	UnsupportedWebSocketTransport,
	type WebSocketTransport,
} from './websocket/transport';

export interface WebSocketApiConfig {
	/** The app that serves it, relative to the workspace root. */
	path: string;
	/** The label it answers on. Absent, its id kebab-cased. */
	subdomain?: string;
	/** How many processes serve it on one machine. Default 1. */
	replicas?: number;
	logger?: Logger;
	envParser?: EnvironmentParser<{}>;
	telemetry?: Telemetry;
	/** Seconds between pings; a socket that misses one is dropped. Default 30. */
	heartbeat?: number;
	/** The largest frame accepted, in bytes. Default 1 MiB. */
	maxPayload?: number;
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

export class WebSocketApi<TName extends string = string>
	implements Declarable<TName>
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
	 * The surface as a dependency: `services.<id>` is its publisher, so an
	 * endpoint sends to a socket the way a route beside it does.
	 */
	readonly service: Service<Uncapitalize<TName>, WebSocketPublisher>;

	constructor(
		id: ConstructName<TName>,
		private readonly config: WebSocketApiConfig,
		/** Internal: how `.calls()` carries edges into the copy it returns. */
		private readonly dependencies: readonly Dependency[] = [],
		/** Internal: how `.auth()` carries the authenticator into its copy. */
		readonly authenticator?: Authenticator,
	) {
		const canonical = canonicalId(id as string);
		this.id = canonical as TName;

		const replicas = config.replicas ?? 1;
		if (!Number.isInteger(replicas) || replicas < 1) {
			throw new InvalidReplicaCount(canonical, replicas);
		}

		this.keys = {
			url: provideKey(canonical, 'url'),
			trustedOrigins: provideKey(canonical, 'trustedOrigins'),
			publisherConnectionString: provideKey(
				canonical,
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
			async register({ envParser }) {
				const { connectionString } = envParser
					.create((get) => ({ connectionString: get(envVar).string() }))
					.parse();
				const transport = await transportFromConnectionString(
					connectionString,
					channel,
				);
				onShutdown(() => transport.close());
				return new WebSocketPublisher(transport);
			},
		};
	}

	/** The handler a connection's upgrade runs: refuse it, or say who it is. */
	connect(): WebSocketRouteBuilder<'connect'> {
		return new WebSocketRouteBuilder('connect', '$connect', { id: this.id });
	}

	/** The handler a closed connection runs. */
	disconnect(): WebSocketRouteBuilder<'disconnect'> {
		return new WebSocketRouteBuilder('disconnect', '$disconnect', {
			id: this.id,
		});
	}

	/**
	 * The handler for frames whose `action` is `action`. `$default` answers
	 * any action nothing else does.
	 */
	route(action: string): WebSocketRouteBuilder<'message'> {
		return new WebSocketRouteBuilder('message', action, { id: this.id });
	}

	/** What authenticates a connection — its session reaches `connect()`. */
	auth(construct: Authenticator): WebSocketApi<TName> {
		return new WebSocketApi<TName>(
			this.id as ConstructName<TName>,
			this.config,
			[...this.dependencies, edgeTo(construct)],
			construct,
		);
	}

	/** Other surfaces this one calls. See `RestApi.calls`. */
	calls(constructs: readonly Declarable[]): WebSocketApi<TName> {
		return new WebSocketApi<TName>(
			this.id as ConstructName<TName>,
			this.config,
			[...this.dependencies, ...constructs.map(edgeTo)],
			this.authenticator,
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
		server: WebSocketSurfaceServer;
	}> {
		const { Hono } = await import('hono');
		const routes = (options.modules ?? []).flatMap((module) =>
			Object.values(module).filter(WebSocketRoute.isRoute),
		);

		const { connectionString, origins } = options.envParser
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
			}))
			.parse();

		const server = await WebSocketSurfaceServer.start({
			surface: this.id,
			routes,
			transport: await transportFromConnectionString(
				connectionString,
				channelOf(this.id),
			),
			envParser: options.envParser,
			logger: this.logger,
			trustedOrigins: origins,
			...(this.authenticator ? { authenticator: this.authenticator } : {}),
			...(this.config.heartbeat
				? { heartbeatMs: this.config.heartbeat * 1000 }
				: {}),
			...(this.config.maxPayload ? { maxPayload: this.config.maxPayload } : {}),
		});
		onShutdown(() => server.close());

		const app = new Hono();
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

	declare(): Declaration[] {
		return [
			{
				kind: 'websocket-api',
				id: this.id,
				path: this.config.path,
				...(this.config.subdomain ? { subdomain: this.config.subdomain } : {}),
				...(this.authenticator ? { auth: this.authenticator.id } : {}),
				...(this.dependencies.length ? { calls: this.dependencies } : {}),
				...(this.config.telemetry
					? { telemetry: this.config.telemetry.id }
					: {}),
				...(this.config.replicas && this.config.replicas > 1
					? { replicas: this.config.replicas }
					: {}),
				provides: [
					this.keys.url,
					this.keys.trustedOrigins,
					this.keys.publisherConnectionString,
				],
			},
		];
	}
}

/** The prefix a surface's channels are named under. */
function channelOf(id: string): string {
	return `gkm:ws:${id}`;
}
