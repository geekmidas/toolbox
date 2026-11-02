/**
 * The MSW adaptor: a surface's real routes behind MSW's `ws.link()`, so code
 * that holds a `WebSocket` — a client, its reconnects, its decoding — runs
 * unchanged against them, in one process, with no server.
 *
 * MSW intercepts the client's `WebSocket` and hands each connection here.
 * The adaptor gives it an id, runs `connect()`, then each frame the client
 * sends through `message()`, and `disconnect()` when either side closes.
 * What reaches a socket from elsewhere — an endpoint's `services.<surface>` —
 * goes over an in-process `memory://` channel, as it does between a route
 * and the Node adaptor in one dev process, and is written to MSW's `client`.
 *
 * ```ts
 * const realtime = createMswWebSocketHandlers(surface, [routes], {
 *   url: 'wss://realtime.test',
 * });
 * server.use(...realtime.handlers);
 *
 * realtime.registerContext(id, { session, services: { database: trx } });
 * const socket = new WebSocket(`wss://realtime.test/?${TEST_CONTEXT_PARAM}=${id}`);
 * await sendMessage.request({ services: { realtime: realtime.publisher }, … });
 * ```
 *
 * There is no handshake to see: a browser-style `WebSocket` sends no headers
 * a test can set, so the session comes from the registered context (no
 * context is no session). The Origin check, the heartbeat and close codes
 * on a real upgrade stay the Node adaptor's.
 */

import { randomUUID } from 'node:crypto';
import type { EnvironmentParser } from '@geekmidas/envkit';
import { type WebSocketHandler, ws } from 'msw';
import type { WebSocketApi } from '../websocket-api';
import type { WebSocketCore } from './core';
import type {
	NoMessages,
	WebSocketMessages,
	WebSocketPublisher,
} from './publisher';
import type { Connection } from './route';
import { type Delivery, MemoryTransport, TransportSink } from './transport';

/**
 * The query parameter that names a connection's test context. Read and
 * removed before `connect()` sees `query`, so the handler never does.
 */
export const TEST_CONTEXT_PARAM = '__gkm_test_context';

/**
 * The close code a refused connection gets: `4000 + status`, so a 401 is
 * 4401. MSW cannot answer an upgrade with a status line, as a server does.
 */
export const REFUSED_CLOSE_BASE = 4000;

/** What one test's connections run with. */
export interface MswWebSocketContext {
	/** Instances for the routes' dependencies — the test's transaction. */
	services?: Record<string, unknown>;
	/** Whose connection it is, as `.auth()` would have resolved it. */
	session?: unknown;
}

export interface CreateMswWebSocketHandlersOptions {
	/** The URL the client opens — what `ws.link()` matches. */
	url: string | RegExp;
	/** What unregistered services are registered with. Default the surface's. */
	envParser?: EnvironmentParser<{}>;
	/**
	 * The `memory://` channel sends reach the connections on. Default one of
	 * its own, so two adaptors in one process never share sockets.
	 */
	channel?: string;
}

export interface MswWebSocketHandlers<
	TMessages extends WebSocketMessages = NoMessages,
> {
	/** For `setupServer(...)` or `server.use(...)`. */
	handlers: WebSocketHandler[];
	/** Give a test's connections their services and session. */
	registerContext(id: string, context: MswWebSocketContext): void;
	removeContext(id: string): void;
	/**
	 * A publisher whose sends reach these connections — hand it to an
	 * endpoint as `services.<surface>`.
	 */
	publisher: WebSocketPublisher<TMessages>;
	/**
	 * The same channel as a connection string — what
	 * `<ID>_PUBLISHER_CONNECTION_STRING` would be for `services.<surface>` to
	 * register onto it.
	 */
	connectionString: string;
	/** Every connection open now, in the order they opened. */
	readonly connections: readonly Connection[];
	/** Stop receiving sends on the channel. */
	close(): Promise<void>;
}

/** The part of MSW's client connection the adaptor uses. */
interface MswClient {
	readonly url: URL;
	send(data: string): void;
	close(code?: number, reason?: string): void;
	addEventListener(
		type: 'message',
		listener: (event: MessageEvent) => void,
	): void;
	addEventListener(type: 'close', listener: (event: CloseEvent) => void): void;
}

/** A connection whose query names a context no test registered. */
export class UnknownWebSocketTestContext extends Error {
	constructor(readonly id: string) {
		super(
			`No test registered the WebSocket context '${id}'. Call registerContext('${id}', …) before opening the socket, and keep it until it closes.`,
		);
		this.name = 'UnknownWebSocketTestContext';
	}
}

