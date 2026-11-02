// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { REDIS_PORT } from '../../../../testkit/test/ports';
import { WebSocketApi, type WebSocketApiConfig } from '../../websocket-api';
import {
	clientAddress,
	InvalidWebSocketLimit,
	MemoryLimitStore,
	resolveLimits,
	TokenBucket,
} from '../limits';
import { CLOSE } from '../server';

const silent = {
	debug() {},
	info() {},
	warn() {},
	error() {},
	fatal() {},
	trace() {},
	child: () => silent,
} as unknown as Logger;

const running: { close(): Promise<void> }[] = [];

afterEach(async () => {
	await Promise.all(running.splice(0).map((r) => r.close()));
});

/** Serve `surface` on port 0, as the generated entry does. */
async function serve(
	surface: WebSocketApi<string, any>,
	modules: object[] = [],
	env: Record<string, string> = {},
): Promise<{ url: string; size(): number }> {
	const { attach, server } = await surface.server({
		envParser: new EnvironmentParser(env),
		context: undefined as never,
		modules,
	});
	const http: Server = createServer((_req, res) => res.end());
	attach(http);
	await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
	const { port } = http.address() as AddressInfo;
	running.push({
		async close() {
			await server.close();
			await new Promise<void>((resolve) => http.close(() => resolve()));
		},
	});
	return { url: `ws://127.0.0.1:${port}`, size: () => server.size };
}

function surface(
	id: string,
	config: Partial<WebSocketApiConfig> = {},
): WebSocketApi<string> {
	return new WebSocketApi(id, { path: '.', logger: silent, ...config });
}

/** A client address, as the edge in front of the surface names it. */
function from(ip: string): Record<string, string> {
	return { 'x-forwarded-for': ip };
}

interface Client {
	socket: WebSocket;
	next(): Promise<any>;
	send(frame: unknown): void;
	closed: Promise<{ code: number; reason: string }>;
}

async function open(
	url: string,
	headers: Record<string, string> = {},
): Promise<Client> {
	const socket = new WebSocket(url, { headers });
	const frames: unknown[] = [];
	const waiting: ((frame: unknown) => void)[] = [];
	socket.on('message', (raw) => {
		const frame = JSON.parse(raw.toString());
		const resolve = waiting.shift();
		if (resolve) resolve(frame);
		else frames.push(frame);
	});
	const closed = new Promise<{ code: number; reason: string }>((resolve) =>
		socket.on('close', (code, reason) =>
			resolve({ code, reason: reason.toString() }),
		),
	);
	await new Promise<void>((resolve, reject) => {
		socket.once('open', () => resolve());
		socket.once('unexpected-response', (_req, res) =>
			reject(new Error(`refused with ${res.statusCode}`)),
		);
		socket.once('error', reject);
	});
	return {
		socket,
		next: () =>
			frames.length
				? Promise.resolve(frames.shift())
				: new Promise((resolve) => waiting.push(resolve)),
		send: (frame) => socket.send(JSON.stringify(frame)),
		closed,
	};
}

/** The status and headers a refused upgrade answered with. */
function refused(
	url: string,
	headers: Record<string, string> = {},
): Promise<{ status: number; headers: IncomingMessage['headers'] }> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url, { headers });
		socket.once('unexpected-response', (_req, res) =>
			resolve({ status: res.statusCode ?? 0, headers: res.headers }),
		);
		socket.once('open', () => {
			socket.terminate();
			reject(new Error('the upgrade was accepted'));
		});
		socket.once('error', () => {});
	});
}

