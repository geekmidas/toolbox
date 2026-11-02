/**
 * The Node adaptor: the process that holds a WebSocket surface's sockets.
 *
 * Node's own `http` server and `ws`, nothing between them. This owns what
 * only a real socket has — the upgrade, the Origin check, connection ids,
 * the heartbeat, backpressure — and hands the rest to the surface's
 * `WebSocketCore`: a handshake to `connect()`, each frame to `message()`, a
 * close to `disconnect()`. The HTTP server is whatever the entry started —
 * the generated one serves `/health` on the same port — and this attaches to
 * its `upgrade` event.
 */

import { randomBytes } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { trustsOrigin } from '@geekmidas/manifest';
import type { RawData, WebSocket, WebSocketServer } from 'ws';
import { loadWs } from '../optionalPeers';
import type { WebSocketCore } from './core';
import type {
	NoMessages,
	WebSocketMessages,
	WebSocketPublisher,
	WebSocketSink,
} from './publisher';
import type { Connection } from './route';
import {
	type Delivery,
	TransportSink,
	type WebSocketTransport,
} from './transport';

/** Close codes a client sees. */
export const CLOSE = {
	normal: 1000,
	/** The process is stopping; reconnect and land on another. */
	serviceRestart: 1012,
	/** It stopped reading, and what was queued for it passed the limit. */
	tooSlow: 1013,
} as const;

export interface WebSocketServerOptions<
	TMessages extends WebSocketMessages = NoMessages,
> {
	/**
	 * The surface's core, over the sink this process sends through — its own
	 * sockets directly, every other process's over `transport`.
	 */
	core(sink: WebSocketSink): WebSocketCore<TMessages>;
	transport: WebSocketTransport;
	/**
	 * Origins a browser may open a socket from. A request with an `Origin`
	 * not in the list is refused with 403; one with none — a server, a load
	 * generator — is not a browser, and is let through.
	 */
	trustedOrigins: readonly string[];
	/**
	 * The surface's own public address, `<ID>_URL`. Its origin is always
	 * trusted: a native client (React Native's `WebSocket`) sends the socket's
	 * own origin as its `Origin`.
	 */
	url?: string;
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
	/** Where each handshake, frame and close is handed. */
	readonly core: WebSocketCore<TMessages>;

	private readonly held = new Map<string, Held>();
	private readonly heartbeat: NodeJS.Timeout;
	private readonly trusted: readonly string[];
	private next = 0;
	private closing = false;

	private constructor(
		private readonly wss: WebSocketServer,
		private readonly options: WebSocketServerOptions<TMessages>,
	) {
		// Local sends skip the transport.
		this.core = options.core(
			new TransportSink(options.transport, {
				instance: this.instance,
				deliver: (delivery) => this.deliver(delivery),
			}),
		);
		this.trusted = [...options.trustedOrigins, ...ownOrigins(options.url)];

		this.heartbeat = setInterval(
			() => this.beat(),
			options.heartbeatMs ?? 30_000,
		);
		this.heartbeat.unref();
	}

	static async start<TMessages extends WebSocketMessages = NoMessages>(
		options: WebSocketServerOptions<TMessages>,
	): Promise<WebSocketSurfaceServer<TMessages>> {
		const { WebSocketServer } = await loadWs();
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

	/** `sockets` in a route: local sends skip the transport. */
	get publisher(): WebSocketPublisher<TMessages> {
		return this.core.sockets;
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
		if (origin && !trustsOrigin(origin, this.trusted)) {
			return refuse(socket, 403, 'Forbidden');
		}

		const outcome = await this.core.connect({
			connectionId: `${this.instance}.${(this.next++).toString(36)}`,
			headers: headersOf(request),
			query: new URL(request.url ?? '/', 'http://localhost').searchParams,
		});
		if (!outcome.accepted) {
			return refuse(socket, outcome.status, outcome.statusText);
		}

		// The client may have gone while the connect handler ran.
		if (socket.destroyed) return;

		this.wss.handleUpgrade(request, socket, head, (ws) =>
			this.open(ws, outcome.connection),
		);
	}

	private open(socket: WebSocket, connection: Connection): void {
		const held: Held = { socket, connection, alive: true };
		this.held.set(connection.id, held);
		const write = (payload: string) => this.write(held, payload);

		socket.on('pong', () => {
			held.alive = true;
		});
		socket.on('message', (raw, isBinary) => {
			held.alive = true;
			void this.core.message(
				connection,
				isBinary ? bytesOf(raw) : raw.toString(),
				write,
			);
		});
		socket.on('error', () => socket.terminate());
		socket.on('close', (code, reason) => {
			this.held.delete(connection.id);
			void this.core.disconnect(connection, {
				code,
				reason: reason.toString(),
			});
		});
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

/**
 * The origins a client of the surface's own address sends: the `https://`
 * one a native socket derives from `wss://`, and the address's own.
 */
function ownOrigins(url: string | undefined): string[] {
	if (!url || !URL.canParse(url)) return [];
	const own = new URL(url);
	const web = new URL(url.replace(/^ws(s?):/i, 'http$1:'));
	return [...new Set([`${own.protocol}//${own.host}`, web.origin])];
}

/** A binary frame's bytes, however `ws` delivered them. */
function bytesOf(raw: RawData): Uint8Array {
	if (Array.isArray(raw)) return Buffer.concat(raw);
	return raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw;
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
