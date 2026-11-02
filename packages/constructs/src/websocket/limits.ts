/**
 * What one client may ask of a WebSocket surface: how fast it opens
 * handshakes, how many it has in flight, how many sockets it holds, and how
 * fast each socket sends.
 *
 * The Node adaptor enforces them around the core — nothing here is the
 * surface's logic. A client is its address; a handshake, an open socket and
 * an identity's sockets are counted in a {@link WebSocketLimitStore}, which on
 * the Redis transport is that same Redis, so a limit holds across every
 * replica of the surface rather than per process. A socket's message rate is
 * its own, and is counted where the socket is.
 */

import type { IncomingMessage } from 'node:http';
import { isPrivateAddress } from '../privateAddress';

/** Close codes the limits close a socket with. */
export const LIMIT_CLOSE = {
	/** Policy violation: it kept sending past its rate, or its identity has too many sockets. */
	policy: 1008,
} as const;

/**
 * What one client may ask of the surface. Every limit is on by default; set
 * one to `false` to lift it.
 */
export interface WebSocketLimits<TData = Record<string, unknown>> {
	/**
	 * Handshakes one client address may start in a minute, across every
	 * replica. Past it, an upgrade is answered 429 with `Retry-After` before
	 * the connect handler — and the session lookup it makes — runs.
	 * Default 120.
	 */
	handshakesPerMinute?: number | false;
	/**
	 * Handshakes one client address may have in flight at once — waiting on
	 * the connect handler. Past it, 429. Default 16.
	 */
	inFlightHandshakes?: number | false;
	/**
	 * Open sockets one client address may hold, across every replica. Past
	 * it, a new upgrade is answered 429. Default 256: many people share an
	 * address behind a NAT.
	 */
	connectionsPerIp?: number | false;
	/**
	 * Frames one socket may send a second, refilled continuously. Past it, a
	 * frame is dropped and the socket is sent one `$error`; if it keeps
	 * sending before its budget refills, it is closed with 1008. Default 50.
	 */
	messagesPerSecond?: number | false;
	/** Frames a socket may send at once before the rate applies. Default 100. */
	burst?: number;
	/**
	 * Who a connection is, for {@link maxConnections}: a key read from what
	 * the connect handler returned — `(data) => data.userId`. Absent, or
	 * `undefined` for a connection, its sockets are not counted per identity.
	 */
	maxConnectionsPer?: (data: TData) => string | undefined;
	/**
	 * Sockets one identity may hold, across every replica. Default 16, and
	 * only with {@link maxConnectionsPer}.
	 */
	maxConnections?: number;
	/**
	 * What a socket over {@link maxConnections} does: `'refuse'` answers the
	 * new upgrade 429; `'closeOldest'` lets it in and closes that identity's
	 * oldest sockets with 1008 — a user who opened a new tab keeps it.
	 * Default `'refuse'`.
	 */
	overflow?: 'refuse' | 'closeOldest';
}

/** The limits with every default filled in; `undefined` is off. */
export interface ResolvedWebSocketLimits {
	handshakesPerMinute?: number;
	inFlightHandshakes?: number;
	connectionsPerIp?: number;
	messagesPerSecond?: number;
	burst: number;
	maxConnectionsPer?: (data: Record<string, unknown>) => string | undefined;
	maxConnections: number;
	overflow: 'refuse' | 'closeOldest';
}

export const DEFAULT_WEBSOCKET_LIMITS = {
	handshakesPerMinute: 120,
	inFlightHandshakes: 16,
	connectionsPerIp: 256,
	messagesPerSecond: 50,
	burst: 100,
	maxConnections: 16,
} as const;

/** A limit that is not a whole number of at least one. */
export class InvalidWebSocketLimit extends Error {
	constructor(
		readonly surface: string,
		readonly limit: string,
		readonly value: unknown,
	) {
		super(
			`${surface} sets limits.${limit} to ${String(value)}. A limit is a whole number of 1 or more — or false, to lift it.`,
		);
		this.name = 'InvalidWebSocketLimit';
	}
}

/**
 * Fill in the defaults.
 *
 * @throws {InvalidWebSocketLimit} for a limit that is not a positive integer.
 */
