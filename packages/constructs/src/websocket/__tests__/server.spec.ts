// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EnvironmentParser } from '@geekmidas/envkit';
import { UnauthorizedError } from '@geekmidas/errors';
import type { Logger } from '@geekmidas/logger';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { z } from 'zod';
import { REDIS_PORT } from '../../../../testkit/test/ports';
import type { Authenticator } from '../../construct-interface';
import { runShutdownHooks } from '../../shutdown';
import { WebSocketApi } from '../../websocket-api';
import { CLOSE, DuplicateWebSocketRoute } from '../server';
import { UnsupportedWebSocketTransport } from '../transport';

const silent = {
	debug() {},
	info() {},
	warn() {},
	error() {},
	fatal() {},
	trace() {},
	child: () => silent,
} as unknown as Logger;

interface Running {
	url: string;
	http: Server;
	close(): Promise<void>;
}

const running: Running[] = [];

afterEach(async () => {
	await Promise.all(running.splice(0).map((r) => r.close()));
});

/** Serve `surface` on port 0, as the generated entry does. */
async function serve(
	surface: WebSocketApi,
	modules: object[],
	env: Record<string, string> = {},
): Promise<Running & { size(): number }> {
	const envParser = new EnvironmentParser(env);
	const { app, attach, server } = await surface.server({
		envParser,
		context: undefined as never,
		modules,
	});
	const http = createServer(async (req, res) => {
		const response = await app.fetch(
			new Request(`http://localhost${req.url}`, { method: req.method }),
		);
		res.writeHead(response.status, Object.fromEntries(response.headers));
		res.end(await response.text());
	});
	attach(http);
	await new Promise<void>((resolve) => http.listen(0, resolve));
	const { port } = http.address() as AddressInfo;
	const handle = {
		url: `ws://127.0.0.1:${port}`,
		http,
		size: () => server.size,
		async close() {
			await server.close();
			await new Promise<void>((resolve) => http.close(() => resolve()));
		},
	};
	running.push(handle);
	return handle;
}

/** A client that collects every frame it receives. */
async function client(
	url: string,
	headers: Record<string, string> = {},
): Promise<{
	socket: WebSocket;
	frames: unknown[];
	next(): Promise<any>;
	send(frame: unknown): void;
	closed: Promise<{ code: number; reason: string }>;
}> {
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
		socket.once('error', reject);
	});
	return {
		socket,
		frames,
		next: () =>
			frames.length
				? Promise.resolve(frames.shift())
				: new Promise((resolve) => waiting.push(resolve)),
		send: (frame) => socket.send(JSON.stringify(frame)),
		closed,
	};
}

/** The status a refused upgrade answered with. */
function refused(url: string, headers: Record<string, string> = {}) {
	return new Promise<number>((resolve, reject) => {
		const socket = new WebSocket(url, { headers });
		socket.once('unexpected-response', (_req, res) =>
			resolve(res.statusCode ?? 0),
		);
		socket.once('open', () => reject(new Error('the upgrade was accepted')));
		socket.once('error', () => {});
	});
}

