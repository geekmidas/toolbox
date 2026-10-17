/**
 * How a send reaches the process holding the socket.
 *
 * A connection id names the process it lives on — `<instance>.<n>` — so a send
 * needs no registry: it is published to that instance's channel and nowhere
 * else. A broadcast goes to every instance. On a stack the channels are Redis
 * pub/sub, so an endpoint in another container reaches a socket the same way a
 * route beside it does; in one process (a test, a single dev server) they are
 * a map.
 */

/** What one process is asked to do with the sockets it holds. */
export type Delivery =
	| { kind: 'send'; ids: readonly string[]; payload: string }
	| { kind: 'broadcast'; payload: string; except?: readonly string[] }
	| { kind: 'close'; ids: readonly string[]; code: number; reason: string };

export interface WebSocketTransport {
	/** Deliver to one instance, or to every instance when it is `'*'`. */
	publish(instance: string, delivery: Delivery): Promise<void>;
	/** Receive what is published to `instance`, and every broadcast. */
	subscribe(
		instance: string,
		receive: (delivery: Delivery) => void,
	): Promise<void>;
	close(): Promise<void>;
}

/** Every instance — what a broadcast is published to. */
export const EVERY_INSTANCE = '*';

/** A connection string names no transport this package knows. */
export class UnsupportedWebSocketTransport extends Error {
	constructor(readonly connectionString: string) {
		super(
			`'${redact(connectionString)}' is not a WebSocket publisher connection string. ` +
				'Use redis://, rediss:// or memory:// — gkm composes it as <ID>_PUBLISHER_CONNECTION_STRING.',
		);
		this.name = 'UnsupportedWebSocketTransport';
	}
}

/** The scheme alone, so an error never prints a password. */
function redact(connectionString: string): string {
	const scheme = connectionString.split('://')[0];
	return scheme && scheme !== connectionString
		? `${scheme}://…`
		: connectionString.slice(0, 12);
}

// On globalThis, as the shutdown hooks are: a package loaded as ESM and CJS
// would otherwise hold two maps, and a publisher would talk to the empty one.
const key = Symbol.for('@geekmidas/constructs/websocket/memory');
const registry = globalThis as Record<
	symbol,
	Map<string, Map<string, (delivery: Delivery) => void>> | undefined
>;
registry[key] ??= new Map();
const channels = registry[key];

/**
 * In one process: the server and whoever sends meet in a map, keyed by the
 * channel the connection string names.
 */
export class MemoryTransport implements WebSocketTransport {
	private readonly subscribed = new Set<string>();

	constructor(private readonly channel: string) {}

	async publish(instance: string, delivery: Delivery): Promise<void> {
		const instances = channels.get(this.channel);
		if (!instances) return;
		if (instance === EVERY_INSTANCE) {
			for (const receive of instances.values()) receive(delivery);
			return;
		}
		instances.get(instance)?.(delivery);
	}

	async subscribe(
		instance: string,
		receive: (delivery: Delivery) => void,
	): Promise<void> {
		let instances = channels.get(this.channel);
		if (!instances) {
			instances = new Map();
			channels.set(this.channel, instances);
		}
		instances.set(instance, receive);
		this.subscribed.add(instance);
	}

	async close(): Promise<void> {
		const instances = channels.get(this.channel);
		for (const instance of this.subscribed) instances?.delete(instance);
		this.subscribed.clear();
	}
}

/** The subset of an ioredis client the transport uses. */
interface RedisClient {
	publish(channel: string, message: string): Promise<number>;
	subscribe(...channels: string[]): Promise<unknown>;
	on(
		event: 'message',
		listener: (channel: string, message: string) => void,
	): unknown;
	duplicate(): RedisClient;
	quit(): Promise<unknown>;
}

/**
 * Over Redis pub/sub: one channel per instance and one for broadcasts, under
 * a prefix that keeps two surfaces — or two projects on one Redis — apart.
 * Channels are not scoped by database index, so the prefix is what does it.
 *
 * Publishing and subscribing take separate connections, because a connection
 * that has subscribed can do nothing else.
 */
export class RedisTransport implements WebSocketTransport {
	private subscriber?: RedisClient;
	private closed?: Promise<void>;

	constructor(
		private readonly client: RedisClient,
		private readonly prefix: string,
	) {}

	private channel(instance: string): string {
		return `${this.prefix}:${instance}`;
	}

	async publish(instance: string, delivery: Delivery): Promise<void> {
		await this.client.publish(this.channel(instance), JSON.stringify(delivery));
	}

	async subscribe(
		instance: string,
		receive: (delivery: Delivery) => void,
	): Promise<void> {
		const subscriber = this.client.duplicate();
		this.subscriber = subscriber;
		const own = this.channel(instance);
		const every = this.channel(EVERY_INSTANCE);
		subscriber.on('message', (channel, message) => {
			if (channel !== own && channel !== every) return;
			receive(JSON.parse(message) as Delivery);
		});
		await subscriber.subscribe(own, every);
	}

	/** Idempotent: the server and a shutdown hook may both close it. */
	close(): Promise<void> {
		this.closed ??= Promise.all([
			this.subscriber?.quit(),
			this.client.quit(),
		]).then(() => undefined);
		return this.closed;
	}
}

/**
 * The transport a connection string names.
 *
 * `redis://` and `rediss://` take an optional `channel` query parameter, the
 * prefix every channel is named under; `memory://<channel>` is in-process.
 * Absent, the channel is `fallback` — the surface's own.
 */
export async function transportFromConnectionString(
	connectionString: string,
	fallback: string,
): Promise<WebSocketTransport> {
	// Not parsed as a URL: a channel is `gkm:ws:<id>`, colons and all.
	if (connectionString.startsWith('memory://')) {
		return new MemoryTransport(
			connectionString.slice('memory://'.length) || fallback,
		);
	}

	const url = URL.canParse(connectionString)
		? new URL(connectionString)
		: undefined;
	if (!url) throw new UnsupportedWebSocketTransport(connectionString);

	if (url.protocol === 'redis:' || url.protocol === 'rediss:') {
		const channel = url.searchParams.get('channel') || fallback;
		url.searchParams.delete('channel');
		const { Redis } = await import('ioredis');
		const client = new Redis(url.toString(), {
			// A publish while Redis restarts waits for it rather than failing the
			// request that sent it.
			maxRetriesPerRequest: null,
			lazyConnect: false,
		});
		return new RedisTransport(client as unknown as RedisClient, channel);
	}

	throw new UnsupportedWebSocketTransport(connectionString);
}
