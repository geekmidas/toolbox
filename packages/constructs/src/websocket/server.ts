/**
 * The Node adaptor: the process that holds a WebSocket surface's sockets.
 *
 * Node's own `http` server and `ws`, nothing between them. This owns what
 * only a real socket has — the upgrade, the Origin check, connection ids,
 * the heartbeat, backpressure, and the limits on what one client may ask of
 * it (`limits.ts`) — and hands the rest to the surface's `WebSocketCore`: a
 * handshake to `connect()`, each frame to `message()`, a close to
 * `disconnect()`. The HTTP server is whatever the entry started — the
 * generated one serves `/health` on the same port — and this attaches to its
 * `upgrade` event.
 */

import { randomBytes } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Logger } from '@geekmidas/logger';
import { trustsOrigin } from '@geekmidas/manifest';
import type { RawData, WebSocket, WebSocketServer } from 'ws';
import { loadWs } from '../optionalPeers';
import type { WebSocketCore } from './core';
import {
	clientAddress,
	LIMIT_CLOSE,
	MemoryLimitStore,
	type ResolvedWebSocketLimits,
	resolveLimits,
	TokenBucket,
	type WebSocketLimitStore,
} from './limits';
import { ownOrigins } from './origins';
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
	/**
	 * It kept sending past its message rate, or its identity opened more
	 * sockets than `limits.maxConnections` and this was the oldest.
	 */
	policy: LIMIT_CLOSE.policy,
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
	 * generator — is not a browser, and is let through unless
	 * `requireOrigin` is set.
	 */
	trustedOrigins: readonly string[];
	/**
	 * Refuse, with 403, an upgrade that sends no `Origin`. Every browser
	 * sends one and a native client sends the socket's own; a server or a
	 * script sends none. Off by default: the limits hold either way.
	 */
	requireOrigin?: boolean;
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
	/**
	 * What one client may ask of it — `resolveLimits(id, config.limits)`.
	 * Absent, the defaults.
	 */
	limits?: ResolvedWebSocketLimits;
	/** Where a limit store that cannot be reached is reported. */
	logger?: Logger;
}

/** A place in a limit's count, given back when it is done with. */
interface Lease {
	key: string;
	member: string;
}

interface Held {
	socket: WebSocket;
	connection: Connection;
	alive: boolean;
	/** Its places in the client address's and the identity's counts. */
	leases: Lease[];
	/** Its inbound budget, where there is a message rate. */
	bucket?: TokenBucket;
	/** It has been sent the `$error` for running its budget dry. */
	warned: boolean;
}

/** A handshake is counted as in flight for at most this long. */
const IN_FLIGHT_TTL_MS = 30_000;

export class WebSocketSurfaceServer<
	TMessages extends WebSocketMessages = NoMessages,