describe('WebSocketApi', () => {
	it('dispatches a frame to its route and replies with what it returned', async () => {
		const realtime = new WebSocketApi('Realtime', {
			path: '.',
			logger: silent,
		});
		const echo = realtime
			.route('echo')
			.body(z.object({ text: z.string() }))
			.handle(({ body }) => ({ said: body.text }));
		const { url } = await serve(realtime, [{ echo }]);

		const c = await client(url);
		c.send({ action: 'echo', id: 7, data: { text: 'hi' } });

		await expect(c.next()).resolves.toEqual({
			action: 'echo',
			id: 7,
			data: { said: 'hi' },
		});
	});

	it('answers an invalid frame with an error frame and keeps the socket open', async () => {
		const realtime = new WebSocketApi('Realtime', {
			path: '.',
			logger: silent,
		});
		const echo = realtime
			.route('echo')
			.body(z.object({ text: z.string() }))
			.handle(({ body }) => body);
		const { url } = await serve(realtime, [{ echo }]);
		const c = await client(url);

		c.socket.send('not json');
		expect(await c.next()).toMatchObject({
			action: '$error',
			data: { message: 'Frames are JSON.' },
		});

		c.send({ action: 'echo', id: 1, data: { text: 3 } });
		const invalid = await c.next();
		expect(invalid).toMatchObject({ action: '$error', id: 1 });
		expect(invalid.data.issues).toHaveLength(1);

		c.send({ action: 'nope', id: 2 });
		expect(await c.next()).toMatchObject({
			action: '$error',
			id: 2,
			data: { message: "No route answers 'nope'." },
		});

		c.send({ action: 'echo', id: 3, data: { text: 'still here' } });
		expect(await c.next()).toEqual({
			action: 'echo',
			id: 3,
			data: { text: 'still here' },
		});
	});

	it('routes an unknown action to $default when there is one', async () => {
		const realtime = new WebSocketApi('Realtime', {
			path: '.',
			logger: silent,
		});
		const fallback = realtime
			.route('$default')
			.handle(({ body }) => ({ caught: body }));
		const { url } = await serve(realtime, [{ fallback }]);
		const c = await client(url);

		c.send({ action: 'anything', data: 1 });

		expect(await c.next()).toEqual({ action: 'anything', data: { caught: 1 } });
	});

	it('keeps what connect returned as the connection data, and refuses on an HttpError', async () => {
		const realtime = new WebSocketApi('Realtime', {
			path: '.',
			logger: silent,
		});
		const connect = realtime.connect().handle(({ query }) => {
			const user = query.get('user');
			if (!user) throw new UnauthorizedError('Who are you?');
			return { user };
		});
		const whoami = realtime
			.route('whoami')
			.handle(({ connection }) => connection.data);
		const { url } = await serve(realtime, [{ connect, whoami }]);

		await expect(refused(url)).resolves.toBe(401);

		const c = await client(`${url}/?user=ada`);
		c.send({ action: 'whoami' });
		expect(await c.next()).toEqual({ action: 'whoami', data: { user: 'ada' } });
	});

	it('hands connect the session its authenticator verified', async () => {
		const auth: Authenticator<{ userId: string }> = {
			id: 'Auth',
			declare: () => [{ kind: 'oidc', id: 'Auth', provides: [] } as never],
			async verify(headers) {
				const token = headers.get('authorization');
				return token === 'Bearer good' ? { userId: 'u1' } : null;
			},
		};
		const realtime = new WebSocketApi('Realtime', {
			path: '.',
			logger: silent,
		}).auth(auth);
		const connect = realtime.connect().handle(({ session }) => {
			if (!session) throw new UnauthorizedError();
			return session as { userId: string };
		});
		const whoami = realtime
			.route('whoami')
			.handle(({ connection }) => connection.data);
		const { url } = await serve(realtime, [{ connect, whoami }]);

		await expect(refused(url, { authorization: 'Bearer bad' })).resolves.toBe(
			401,
		);
		const c = await client(url, { authorization: 'Bearer good' });
		c.send({ action: 'whoami' });
		expect(await c.next()).toEqual({
			action: 'whoami',
			data: { userId: 'u1' },
		});
	});

	it('refuses a browser origin it does not trust, and lets one it does through', async () => {
		const realtime = new WebSocketApi('Realtime', {
			path: '.',
			logger: silent,
		});
		const { url } = await serve(realtime, [], {
			REALTIME_TRUSTED_ORIGINS: 'https://app.example.com',
		});

		await expect(
			refused(url, { origin: 'https://evil.example.com' }),
		).resolves.toBe(403);
		await expect(
			client(url, { origin: 'https://app.example.com' }),
		).resolves.toBeDefined();
		// No Origin: not a browser.
		await expect(client(url)).resolves.toBeDefined();
	});

	it('runs disconnect with the close code once a client leaves', async () => {
		const realtime = new WebSocketApi('Realtime', {
			path: '.',
			logger: silent,
		});
		const left: { id: string; code: number }[] = [];
		let done!: () => void;
		const gone = new Promise<void>((resolve) => {
			done = resolve;
		});
		const disconnect = realtime.disconnect().handle(({ connection, code }) => {
			left.push({ id: connection.id, code });
			done();
		});
		const { url, size } = await serve(realtime, [{ disconnect }]);
		const c = await client(url);
		expect(size()).toBe(1);

		c.socket.close(4001);
		await gone;

		expect(left).toEqual([{ id: expect.stringMatching(/\./), code: 4001 }]);
		expect(size()).toBe(0);
	});

	it('sends, broadcasts and closes through its publisher', async () => {
		const realtime = new WebSocketApi('Realtime', {
			path: '.',
			logger: silent,
		});
		const hello = realtime
			.route('hello')
			.handle(({ connection }) => connection.id);
		const shout = realtime
			.route('shout')
			.handle(async ({ sockets, body, connection }) => {
				await sockets.broadcast({ shout: body }, { except: [connection.id] });
			});
		const { url } = await serve(realtime, [{ hello, shout }]);
		const [a, b, c] = await Promise.all([
			client(url),
			client(url),
			client(url),
		]);

		a.send({ action: 'hello' });
		const { data: aId } = await a.next();
		b.send({ action: 'hello' });
		const { data: bId } = await b.next();

		a.send({ action: 'shout', data: 'hey' });
		expect(await b.next()).toEqual({ shout: 'hey' });
		expect(await c.next()).toEqual({ shout: 'hey' });

		const publisher = await realtime.service.register({
			envParser: new EnvironmentParser({
				REALTIME_PUBLISHER_CONNECTION_STRING: 'memory://gkm:ws:Realtime',
			}),
			context: undefined as never,
		});
		await publisher.send([bId], { only: 'b' });
		expect(await b.next()).toEqual({ only: 'b' });

		await publisher.close(aId, 4000, 'bye');
		await expect(a.closed).resolves.toEqual({ code: 4000, reason: 'bye' });
		expect(c.frames).toEqual([]);
	});

	it('pings, and drops a socket that stops answering', async () => {
		const realtime = new WebSocketApi('Realtime', {
			path: '.',
			logger: silent,
			heartbeat: 0.05,
		});
		const { url, size } = await serve(realtime, []);
		const c = await client(url);
		// A client that stopped answering pings: no automatic pong.
		c.socket.pong = () => {};

		const { code } = await c.closed;

		expect(code).toBe(1006);
		expect(size()).toBe(0);
	});

	it('closes every socket with 1012 when the server shuts down', async () => {
		const realtime = new WebSocketApi('Realtime', {
			path: '.',
			logger: silent,
		});
		const { url } = await serve(realtime, []);
		const c = await client(url);

		await runShutdownHooks();

		await expect(c.closed).resolves.toEqual({
			code: CLOSE.serviceRestart,
			reason: 'Restarting',
		});
	});

	it('refuses two routes for one action', async () => {
		const realtime = new WebSocketApi('Realtime', {
			path: '.',
			logger: silent,
		});
		const one = realtime.route('same').handle(() => 1);
		const two = realtime.route('same').handle(() => 2);

		await expect(
			realtime.server({
				envParser: new EnvironmentParser({}),
				context: undefined as never,
				modules: [{ one, two }],
			}),
		).rejects.toBeInstanceOf(DuplicateWebSocketRoute);
	});

	it('names no transport for a connection string it does not know', async () => {
		const realtime = new WebSocketApi('Realtime', {
			path: '.',
			logger: silent,
		});

		await expect(
			realtime.service.register({
				envParser: new EnvironmentParser({
					REALTIME_PUBLISHER_CONNECTION_STRING: 'nats://:secret@host',
				}),
				context: undefined as never,
			}),
		).rejects.toBeInstanceOf(UnsupportedWebSocketTransport);
	});

	it('answers plain HTTP with 426', async () => {
		const realtime = new WebSocketApi('Realtime', {
			path: '.',
			logger: silent,
		});
		const { url } = await serve(realtime, []);

		const response = await fetch(url.replace('ws:', 'http:'));

		expect(response.status).toBe(426);
		expect(await response.json()).toEqual({
			surface: 'Realtime',
			connections: 0,
		});

		const health = await fetch(`${url.replace('ws:', 'http:')}/health`);
		expect(health.status).toBe(200);
		expect(await health.json()).toEqual({ status: 'ok', connections: 0 });
	});

	it('declares an app with its url, trusted origins and publisher', () => {
		const realtime = new WebSocketApi('Realtime', {
			path: 'apps/realtime',
			replicas: 4,
		});

		expect(realtime.declare()).toEqual([
			{
				kind: 'websocket-api',
				id: 'Realtime',
				path: 'apps/realtime',
				replicas: 4,
				provides: [
					'REALTIME_URL',
					'REALTIME_TRUSTED_ORIGINS',
					'REALTIME_PUBLISHER_CONNECTION_STRING',
				],
			},
		]);
		expect(
			() => new WebSocketApi('Realtime', { path: '.', replicas: 0 }),
		).toThrow(/at least one process/);
	});
});

