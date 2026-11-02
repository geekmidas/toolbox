/**
 * The Test adaptor: a surface's routes called directly, with no server and
 * no socket — what `route.request()` and `surface.testPublisher()` are built
 * on.
 *
 * A route's `request()` builds a core over just that route and calls
 * `connect()`, `message()` or `disconnect()` on it, as the Node adaptor does
 * for a socket. What its handler sends through `sockets` goes to a recording
 * publisher, the same one `surface.testPublisher()` hands an endpoint's spec.
 */

import type { EnvironmentParser } from '@geekmidas/envkit';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { WebSocketCore } from './core';
import type { FrameShape } from './frame';
import {
	type NoMessages,
	type WebSocketMessages,
	WebSocketPublisher,
	type WebSocketSink,
} from './publisher';
import type { Connection, WebSocketRoute } from './route';

/** One recorded message: its action and data, and the frame on the wire. */
export type RecordedMessage<TMessages extends WebSocketMessages = NoMessages> =
	[keyof TMessages] extends [never]
		? { action: string; data: unknown; frame: Record<string, unknown> }
		: {
				[A in keyof TMessages & string]: {
					action: A;
					/** As its schema returned it — what the client receives. */
					data: StandardSchemaV1.InferOutput<TMessages[A]>;
					/** The frame as the client parses it — the wire shape. */
					frame: Record<string, unknown>;
				};
			}[keyof TMessages & string];

/** A `send(ids, …)`, as it was recorded. */
export type RecordedSend<TMessages extends WebSocketMessages = NoMessages> =
	RecordedMessage<TMessages> & { ids: string[] };

/** A `broadcast(…)`, as it was recorded. */
export type RecordedBroadcast<
	TMessages extends WebSocketMessages = NoMessages,
> = RecordedMessage<TMessages> & { except: string[] };

/** A `close(ids, code, reason)`, as it was recorded. */
export interface RecordedClose {
	ids: string[];
	code: number;
	reason: string;
}

/**
 * A sink that keeps what it is handed, decoded by the surface's frame shape,
 * and sends it nowhere.
 */
export class RecordingSink implements WebSocketSink {
	readonly sent: RecordedSend<any>[] = [];
	readonly broadcasts: RecordedBroadcast<any>[] = [];
	readonly closed: RecordedClose[] = [];

	constructor(private readonly frame: FrameShape) {}

	async send(ids: readonly string[], payload: string): Promise<void> {
		this.sent.push({ ids: [...ids], ...this.decode(payload) });
	}

	async broadcast(payload: string, except?: readonly string[]): Promise<void> {
		this.broadcasts.push({
			except: [...(except ?? [])],
			...this.decode(payload),
		});
	}

	async close(
		ids: readonly string[],
		code: number,
		reason: string,
	): Promise<void> {
		this.closed.push({ ids: [...ids], code, reason });
	}

	clear(): void {
		this.sent.length = 0;
		this.broadcasts.length = 0;
		this.closed.length = 0;
	}

	private decode(payload: string): RecordedMessage {
		const frame = JSON.parse(payload) as Record<string, unknown>;
		// A publisher only ever hands over a frame it encoded itself.
		const { action, data } = this.frame.decode(frame)!;
		return { action, data, frame };
	}
}

/**
 * A surface's publisher that records rather than sends — what
 * `surface.testPublisher()` returns, of the type `services.<surface>` is.
 *
 * Every send is still checked by the declared `messages` and encoded by the
 * surface's `frame`, so an invalid push fails the spec as it would fail
 * deployed, and `frame` on each record is what the client would parse.
 */
export class TestWebSocketPublisher<
	TMessages extends WebSocketMessages = NoMessages,
> extends WebSocketPublisher<TMessages> {
	/** Where the records are kept — what `route.request()` builds its core on. */
	readonly recording: RecordingSink;

	constructor(
		frame: FrameShape,
		declared?: { surface: string; messages: TMessages },
	) {
		const recording = new RecordingSink(frame);
		super(recording, declared, frame);
		this.recording = recording;
	}

	/** Each `send(ids, action, data)`, in order. */
	get sent(): readonly RecordedSend<TMessages>[] {
		return this.recording.sent;
	}

	/** Each `broadcast(action, data, { except })`, in order. */
	get broadcasts(): readonly RecordedBroadcast<TMessages>[] {
		return this.recording.broadcasts;
	}

	/** Each `close(ids, code, reason)`, in order. */
	get closed(): readonly RecordedClose[] {
		return this.recording.closed;
	}

	/** Forget everything recorded so far. */
	clear(): void {
		this.recording.clear();
	}
}

/** A frame `route.request()` sent was refused before its handler ran. */
export class InvalidWebSocketRequest extends Error {
	constructor(
		readonly surface: string,
		readonly action: string,
		/** What the `$error` frame said. */
		readonly reason: string,
		readonly issues?: readonly StandardSchemaV1.Issue[],
	) {
		super(
			`${surface}'s '${action}' route refused the request: ${reason}${
				issues?.length
					? ` ${issues.map((issue) => issue.message).join('; ')}.`
					: ''
			} Send a body its schema accepts.`,
		);
		this.name = 'InvalidWebSocketRequest';
	}
}