export function resolveLimits(
	surface: string,
	limits: WebSocketLimits<any> = {},
): ResolvedWebSocketLimits {
	const pick = (
		name: keyof typeof DEFAULT_WEBSOCKET_LIMITS,
		value: number | false | undefined,
	): number | undefined => {
		if (value === false) return undefined;
		const resolved = value ?? DEFAULT_WEBSOCKET_LIMITS[name];
		if (!Number.isInteger(resolved) || resolved < 1) {
			throw new InvalidWebSocketLimit(surface, name, value);
		}
		return resolved;
	};
	const messagesPerSecond = pick('messagesPerSecond', limits.messagesPerSecond);
	return {
		...optional(
			'handshakesPerMinute',
			pick('handshakesPerMinute', limits.handshakesPerMinute),
		),
		...optional(
			'inFlightHandshakes',
			pick('inFlightHandshakes', limits.inFlightHandshakes),
		),
		...optional(
			'connectionsPerIp',
			pick('connectionsPerIp', limits.connectionsPerIp),
		),
		...optional('messagesPerSecond', messagesPerSecond),
		burst: pick('burst', limits.burst) ?? DEFAULT_WEBSOCKET_LIMITS.burst,
		...(limits.maxConnectionsPer
			? { maxConnectionsPer: limits.maxConnectionsPer }
			: {}),
		maxConnections:
			pick('maxConnections', limits.maxConnections) ??
			DEFAULT_WEBSOCKET_LIMITS.maxConnections,
		overflow: limits.overflow ?? 'refuse',
	};
}

function optional<K extends string>(
	key: K,
	value: number | undefined,
): Partial<Record<K, number>> {
	return value === undefined ? {} : ({ [key]: value } as Record<K, number>);
}

/**
 * Where a surface's limits are counted. Every replica of a surface must see
 * the same store for a limit to hold across them: the Redis transport's own
 * Redis, or — in one process — memory.
 */
export interface WebSocketLimitStore {
	/**
	 * Count one more hit in the window `key` names, opening a window of
	 * `windowMs` on the first. Atomic: concurrent handshakes are each counted.
	 */
	hit(
		key: string,
		windowMs: number,
	): Promise<{ count: number; resetMs: number }>;
	/**
	 * Hold `member` in the set `key` until `ttlMs` from now — or until
	 * {@link release}d — and return every member still held, oldest first.
	 * A member a dead process never released lapses when its time is up.
	 */
	hold(key: string, member: string, ttlMs: number): Promise<string[]>;
	/** Let `member` go. */
	release(key: string, member: string): Promise<void>;
	/** Hold each of `held` for another `ttlMs`. */
	renew(
		held: readonly { key: string; member: string }[],
		ttlMs: number,
	): Promise<void>;
}

/**
 * In one process. Two servers on one `memory://` channel — replicas in a
 * test — share it, as they share the channel.
 */
export class MemoryLimitStore implements WebSocketLimitStore {
	private readonly windows = new Map<
		string,
		{ count: number; resetAt: number }
	>();
	/** key → member → [opened, expires] */
	private readonly sets = new Map<string, Map<string, [number, number]>>();

	async hit(
		key: string,
		windowMs: number,
	): Promise<{ count: number; resetMs: number }> {
		const now = Date.now();
		let window = this.windows.get(key);
		if (!window || window.resetAt <= now) {
			window = { count: 0, resetAt: now + windowMs };
			this.windows.set(key, window);
		}
		window.count++;
		return { count: window.count, resetMs: window.resetAt - now };
	}

	async hold(key: string, member: string, ttlMs: number): Promise<string[]> {
		const now = Date.now();
		let set = this.sets.get(key);
		if (!set) {
			set = new Map();
			this.sets.set(key, set);
		}
		for (const [held, [, expires]] of set) {
			if (expires <= now) set.delete(held);
		}
		const opened = set.get(member)?.[0] ?? now;
		set.set(member, [opened, now + ttlMs]);
		return [...set].sort((a, b) => a[1][0] - b[1][0]).map(([held]) => held);
	}

	async release(key: string, member: string): Promise<void> {
		const set = this.sets.get(key);
		set?.delete(member);
		if (set?.size === 0) this.sets.delete(key);
	}

	async renew(
		held: readonly { key: string; member: string }[],
		ttlMs: number,
	): Promise<void> {
		const expires = Date.now() + ttlMs;
		for (const { key, member } of held) {
			const entry = this.sets.get(key)?.get(member);
			if (entry) entry[1] = expires;
		}
	}
}

/** The subset of an ioredis client the Redis store uses. */
export interface RedisEvalClient {
	eval(
		script: string,
		numKeys: number,
		...args: (string | number)[]
	): Promise<unknown>;
}

