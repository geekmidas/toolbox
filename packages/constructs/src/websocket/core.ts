/**
 * A WebSocket surface with no socket in it.
 *
 * Everything a surface does that is not the transport: which route answers
 * an action, a frame decoded and checked against its route's `body`, the
 * connect handler's verdict and the `data` it keeps, the disconnect handler,
 * each handler's services and `sockets`. A runtime — an adaptor — owns the
 * socket, or the absence of one, and calls in with a connection id:
 *
 * - Node (`WebSocketSurfaceServer`) upgrades on its HTTP server, holds the
 *   sockets, pings them and writes what the core hands back;
 * - API Gateway accepts the socket itself, and a Lambda calls `connect()`,
 *   `message()` and `disconnect()` per event;
 * - a test calls them directly.
 *
 * What reaches a socket from a handler goes through `sockets`, a publisher
 * over the adaptor's `WebSocketSink`.
 */

import type { EnvironmentParser } from '@geekmidas/envkit';
import { HttpError } from '@geekmidas/errors';
import type { Logger } from '@geekmidas/logger';
import { runWithRequestContext, ServiceDiscovery } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Authenticator } from '../construct-interface';
import { FrameShape, type WebSocketFrame } from './frame';
import {
	type NoMessages,
	type WebSocketMessages,
	WebSocketPublisher,
	type WebSocketSink,
} from './publisher';
import type { Connection, WebSocketRoute } from './route';

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

export interface WebSocketCoreOptions<
	TMessages extends WebSocketMessages = NoMessages,
> {
	surface: string;
	/** Every route handed in; those built from another surface are skipped. */
	routes: readonly WebSocketRoute[];
	/** What the surface sends its sockets — see `WebSocketApiConfig.messages`. */
	messages?: TMessages;
	/** The shape its frames take — see `WebSocketApiConfig.frame`. */
	frame?: WebSocketFrame;
	/** Where `sockets` sends, in every handler: the adaptor's own. */
	sink: WebSocketSink;
	envParser: EnvironmentParser<{}>;
	logger: Logger;
	/** What turns a handshake's headers into the `session` connect sees. */
	authenticator?: Authenticator;
}

/** A handshake, as the adaptor that received it saw it. */
export interface ConnectRequest {
	/** The id the adaptor gives the connection — sends address it by this. */
	connectionId: string;
	headers: Headers;
	query: URLSearchParams;
	/**
	 * Whose connection it is, when the adaptor already knows (a test).
	 * Absent, the surface's authenticator verifies `headers`; `null` is no
	 * session.
	 */
	session?: unknown;
}

/**
 * For one call: services to use in place of registering them — a test's
 * transaction for `database`. Only those the route depends on are handed in.
 */
export interface WebSocketCallOptions {
	services?: Record<string, unknown>;
}

/** Whether a handshake may become a connection. */
export type ConnectOutcome =
	| { accepted: true; connection: Connection }
	| {
			accepted: false;
			/** The status a refused upgrade answers with: the `HttpError`'s, or 500. */
			status: number;
			statusText: string;
			/** What the connect handler, or the authenticator, threw. */
			error: unknown;
	  };

/** Writes one serialised frame to the connection a message arrived on. */
export type WriteFrame = (payload: string) => void;

/** What became of one inbound frame. Whatever it wrote went through `write`. */
export type MessageOutcome =
	| {
			ok: true;
			action: string;
			id?: string | number;
			/** The handler's return — sent back as the reply when defined. */
			returned: unknown;
	  }
	| {
			ok: false;
			/** Absent when the frame named no action. */
			action?: string;
			id?: string | number;
			/** What the `$error` frame said. */
			message: string;
			issues?: readonly StandardSchemaV1.Issue[];
			/** What the handler threw, when it got that far. */
			error?: unknown;
	  };

export type DisconnectOutcome = { ok: true } | { ok: false; error: unknown };

export class WebSocketCore<TMessages extends WebSocketMessages = NoMessages> {
	readonly surface: string;
	/** How frames are read and written — what an adaptor decodes replies by. */
	readonly frame: FrameShape;
	/** `sockets` in every handler. */
	readonly sockets: WebSocketPublisher<TMessages>;

	private readonly routes = new Map<string, WebSocketRoute>();
	private readonly lifecycle: {
		connect?: WebSocketRoute;
		disconnect?: WebSocketRoute;
	} = {};

	/**
	 * @throws {DuplicateWebSocketRoute} when two routes answer one action, and
	 *   the frame checks of `FrameShape.check` for declared messages.
	 */
	constructor(private readonly options: WebSocketCoreOptions<TMessages>) {
		this.surface = options.surface;
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

		this.frame = new FrameShape(options.surface, options.frame?.discriminator);
		if (options.messages) this.frame.check(options.messages);
		this.sockets = new WebSocketPublisher<TMessages>(
			options.sink,
			options.messages
				? { surface: options.surface, messages: options.messages }
				: undefined,
			this.frame,
		);
	}

