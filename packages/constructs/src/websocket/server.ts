/**
 * The process that holds a WebSocket surface's sockets.
 *
 * Node's own `http` server and `ws`, nothing between them: a frame is parsed,
 * validated and handed to its route, and that is the whole hot path. The HTTP
 * server is whatever the entry started — the generated one serves `/health`
 * on the same port — and this attaches to its `upgrade` event.
 */

import { randomBytes } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { EnvironmentParser } from '@geekmidas/envkit';
import { HttpError } from '@geekmidas/errors';
import type { Logger } from '@geekmidas/logger';
import { runWithRequestContext, ServiceDiscovery } from '@geekmidas/services';
import type { WebSocket, WebSocketServer } from 'ws';
import type { Authenticator } from '../construct-interface';
import {
	type NoMessages,
	type WebSocketMessages,
	WebSocketPublisher,
} from './publisher';
import type { Connection, WebSocketRoute } from './route';
import type { Delivery, WebSocketTransport } from './transport';

/** Close codes a client sees. */
export const CLOSE = {
	normal: 1000,
	/** The process is stopping; reconnect and land on another. */
	serviceRestart: 1012,
	/** It stopped reading, and what was queued for it passed the limit. */
	tooSlow: 1013,
} as const;

/** A frame a client sends: `{ "action": "chat.send", "id": 1, "data": … }`. */
interface InboundFrame {
	action: string;
	/** Echoed on the reply, so a client can pair them. */
	id?: string | number;
	data?: unknown;
}

/** Two routes answer one action. */
export class DuplicateWebSocketRoute extends Error {
	constructor(
		readonly surface: string,
		readonly action: string,
	) {
		super(
			`Two routes on ${surface} answer '${action}'. Each action has one handler — rename one of them.`,
		);
		this.name = 'DuplicateWebSocketRoute';
	}
}

export interface WebSocketServerOptions<
	TMessages extends WebSocketMessages = NoMessages,
> {
	surface: string;
	/** What the surface sends its sockets — see `WebSocketApiConfig.messages`. */
	messages?: TMessages;
	routes: readonly WebSocketRoute[];
	transport: WebSocketTransport;
	envParser: EnvironmentParser<{}>;
	logger: Logger;
	authenticator?: Authenticator;
	/**
	 * Origins a browser may open a socket from. A request with an `Origin`
	 * not in the list is refused with 403; one with none — a server, a load
	 * generator — is not a browser, and is let through.
	 */
	trustedOrigins: readonly string[];
	/** How often each socket is pinged; one that missed the last is dropped. */
	heartbeatMs?: number;
	/** The largest frame accepted, in bytes. */
	maxPayload?: number;
	/** Queued bytes a socket may hold before it is closed as too slow. */
	maxBufferedBytes?: number;
}

interface Held {
	socket: WebSocket;
	connection: Connection;
	alive: boolean;
}

export class WebSocketSurfaceServer<
	TMessages extends WebSocketMessages = NoMessages,