/** What a surface hands its routes' `request()`. */
export interface WebSocketTestSurface {
	readonly id: string;
	core(options: {
		envParser: EnvironmentParser<{}>;
		sink: WebSocketSink;
		modules?: readonly object[];
	}): WebSocketCore<any>;
	readonly envParser: EnvironmentParser<{}>;
	testPublisher(): TestWebSocketPublisher<any>;
}

/** Overrides every `request()` takes. */
export interface WebSocketTestCallOptions {
	/**
	 * Instances for the route's dependencies, by service name — a test's
	 * transaction for `database`. Any it depends on and is not handed here is
	 * registered, as deployed.
	 */
	services?: Record<string, unknown>;
	/**
	 * The handler's `sockets`. Pass `surface.testPublisher()` to assert what
	 * it sent; absent, a fresh one that nobody reads.
	 */
	sockets?: TestWebSocketPublisher<any>;
}

export interface TestConnectRequest extends WebSocketTestCallOptions {
	/** The id the connection is given. Absent, `test.<n>`. */
	connectionId?: string;
	/** The handshake's headers — what `.auth()` verifies without a `session`. */
	headers?: ConstructorParameters<typeof Headers>[0];
	/** The upgrade URL's query. */
	query?: string | Record<string, string> | URLSearchParams;
	/**
	 * What the surface's `.auth()` would have resolved — `null` for no
	 * session. Absent, `.auth()` verifies `headers`, as on a real upgrade.
	 */
	session?: unknown;
}

export interface TestMessageRequest<TBody = unknown>
	extends WebSocketTestCallOptions {
	/** The connection the frame arrives on. Absent, `test.<n>` with no data. */
	connection?: TestConnection;
	/** The frame's data — checked by the route's `body`, as a frame's is. */
	body: TBody;
	/** The frame's `id`, echoed on its reply. Only `{ action, data }` frames. */
	id?: string | number;
}

export interface TestDisconnectRequest extends WebSocketTestCallOptions {
	/** The connection that closed. Absent, `test.<n>` with no data. */
	connection?: TestConnection;
	/** Default 1000. */
	code?: number;
	/** Default ''. */
	reason?: string;
}

/** A connection a test names: either part may be left to its default. */
export interface TestConnection {
	id?: string;
	data?: Record<string, unknown>;
}

/** What a message route's `fullRequest()` resolves with. */
export interface TestMessageResponse<TReturned = unknown> {
	/** The handler's return — the reply, before it was encoded. */
	returned: TReturned;
	/**
	 * Every frame written back to the connection, parsed, in order: each
	 * `reply()` and the reply to the frame itself.
	 */
	frames: unknown[];
}

let issued = 0;

/** A connection id no other test call is using. */
function nextConnectionId(): string {
	issued += 1;
	return `test.${issued}`;
}

function connectionOf(given?: TestConnection): Connection {
	return { id: given?.id ?? nextConnectionId(), data: given?.data ?? {} };
}

function coreFor(
	route: WebSocketRoute<any, any, any, any, any>,
	surface: WebSocketTestSurface,
	sockets: TestWebSocketPublisher<any> | undefined,
): WebSocketCore<any> {
	return surface.core({
		envParser: surface.envParser,
		sink: (sockets ?? surface.testPublisher()).recording,
		modules: [{ route }],
	});
}

/** `connect.request()`: the connection's `data`, or what refused it. */
export async function requestConnect(
	route: WebSocketRoute<any, any, any, any, any>,
	surface: WebSocketTestSurface,
	request: TestConnectRequest = {},
): Promise<Record<string, unknown>> {
	const core = coreFor(route, surface, request.sockets);
	const outcome = await core.connect(
		{
			connectionId: request.connectionId ?? nextConnectionId(),
			headers: new Headers(request.headers),
			query: new URLSearchParams(request.query),
			...('session' in request ? { session: request.session } : {}),
		},
		request.services ? { services: request.services } : {},
	);
	if (!outcome.accepted) throw outcome.error;
	return outcome.connection.data;
}

/** A message route's `fullRequest()`: what it returned and wrote. */
export async function requestMessage(
	route: WebSocketRoute<any, any, any, any, any>,
	surface: WebSocketTestSurface,
	request: TestMessageRequest,
): Promise<TestMessageResponse> {
	const core = coreFor(route, surface, request.sockets);
	const frames: unknown[] = [];
	const outcome = await core.message(
		connectionOf(request.connection),
		core.frame.encode(route.action, request.body, request.id),
		(payload) => frames.push(JSON.parse(payload)),
		request.services ? { services: request.services } : {},
	);
	if (outcome.ok) return { returned: outcome.returned, frames };
	if ('error' in outcome) throw outcome.error;
	throw new InvalidWebSocketRequest(
		surface.id,
		route.action,
		outcome.message,
		outcome.issues,
	);
}

/** `disconnect.request()`: resolves once the handler has run. */
export async function requestDisconnect(
	route: WebSocketRoute<any, any, any, any, any>,
	surface: WebSocketTestSurface,
	request: TestDisconnectRequest = {},
): Promise<void> {
	const core = coreFor(route, surface, request.sockets);
	const outcome = await core.disconnect(
		connectionOf(request.connection),
		{ code: request.code ?? 1000, reason: request.reason ?? '' },
		request.services ? { services: request.services } : {},
	);
	if (!outcome.ok) throw outcome.error;
}