describe('WebSocketApi limits', () => {
	it('answers a client past its handshakes a minute with 429 and Retry-After', async () => {
		const realtime = surface(`Rate${randomUUID().slice(0, 8)}`, {
			limits: { handshakesPerMinute: 3 },
		});
		const { url } = await serve(realtime);

		for (let i = 0; i < 3; i++) {
			const c = await open(url, from('203.0.113.1'));
			c.socket.close();
		}
		const over = await refused(url, from('203.0.113.1'));
		expect(over.status).toBe(429);
		expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
		expect(Number(over.headers['retry-after'])).toBeLessThanOrEqual(60);

		// Another client has a window of its own.
		await expect(open(url, from('203.0.113.2'))).resolves.toBeDefined();
	});

	it('refuses a handshake past the in-flight cap before its connect handler runs', async () => {
		const realtime = surface('InFlight', {
			limits: { inFlightHandshakes: 2 },
		});
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let ran = 0;
		const connect = realtime.connect().handle(async () => {
			ran++;
			await gate;
		});
		const { url } = await serve(realtime, [{ connect }]);

		const waiting = [open(url), open(url)];
		await expect.poll(() => ran).toBe(2);

		expect((await refused(url)).status).toBe(429);
		expect(ran).toBe(2);

		release();
		await Promise.all(waiting);
		// Answered, they are no longer in flight.
		await expect(open(url)).resolves.toBeDefined();
	});

	it('caps the sockets one client address holds, and frees a place on close', async () => {
		const realtime = surface('PerIp', { limits: { connectionsPerIp: 2 } });
		const { url } = await serve(realtime);

		const first = await open(url, from('198.51.100.7'));
		await open(url, from('198.51.100.7'));
		expect((await refused(url, from('198.51.100.7'))).status).toBe(429);
		await open(url, from('198.51.100.8'));

		first.socket.close();
		await first.closed;
		await expect
			.poll(async () => {
				try {
					(await open(url, from('198.51.100.7'))).socket.close();
					return true;
				} catch {
					return false;
				}
			})
			.toBe(true);
	});

	it('drops frames past the message rate with one $error, then closes with 1008', async () => {
		const realtime = surface('Inbound', {
			limits: { messagesPerSecond: 1, burst: 3 },
		});
		const echo = realtime.route('echo').handle(({ body }) => body);
		const { url } = await serve(realtime, [{ echo }]);
		const c = await open(url);

		for (let i = 0; i < 3; i++) {
			c.send({ action: 'echo', id: i, data: i });
			expect(await c.next()).toEqual({ action: 'echo', id: i, data: i });
		}

		c.send({ action: 'echo', id: 3, data: 3 });
		const error = await c.next();
		expect(error.action).toBe('$error');
		expect(error.data.message).toMatch(/Too many messages/);

		c.send({ action: 'echo', id: 4, data: 4 });
		await expect(c.closed).resolves.toEqual({
			code: CLOSE.policy,
			reason: 'Too many messages',
		});
	});

	it('refuses an identity past maxConnections with 429', async () => {
		const realtime = surface('Identity', {
			limits: {
				maxConnectionsPer: (data) => data.user as string,
				maxConnections: 1,
			},
		});
		const connect = realtime
			.connect()
			.handle(({ query }) => ({ user: query.get('user') }));
		const { url } = await serve(realtime, [{ connect }]);

		await open(`${url}/?user=ada`);
		expect((await refused(`${url}/?user=ada`)).status).toBe(429);
		await expect(open(`${url}/?user=grace`)).resolves.toBeDefined();
	});

	it("closes an identity's oldest socket with 1008 on 'closeOldest'", async () => {
		const realtime = surface('Oldest', {
			limits: {
				maxConnectionsPer: (data) => data.user as string,
				maxConnections: 2,
				overflow: 'closeOldest',
			},
		});
		const connect = realtime
			.connect()
			.handle(({ query }) => ({ user: query.get('user') }));
		const { url } = await serve(realtime, [{ connect }]);

		const first = await open(`${url}/?user=ada`);
		const second = await open(`${url}/?user=ada`);
		const third = await open(`${url}/?user=ada`);

		await expect(first.closed).resolves.toEqual({
			code: CLOSE.policy,
			reason: 'Too many connections',
		});
		expect(second.socket.readyState).toBe(WebSocket.OPEN);
		expect(third.socket.readyState).toBe(WebSocket.OPEN);
	});

	it('refuses an upgrade with no Origin when requireOrigin is set', async () => {
		const realtime = surface('Origins', { requireOrigin: true });
		const { url } = await serve(realtime, [], {
			ORIGINS_TRUSTED_ORIGINS: 'https://app.example.com',
		});

		expect((await refused(url)).status).toBe(403);
		expect(
			(await refused(url, { origin: 'https://evil.example.com' })).status,
		).toBe(403);
		await expect(
			open(url, { origin: 'https://app.example.com' }),
		).resolves.toBeDefined();
	});

	it('lifts a limit set to false', async () => {
		const realtime = surface('Unlimited', {
			limits: { connectionsPerIp: false, handshakesPerMinute: false },
		});
		const { url, size } = await serve(realtime);
		await Promise.all(Array.from({ length: 5 }, () => open(url)));
		expect(size()).toBe(5);
		expect(realtime.declare()[0]).not.toHaveProperty('limits');
	});

	it('declares the per-address limits the edge renders', () => {
		expect(surface('Declared').declare()[0]).toMatchObject({
			limits: { handshakesPerMinute: 120, connectionsPerIp: 256 },
		});
	});

	it('refuses a limit that is not a positive whole number', () => {
		expect(() => surface('Bad', { limits: { messagesPerSecond: 0 } })).toThrow(
			InvalidWebSocketLimit,
		);
		expect(() => resolveLimits('Bad', { burst: 1.5 })).toThrow(
			InvalidWebSocketLimit,
		);
	});
});