> {
	/** This process, as connection ids name it. */
	readonly instance = randomBytes(6).toString('hex');
	/** `sockets` in a route: local sends skip the transport. */
	readonly publisher: WebSocketPublisher<TMessages>;

	private readonly held = new Map<string, Held>();
	private readonly routes = new Map<string, WebSocketRoute>();
	private readonly lifecycle: {
		connect?: WebSocketRoute;
		disconnect?: WebSocketRoute;
	} = {};
	private readonly heartbeat: NodeJS.Timeout;
	private next = 0;
	private closing = false;

	private constructor(
		private readonly wss: WebSocketServer,
		private readonly options: WebSocketServerOptions<TMessages>,
	) {
		for (const route of options.routes) {
			if (route.surface.id !== options.surface) continue;
			if (route.kind === 'message') {
				if (this.routes.has(route.action)) {
					throw new DuplicateWebSocketRoute(options.surface, route.action);
				}
				this.routes.set(route.action, route);
			} else {
				if (this.lifecycle[route.kind]) {
					throw new DuplicateWebSocketRoute(options.surface, route.action);
				}
				this.lifecycle[route.kind] = route;
			}
		}

		this.publisher = new WebSocketPublisher<TMessages>(
			options.transport,
			{
				instance: this.instance,
				deliver: (delivery) => this.deliver(delivery),
			},
			options.messages
				? { surface: options.surface, messages: options.messages }
				: undefined,
		);

		this.heartbeat = setInterval(
			() => this.beat(),
			options.heartbeatMs ?? 30_000,
		);
		this.heartbeat.unref();
	}

	static async start<TMessages extends WebSocketMessages = NoMessages>(
		options: WebSocketServerOptions<TMessages>,
	): Promise<WebSocketSurfaceServer<TMessages>> {
		const { WebSocketServer } = await import('ws');
		const wss = new WebSocketServer({
			noServer: true,
			maxPayload: options.maxPayload ?? 1024 * 1024,
			// Compression costs a zlib context per socket — tens of KB each,
			// the largest share of a connection's memory — for frames that are
			// mostly small JSON.
			perMessageDeflate: false,
			clientTracking: false,
		});
		const server = new WebSocketSurfaceServer<TMessages>(wss, options);
		await options.transport.subscribe(server.instance, (delivery) =>
			server.deliver(delivery),
		);
		return server;
	}

	/** How many sockets this process holds. */
	get size(): number {
		return this.held.size;
	}

	/** Take over `server`'s upgrades. */
	attach(server: Server): void {
		server.on('upgrade', (request, socket, head) => {
			void this.upgrade(request, socket, head);
		});
	}

	/** Upgrade one request, or refuse it with a status line. */
	async upgrade(
		request: IncomingMessage,
		socket: Duplex,
		head: Buffer,
	): Promise<void> {
		if (this.closing) return refuse(socket, 503, 'Service Unavailable');

		const origin = request.headers.origin;
		if (origin && !this.options.trustedOrigins.includes(origin)) {
			return refuse(socket, 403, 'Forbidden');
		}

		const connectionId = `${this.instance}.${(this.next++).toString(36)}`;
		const headers = headersOf(request);
		let data: Record<string, unknown> = {};

		const connect = this.lifecycle.connect;
		if (connect) {
			try {
				const session = this.options.authenticator
					? await this.options.authenticator.verify(
							headers,
							this.options.envParser,
						)
					: null;
				const returned = await this.run(connect, connectionId, (base) => ({
					...base,
					connectionId,
					headers,
					query: new URL(request.url ?? '/', 'http://localhost').searchParams,
					session,
				}));
				if (returned && typeof returned === 'object') {
					data = returned as Record<string, unknown>;
				}
			} catch (error) {
				if (error instanceof HttpError) {
					return refuse(socket, error.statusCode, error.statusMessage);
				}
				this.options.logger.error(
					{ err: error, connectionId },
					'WebSocket connect handler failed',
				);
				return refuse(socket, 500, 'Internal Server Error');
			}
		}

		// The client may have gone while the connect handler ran.
		if (socket.destroyed) return;

		this.wss.handleUpgrade(request, socket, head, (ws) =>
			this.open(ws, { id: connectionId, data }),
		);
	}

	private open(socket: WebSocket, connection: Connection): void {
		const held: Held = { socket, connection, alive: true };
		this.held.set(connection.id, held);

		socket.on('pong', () => {
			held.alive = true;
		});
		socket.on('message', (raw, isBinary) => {
			held.alive = true;
			if (isBinary) {
				return this.error(held, undefined, 'Frames are JSON text.');
			}
			void this.dispatch(held, raw.toString());
		});
		socket.on('error', () => socket.terminate());
		socket.on('close', (code, reason) => {
			this.held.delete(connection.id);
			const disconnect = this.lifecycle.disconnect;
			if (!disconnect) return;
			void this.run(disconnect, connection.id, (base) => ({
				...base,
				connection,
				code,
				reason: reason.toString(),
			})).catch((error) =>
				this.options.logger.error(
					{ err: error, connectionId: connection.id },
					'WebSocket disconnect handler failed',
				),
			);
		});
	}

	/** Parse, validate and run one frame. Errors go back as frames, not closes. */
	private async dispatch(held: Held, text: string): Promise<void> {
		let frame: InboundFrame;
		try {
			frame = JSON.parse(text);
		} catch {
			return this.error(held, undefined, 'Frames are JSON.');
		}
		if (!frame || typeof frame.action !== 'string') {
			return this.error(held, frame?.id, 'A frame names its `action`.');
		}

		const route = this.routes.get(frame.action) ?? this.routes.get('$default');
		if (!route) {
			return this.error(held, frame.id, `No route answers '${frame.action}'.`);
		}

		let body = frame.data;
		if (route.schema) {
			const result = await route.schema['~standard'].validate(frame.data);
			if (result.issues) {
				return this.error(
					held,
					frame.id,
					'The frame was invalid.',
					result.issues,
				);
			}
			body = result.value;
		}

		try {
			const returned = await this.run(route, held.connection.id, (base) => ({
				...base,
				connection: held.connection,
				body,
				reply: (message: unknown) => this.write(held, JSON.stringify(message)),
			}));
			if (returned !== undefined) {
				this.write(
					held,
					JSON.stringify({
						action: frame.action,
						...(frame.id !== undefined ? { id: frame.id } : {}),
						data: returned,
					}),
				);
			}
		} catch (error) {
			if (error instanceof HttpError) {
				return this.error(held, frame.id, error.message);
			}
			this.options.logger.error(
				{ err: error, connectionId: held.connection.id, action: frame.action },
				'WebSocket route failed',
			);
			this.error(held, frame.id, 'The route failed.');
		}
	}

	/** Run a handler with its services, inside a request context of its own. */
	private async run(
		route: WebSocketRoute,
		connectionId: string,
		context: (base: {
			services: unknown;
			logger: Logger;
			sockets: WebSocketPublisher<TMessages>;
		}) => object,
	): Promise<unknown> {
		const logger = this.options.logger.child({
			connectionId,
			action: route.action,
		});
		return runWithRequestContext(
			{
				logger,
				requestId: connectionId,
				startTime: Date.now(),
				operation: `ws ${route.action}`,
			},
			async () => {
				const services = route.services.length
					? await ServiceDiscovery.getInstance(this.options.envParser).register(
							[...route.services],
						)
					: {};
				return (route.handler as (context: object) => unknown)(
					context({ services, logger, sockets: this.publisher }),
				);
			},
		);
	}

	private error(
		held: Held,
		id: InboundFrame['id'],
		message: string,
		issues?: unknown,
	): void {
		this.write(
			held,
			JSON.stringify({
				action: '$error',
				...(id !== undefined ? { id } : {}),
				data: { message, ...(issues ? { issues } : {}) },
			}),
		);
	}

	/** Write, unless the socket has stopped reading and its queue is full. */
	private write(held: Held, payload: string): void {
		const { socket } = held;
		if (socket.readyState !== socket.OPEN) return;
		if (
			socket.bufferedAmount > (this.options.maxBufferedBytes ?? 4 * 1024 * 1024)
		) {
			socket.close(CLOSE.tooSlow, 'Too slow');
			return;
		}
		socket.send(payload);
	}

	/** What the transport, or a local publisher, asked of this process. */
	private deliver(delivery: Delivery): void {
		switch (delivery.kind) {
			case 'send':
				for (const id of delivery.ids) {
					const held = this.held.get(id);
					if (held) this.write(held, delivery.payload);
				}
				return;
			case 'broadcast': {
				const except = delivery.except ? new Set(delivery.except) : undefined;
				for (const [id, held] of this.held) {
					if (!except?.has(id)) this.write(held, delivery.payload);
				}
				return;
			}
			case 'close':
				for (const id of delivery.ids) {
					this.held.get(id)?.socket.close(delivery.code, delivery.reason);
				}
				return;
		}
	}

	/** Drop every socket that missed the last ping, and ping the rest. */
	private beat(): void {
		for (const [id, held] of this.held) {
			if (!held.alive) {
				held.socket.terminate();
				this.held.delete(id);
				continue;
			}
			held.alive = false;
			held.socket.ping();
		}
	}

	/**
	 * Stop: refuse new upgrades, close every socket with `code` — 1012 tells
	 * a client to reconnect, and it lands on a process that is still up — and
	 * leave the transport.
	 */
	async close(
		code: number = CLOSE.serviceRestart,
		reason = 'Restarting',
	): Promise<void> {
		if (this.closing) return;
		this.closing = true;
		clearInterval(this.heartbeat);

		const closed = [...this.held.values()].map(
			({ socket }) =>
				new Promise<void>((resolve) => {
					if (socket.readyState === socket.CLOSED) return resolve();
					socket.once('close', () => resolve());
					socket.close(code, reason);
					// A client that never answers the close is cut off.
					setTimeout(() => {
						socket.terminate();
						resolve();
					}, 2_000).unref();
				}),
		);
		await Promise.all(closed);
		await this.options.transport.close();
		this.wss.close();
	}
}

function headersOf(request: IncomingMessage): Headers {
	const headers = new Headers();
	for (const [name, value] of Object.entries(request.headers)) {
		if (value === undefined) continue;
		for (const one of Array.isArray(value) ? value : [value]) {
			headers.append(name, one);
		}
	}
	return headers;
}

function refuse(socket: Duplex, status: number, message: string): void {
	if (!socket.destroyed) {
		socket.end(
			`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
		);
	}
}