// A fixed window: the first hit opens it.
const HIT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

// A sorted set scored by expiry. The member carries when it was opened, so
// "oldest" survives renewal, which rescores it.
const HOLD = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
return redis.call('ZRANGE', KEYS[1], 0, -1)
`;

const RENEW = `
for i, key in ipairs(KEYS) do
  redis.call('ZADD', key, 'XX', ARGV[1], ARGV[i + 2])
  redis.call('PEXPIRE', key, ARGV[2])
end
return 0
`;

/**
 * Over Redis — the transport's own — so every replica counts in one place.
 * Each operation is one script, so concurrent handshakes on any replica are
 * each counted.
 */
export class RedisLimitStore implements WebSocketLimitStore {
	/** member as handed in → member as stored, with its opening time. */
	private readonly stored = new Map<string, string>();

	constructor(
		private readonly client: RedisEvalClient,
		private readonly prefix: string,
	) {}

	private key(key: string): string {
		return `${this.prefix}:limits:${key}`;
	}

	private storedAs(key: string, member: string): string {
		const id = `${key}\n${member}`;
		let stored = this.stored.get(id);
		if (!stored) {
			stored = `${Date.now().toString(36).padStart(9, '0')}|${member}`;
			this.stored.set(id, stored);
		}
		return stored;
	}

	async hit(
		key: string,
		windowMs: number,
	): Promise<{ count: number; resetMs: number }> {
		const [count, resetMs] = (await this.client.eval(
			HIT,
			1,
			this.key(key),
			windowMs,
		)) as [number, number];
		return { count: Number(count), resetMs: Number(resetMs) };
	}

	async hold(key: string, member: string, ttlMs: number): Promise<string[]> {
		const now = Date.now();
		const members = (await this.client.eval(
			HOLD,
			1,
			this.key(key),
			now,
			now + ttlMs,
			this.storedAs(key, member),
			ttlMs,
		)) as string[];
		return members
			.sort()
			.map((stored) => stored.slice(stored.indexOf('|') + 1));
	}

	async release(key: string, member: string): Promise<void> {
		const id = `${key}\n${member}`;
		const stored = this.stored.get(id);
		this.stored.delete(id);
		if (!stored) return;
		await this.client.eval(
			"return redis.call('ZREM', KEYS[1], ARGV[1])",
			1,
			this.key(key),
			stored,
		);
	}

	async renew(
		held: readonly { key: string; member: string }[],
		ttlMs: number,
	): Promise<void> {
		const known = held.flatMap(({ key, member }) => {
			const stored = this.stored.get(`${key}\n${member}`);
			return stored ? [{ key: this.key(key), stored }] : [];
		});
		if (known.length === 0) return;
		await this.client.eval(
			RENEW,
			known.length,
			...known.map(({ key }) => key),
			Date.now() + ttlMs,
			ttlMs,
			...known.map(({ stored }) => stored),
		);
	}
}

/**
 * A socket's inbound budget: `burst` frames at once, refilled at `rate` a
 * second.
 */
export class TokenBucket {
	private tokens: number;
	private at = Date.now();

	constructor(
		private readonly rate: number,
		private readonly burst: number,
	) {
		this.tokens = burst;
	}

	/** Spend one token, if there is one. */
	take(now = Date.now()): boolean {
		this.tokens = Math.min(
			this.burst,
			this.tokens + ((now - this.at) / 1000) * this.rate,
		);
		this.at = now;
		if (this.tokens < 1) return false;
		this.tokens -= 1;
		return true;
	}

	/** Whether it has refilled completely since it last ran dry. */
	get full(): boolean {
		return this.tokens >= this.burst - 1;
	}
}

/**
 * The client a handshake is counted against. Behind the stack's edge — a
 * private peer — the address the edge put last in `X-Forwarded-For`, the one
 * it saw; Traefik and Caddy both replace what an outside client sent there.
 * From anywhere else, the peer itself: a header a client could set never
 * picks the bucket it is counted in.
 */
export function clientAddress(request: IncomingMessage): string {
	const peer = request.socket.remoteAddress ?? 'unknown';
	const forwarded = request.headers['x-forwarded-for'];
	if (!forwarded || !isPrivateAddress(peer)) return peer;
	const chain = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded)
		.split(',')
		.map((hop) => hop.trim())
		.filter(Boolean);
	return chain.at(-1) ?? peer;
}