describe('WebSocketApi limits over Redis', () => {
	const redis = `redis://localhost:${REDIS_PORT}`;

	function replicas(id: string) {
		const channel = `test-${randomUUID()}`;
		return {
			[`${id.toUpperCase()}_PUBLISHER_CONNECTION_STRING`]: `${redis}?channel=${channel}`,
		};
	}

	it("counts a client address's sockets across replicas", async () => {
		const env = replicas('Shared');
		const realtime = surface('Shared', { limits: { connectionsPerIp: 1 } });
		const one = await serve(realtime, [], env);
		const two = await serve(realtime, [], env);

		await open(one.url, from('192.0.2.10'));
		expect((await refused(two.url, from('192.0.2.10'))).status).toBe(429);
		await expect(open(two.url, from('192.0.2.11'))).resolves.toBeDefined();
	});

	it("counts a client address's handshakes across replicas", async () => {
		const env = replicas('Window');
		const realtime = surface('Window', { limits: { handshakesPerMinute: 2 } });
		const one = await serve(realtime, [], env);
		const two = await serve(realtime, [], env);

		await open(one.url, from('192.0.2.20'));
		await open(two.url, from('192.0.2.20'));
		const over = await refused(one.url, from('192.0.2.20'));
		expect(over.status).toBe(429);
		expect(over.headers['retry-after']).toBeDefined();
	});

	it("closes an identity's oldest socket on another replica", async () => {
		const env = replicas('Kick');
		const realtime = surface('Kick', {
			limits: {
				maxConnectionsPer: (data) => data.user as string,
				maxConnections: 1,
				overflow: 'closeOldest',
			},
		});
		const connect = realtime
			.connect()
			.handle(({ query }) => ({ user: query.get('user') }));
		const one = await serve(realtime, [{ connect }], env);
		const two = await serve(realtime, [{ connect }], env);

		const first = await open(`${one.url}/?user=ada`);
		const second = await open(`${two.url}/?user=ada`);

		await expect(first.closed).resolves.toEqual({
			code: CLOSE.policy,
			reason: 'Too many connections',
		});
		expect(second.socket.readyState).toBe(WebSocket.OPEN);
	});
});

describe('limits', () => {
	it('fills in the defaults', () => {
		expect(resolveLimits('Realtime')).toEqual({
			handshakesPerMinute: 120,
			inFlightHandshakes: 16,
			connectionsPerIp: 256,
			messagesPerSecond: 50,
			burst: 100,
			maxConnections: 16,
			overflow: 'refuse',
		});
	});

	it('refills a token bucket at its rate, up to its burst', () => {
		const bucket = new TokenBucket(10, 2);
		const now = Date.now();
		expect(bucket.take(now)).toBe(true);
		expect(bucket.take(now)).toBe(true);
		expect(bucket.take(now)).toBe(false);
		expect(bucket.take(now + 100)).toBe(true);
		expect(bucket.take(now + 100)).toBe(false);
		expect(bucket.take(now + 10_000)).toBe(true);
		expect(bucket.full).toBe(true);
	});

	it('lets a held place lapse when its time is up', async () => {
		const store = new MemoryLimitStore();
		await store.hold('ip:a', 'one', 1);
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(await store.hold('ip:a', 'two', 1_000)).toEqual(['two']);
	});

	it('trusts X-Forwarded-For only from a private peer — the edge', () => {
		const request = (remoteAddress: string, forwarded?: string) =>
			({
				socket: { remoteAddress },
				headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
			}) as unknown as IncomingMessage;

		expect(clientAddress(request('10.0.0.5', '203.0.113.9'))).toBe(
			'203.0.113.9',
		);
		// The edge appends the peer it saw; anything before it a client wrote.
		expect(clientAddress(request('10.0.0.5', '1.1.1.1, 203.0.113.9'))).toBe(
			'203.0.113.9',
		);
		expect(clientAddress(request('203.0.113.9', '1.1.1.1'))).toBe(
			'203.0.113.9',
		);
		expect(clientAddress(request('127.0.0.1'))).toBe('127.0.0.1');
	});
});