	/**
	 * Run the connect handler for a handshake: accepted with the connection's
	 * `data` (what the handler returned, `{}` for nothing), or refused with
	 * the status of the `HttpError` it threw — 500 for anything else. A surface
	 * with no connect handler accepts every handshake, and verifies no session.
	 */
	async connect(
		request: ConnectRequest,
		options: WebSocketCallOptions = {},
	): Promise<ConnectOutcome> {
		const { connectionId, headers, query } = request;
		const route = this.lifecycle.connect;
		if (!route)
			return { accepted: true, connection: { id: connectionId, data: {} } };

		try {
			const session =
				'session' in request
					? request.session
					: this.options.authenticator
						? await this.options.authenticator.verify(
								headers,
								this.options.envParser,
							)
						: null;
			const returned = await this.run(
				route,
				connectionId,
				(base) => ({ ...base, connectionId, headers, query, session }),
				options,
			);
			const data =
				returned && typeof returned === 'object'
					? (returned as Record<string, unknown>)
					: {};
			return { accepted: true, connection: { id: connectionId, data } };
		} catch (error) {
			if (error instanceof HttpError) {
				return {
					accepted: false,
					status: error.statusCode,
					statusText: error.statusMessage,
					error,
				};
			}
			this.options.logger.error(
				{ err: error, connectionId },
				'WebSocket connect handler failed',
			);
			return {
				accepted: false,
				status: 500,
				statusText: 'Internal Server Error',
				error,
			};
		}
	}

	/**
	 * Parse, validate and run one inbound frame. The reply — the handler's
	 * return, encoded — and every `$error` are written with `write`; an error
	 * is a frame, never a close. A binary frame is refused: frames are text.
	 */
	async message(
		connection: Connection,
		raw: string | Uint8Array,
		write: WriteFrame,
		options: WebSocketCallOptions = {},
	): Promise<MessageOutcome> {
		if (typeof raw !== 'string') {
			return this.error(write, {}, 'Frames are JSON text.');
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return this.error(write, {}, 'Frames are JSON.');
		}
		const frame = this.frame.decode(parsed);
		if (!frame) {
			return this.error(
				write,
				{ id: this.frame.idOf(parsed) },
				`A frame names its \`${this.frame.key}\`.`,
			);
		}

		const { action, id } = frame;
		const route = this.routes.get(action) ?? this.routes.get('$default');
		if (!route) {
			return this.error(write, { action, id }, `No route answers '${action}'.`);
		}

		let body = frame.data;
		if (route.schema) {
			const result = await route.schema['~standard'].validate(frame.data);
			if (result.issues) {
				return this.error(
					write,
					{ action, id },
					'The frame was invalid.',
					result.issues,
				);
			}
			body = result.value;
		}

		try {
			const returned = await this.run(
				route,
				connection.id,
				(base) => ({
					...base,
					connection,
					body,
					reply: (message: unknown) => write(JSON.stringify(message)),
				}),
				options,
			);
			if (returned !== undefined) {
				write(this.frame.encode(action, returned, id));
			}
			return {
				ok: true,
				action,
				...(id !== undefined ? { id } : {}),
				returned,
			};
		} catch (error) {
			if (error instanceof HttpError) {
				return this.error(
					write,
					{ action, id },
					error.message,
					undefined,
					error,
				);
			}
			this.options.logger.error(
				{ err: error, connectionId: connection.id, action },
				'WebSocket route failed',
			);
			return this.error(
				write,
				{ action, id },
				'The route failed.',
				undefined,
				error,
			);
		}
	}

	/**
	 * Run the disconnect handler for a connection that has closed. What it
	 * throws is logged and returned, never thrown: the socket is gone either
	 * way.
	 */
	async disconnect(
		connection: Connection,
		close: { code: number; reason: string },
		options: WebSocketCallOptions = {},
	): Promise<DisconnectOutcome> {
		const route = this.lifecycle.disconnect;
		if (!route) return { ok: true };
		try {
			await this.run(
				route,
				connection.id,
				(base) => ({ ...base, connection, ...close }),
				options,
			);
			return { ok: true };
		} catch (error) {
			this.options.logger.error(
				{ err: error, connectionId: connection.id },
				'WebSocket disconnect handler failed',
			);
			return { ok: false, error };
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
		options: WebSocketCallOptions,
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
				const services = await this.services(route, options.services);
				return (route.handler as (context: object) => unknown)(
					context({ services, logger, sockets: this.sockets }),
				);
			},
		);
	}

	/** The route's services: the overrides it names, the rest registered. */
	private async services(
		route: WebSocketRoute,
		overrides: Record<string, unknown> = {},
	): Promise<Record<string, unknown>> {
		const given: Record<string, unknown> = {};
		const wanted = route.services.filter((service) => {
			if (!Object.hasOwn(overrides, service.serviceName)) return true;
			given[service.serviceName] = overrides[service.serviceName];
			return false;
		});
		const registered = wanted.length
			? await ServiceDiscovery.getInstance(this.options.envParser).register([
					...wanted,
				])
			: {};
		return { ...registered, ...given };
	}

	private error(
		write: WriteFrame,
		at: { action?: string; id?: string | number },
		message: string,
		issues?: readonly StandardSchemaV1.Issue[],
		error?: unknown,
	): MessageOutcome {
		write(
			this.frame.encode(
				'$error',
				{ message, ...(issues ? { issues } : {}) },
				at.id,
			),
		);
		return {
			ok: false,
			...(at.action !== undefined ? { action: at.action } : {}),
			...(at.id !== undefined ? { id: at.id } : {}),
			message,
			...(issues ? { issues } : {}),
			...(error !== undefined ? { error } : {}),
		};
	}
}