> {
	/** This process, as connection ids name it. */
	readonly instance = randomBytes(6).toString('hex');
	/** Where each handshake, frame and close is handed. */
	readonly core: WebSocketCore<TMessages>;

	private readonly held = new Map<string, Held>();
	private readonly heartbeat: NodeJS.Timeout;
	private readonly heartbeatMs: number;
	private readonly trusted: readonly string[];
	private readonly sink: TransportSink;
	private readonly limits: ResolvedWebSocketLimits;
	private readonly store: WebSocketLimitStore;
	private next = 0;
	private closing = false;

	private constructor(
		private readonly wss: WebSocketServer,
		private readonly options: WebSocketServerOptions<TMessages>,
	) {
		// Local sends skip the transport.
		this.sink = new TransportSink(options.transport, {
			instance: this.instance,
			deliver: (delivery) => this.deliver(delivery),
		});
		this.core = options.core(this.sink);
		this.trusted = [...options.trustedOrigins, ...ownOrigins(options.url)];
		this.limits = options.limits ?? resolveLimits(this.core.surface);
		// Where every process on the transport counts, so a limit holds
		// across replicas.
		this.store = options.transport.limits?.() ?? new MemoryLimitStore();

		this.heartbeatMs = options.heartbeatMs ?? 30_000;
		this.heartbeat = setInterval(() => this.beat(), this.heartbeatMs);
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

	/**
	 * Upgrade one request, or refuse it with a status line. The cheap checks
	 * come first — the Origin, the client's handshake rate, its handshakes in
	 * flight and its open sockets — so a flood is refused before the connect
	 * handler, and the session lookup it makes, runs.
	 */
	async upgrade(
		request: IncomingMessage,
		socket: Duplex,
		head: Buffer,
	): Promise<void> {
		if (this.closing) return refuse(socket, 503, 'Service Unavailable');

		const origin = request.headers.origin;
		if (
			origin ? !trustsOrigin(origin, this.trusted) : this.options.requireOrigin
		) {
			return refuse(socket, 403, 'Forbidden');
		}

		const { limits } = this;
		const client = clientAddress(request);
		const connectionId = `${this.instance}.${(this.next++).toString(36)}`;

		if (limits.handshakesPerMinute) {
			const window = await this.guard(() =>
				this.store.hit(`handshakes:${client}`, 60_000),
			);
			if (window && window.count > limits.handshakesPerMinute) {
				return tooMany(socket, window.resetMs);
			}
		}

		// Counted until the connect handler has answered.
		const inFlight: Lease = {
			key: `in-flight:${client}`,
			member: connectionId,
		};
		if (
			limits.inFlightHandshakes &&
			!(await this.claim(inFlight, limits.inFlightHandshakes, IN_FLIGHT_TTL_MS))
		) {
			return tooMany(socket);
		}

		const leases: Lease[] = [];
		const releaseAll = () => {
			for (const lease of leases.splice(0)) this.release(lease);
		};
		try {
			if (limits.connectionsPerIp) {
				const lease = { key: `ip:${client}`, member: connectionId };
				if (!(await this.claim(lease, limits.connectionsPerIp))) {
					return tooMany(socket);
				}
				leases.push(lease);
			}

			const outcome = await this.core.connect({
				connectionId,
				headers: headersOf(request),
				query: new URL(request.url ?? '/', 'http://localhost').searchParams,
			});
			if (!outcome.accepted) {
				releaseAll();
				return refuse(socket, outcome.status, outcome.statusText);
			}

			const identity = limits.maxConnectionsPer?.(outcome.connection.data);
			if (identity !== undefined) {
				const lease = { key: `identity:${identity}`, member: connectionId };
				leases.push(lease);
				const held = await this.guard(() =>
					this.store.hold(lease.key, lease.member, this.connectionTtl),
				);
				if (held && held.length > limits.maxConnections) {
					if (limits.overflow === 'refuse') {
						releaseAll();
						return tooMany(socket);
					}
					// Its oldest sockets make room, on whichever process holds them.
					const oldest = held
						.filter((id) => id !== connectionId)
						.slice(0, held.length - limits.maxConnections);
					for (const id of oldest) {
						this.release({ key: lease.key, member: id });
					}
					await this.guard(() =>
						this.sink.close(oldest, CLOSE.policy, 'Too many connections'),
					);
				}
			}

			// The client may have gone while the connect handler ran.
			if (socket.destroyed) return releaseAll();

			const opened = leases.splice(0);
			this.wss.handleUpgrade(request, socket, head, (ws) =>
				this.open(ws, outcome.connection, opened),
			);
		} finally {
			if (limits.inFlightHandshakes) this.release(inFlight);
		}
	}

	private open(
		socket: WebSocket,
		connection: Connection,
		leases: Lease[],
	): void {
		const { messagesPerSecond, burst } = this.limits;
		const held: Held = {
			socket,
			connection,
			alive: true,
			leases,
			warned: false,
			...(messagesPerSecond
				? { bucket: new TokenBucket(messagesPerSecond, burst) }
				: {}),
		};
		this.held.set(connection.id, held);
		const write = (payload: string) => this.write(held, payload);

		socket.on('pong', () => {
			held.alive = true;
		});
		socket.on('message', (raw, isBinary) => {
			held.alive = true;
			if (!this.admit(held)) return;
			void this.core.message(
				connection,
				isBinary ? bytesOf(raw) : raw.toString(),
				write,
			);
		});
		socket.on('error', () => socket.terminate());
		socket.on('close', (code, reason) => {
			this.held.delete(connection.id);
			for (const lease of held.leases.splice(0)) this.release(lease);
			void this.core.disconnect(connection, {
				code,
				reason: reason.toString(),
			});
		});
	}

	/**
	 * Whether a frame is within its socket's budget. The first past it is
	 * answered with one `$error`; another before the budget has refilled
	 * closes the socket with 1008.
	 */
	private admit(held: Held): boolean {
		const { bucket } = held;
		if (!bucket) return true;
		if (bucket.take()) {
			if (held.warned && bucket.full) held.warned = false;
			return true;
		}
		if (held.socket.readyState !== held.socket.OPEN) return false;
		if (held.warned) {
			held.socket.close(CLOSE.policy, 'Too many messages');
			return false;
		}
		held.warned = true;
		this.write(
			held,
			this.core.frame.encode('$error', {
				message:
					`Too many messages: at most ${this.limits.messagesPerSecond} a ` +
					`second, ${this.limits.burst} at once. Frames are dropped until ` +
					'the socket slows down, and it is closed if it keeps sending.',
			}),
		);
		return false;
	}

	/**
	 * Take a place in `lease`'s count — or none, when that would put it past
	 * `max`. A store that cannot be reached lets the handshake through.
	 */
	private async claim(
		lease: Lease,
		max: number,
		ttlMs = this.connectionTtl,
	): Promise<boolean> {
		const held = await this.guard(() =>
			this.store.hold(lease.key, lease.member, ttlMs),
		);
		if (!held || held.length <= max) return true;
		this.release(lease);
		return false;
	}

	private release(lease: Lease): void {
		void this.guard(() => this.store.release(lease.key, lease.member));
	}

	/**
	 * How long a socket's place in a count outlives its process, should it
	 * die without giving it back: three heartbeats, each of which renews it.
	 */
	private get connectionTtl(): number {
		return this.heartbeatMs * 3;
	}

	/** The store's answer — or nothing, logged, when it fails. */
	private async guard<T>(call: () => Promise<T>): Promise<T | undefined> {
		try {
			return await call();
		} catch (err) {
			this.options.logger?.warn(
				{ err },
				'WebSocket limit store failed; the limit was not applied',
			);
			return undefined;
		}
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

	/**
	 * Drop every socket that missed the last ping, and ping the rest — whose
	 * places in the limits' counts are renewed.
	 */
	private beat(): void {
		const renewed: Lease[] = [];
		for (const [id, held] of this.held) {
			if (!held.alive) {
				held.socket.terminate();
				this.held.delete(id);
				continue;
			}
			held.alive = false;
			held.socket.ping();
			renewed.push(...held.leases);
		}
		if (renewed.length > 0) {
			void this.guard(() => this.store.renew(renewed, this.connectionTtl));
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

function refuse(
	socket: Duplex,
	status: number,
	message: string,
	headers: Record<string, string> = {},
): void {
	if (!socket.destroyed) {
		const extra = Object.entries(headers)
			.map(([name, value]) => `${name}: ${value}\r\n`)
			.join('');
		socket.end(
			`HTTP/1.1 ${status} ${message}\r\n${extra}Connection: close\r\nContent-Length: 0\r\n\r\n`,
		);
	}
}

/** 429 — with when to come back, where a window says. */
function tooMany(socket: Duplex, retryAfterMs?: number): void {
	refuse(
		socket,
		429,
		'Too Many Requests',
		retryAfterMs === undefined
			? {}
			: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))) },
	);
}