/** The close code a connection with an unknown context is closed with. */
const UNKNOWN_CONTEXT_CLOSE = 1011;

export function createMswWebSocketHandlers<
	TMessages extends WebSocketMessages = NoMessages,
>(
	surface: WebSocketApi<string, TMessages>,
	modules: readonly object[],
	options: CreateMswWebSocketHandlersOptions,
): MswWebSocketHandlers<TMessages> {
	const instance = `msw${randomUUID().slice(0, 8)}`;
	const channel = options.channel ?? `gkm:ws:${surface.id}:${instance}`;
	const transport = new MemoryTransport(channel);
	const contexts = new Map<string, MswWebSocketContext>();
	const open = new Map<string, { connection: Connection; client: MswClient }>();

	const deliver = (delivery: Delivery) => {
		if (delivery.kind === 'broadcast') {
			const except = new Set(delivery.except ?? []);
			for (const [id, { client }] of open) {
				if (!except.has(id)) client.send(delivery.payload);
			}
			return;
		}
		for (const id of delivery.ids) {
			const client = open.get(id)?.client;
			if (!client) continue;
			if (delivery.kind === 'send') client.send(delivery.payload);
			else client.close(delivery.code, delivery.reason);
		}
	};
	const subscribed = transport.subscribe(instance, deliver);
	const sink = new TransportSink(transport, { instance, deliver });
	const core: WebSocketCore<TMessages> = surface.core({
		envParser: options.envParser ?? surface.envParser,
		sink,
		modules,
	});

	let issued = 0;

	async function accept(client: MswClient): Promise<void> {
		const query = new URLSearchParams(client.url.searchParams);
		const contextId = query.get(TEST_CONTEXT_PARAM);
		query.delete(TEST_CONTEXT_PARAM);
		const context = contextId ? contexts.get(contextId) : {};

		issued += 1;
		const connectionId = `${instance}.${issued}`;

		// Listening before connect() resolves: a client that sends on open
		// has its frames run in order once the connection is accepted.
		let accepted: Promise<Connection | undefined> = Promise.resolve(undefined);
		let queue: Promise<unknown> = Promise.resolve();
		let closed = false;
		const call = context?.services ? { services: context.services } : {};

		client.addEventListener('message', (event) => {
			queue = queue.then(async () => {
				const connection = await accepted;
				if (!connection) return;
				await core.message(
					connection,
					await textOrBytes(event.data),
					(payload) => client.send(payload),
					call,
				);
			});
		});
		client.addEventListener('close', (event) => {
			if (closed) return;
			closed = true;
			queue = queue.then(async () => {
				const connection = await accepted;
				if (!connection) return;
				open.delete(connection.id);
				await core.disconnect(
					connection,
					{ code: event.code, reason: event.reason },
					call,
				);
			});
		});

		if (!context) {
			const error = new UnknownWebSocketTestContext(contextId!);
			client.close(UNKNOWN_CONTEXT_CLOSE, error.message.slice(0, 123));
			return;
		}

		accepted = (async () => {
			await subscribed;
			const outcome = await core.connect(
				{
					connectionId,
					headers: new Headers(),
					query,
					session: context.session ?? null,
				},
				call,
			);
			if (!outcome.accepted) {
				client.close(REFUSED_CLOSE_BASE + outcome.status, outcome.statusText);
				return undefined;
			}
			if (closed) return undefined;
			open.set(connectionId, { connection: outcome.connection, client });
			return outcome.connection;
		})();
		await accepted;
	}

	const link = ws.link(options.url);
	const handler = link.addEventListener('connection', ({ client }) => {
		void accept(client as unknown as MswClient);
	});

	return {
		handlers: [handler],
		registerContext: (id, context) => {
			contexts.set(id, context);
		},
		removeContext: (id) => {
			contexts.delete(id);
		},
		publisher: surface.publisher(
			new TransportSink(new MemoryTransport(channel)),
		),
		connectionString: `memory://${channel}`,
		get connections() {
			return [...open.values()].map(({ connection }) => connection);
		},
		close: () => transport.close(),
	};
}

/** A frame as the core takes it: text, or the bytes it refuses. */
async function textOrBytes(data: unknown): Promise<string | Uint8Array> {
	if (typeof data === 'string') return data;
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	if (ArrayBuffer.isView(data)) {
		return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	}
	if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
	return String(data);
}