describe('WebSocketApi over Redis', () => {
	const redis = `redis://localhost:${REDIS_PORT}`;

	it('delivers to the replica that holds the socket, from a publisher in another process', async () => {
		const channel = `test-${randomUUID()}`;
		const env = {
			REALTIME_PUBLISHER_CONNECTION_STRING: `${redis}?channel=${channel}`,
		};
		const realtime = new WebSocketApi('Realtime', {
			path: '.',
			logger: silent,
		});
		const hello = realtime
			.route('hello')
			.handle(({ connection }) => connection.id);
		const one = await serve(realtime, [{ hello }], env);
		const two = await serve(realtime, [{ hello }], env);
		const [a, b] = await Promise.all([client(one.url), client(two.url)]);
		a.send({ action: 'hello' });
		const { data: aId } = await a.next();
		b.send({ action: 'hello' });
		const { data: bId } = await b.next();

		const publisher = await realtime.service.register({
			envParser: new EnvironmentParser(env),
			context: undefined as never,
		});
		await publisher.send([aId, bId], { to: 'both' });
		expect(await a.next()).toEqual({ to: 'both' });
		expect(await b.next()).toEqual({ to: 'both' });

		await publisher.broadcast({ to: 'all' }, { except: [bId] });
		expect(await a.next()).toEqual({ to: 'all' });

		await publisher.close(bId, 4002, 'kicked');
		await expect(b.closed).resolves.toEqual({ code: 4002, reason: 'kicked' });
		expect(b.frames).toEqual([]);
		await runShutdownHooks();
	});
});
