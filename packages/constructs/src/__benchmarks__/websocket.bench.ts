// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EnvironmentParser } from '@geekmidas/envkit';
import { LogLevel } from '@geekmidas/logger';
import { ConsoleLogger } from '@geekmidas/logger/console';
import { afterAll, describe, test } from 'vitest';
import WebSocket from 'ws';
import { z } from 'zod';
import type { WebSocketPublisher } from '../websocket/publisher';
import { WebSocketApi } from '../websocket-api';

// The test Redis, where the suites put it (`REDIS_HOST_PORT`). Read here
// rather than from testkit's helpers, which sit outside this package's build.
const REDIS_PORT = Number(process.env.REDIS_HOST_PORT) || 6379;

/**
 * WebSocket surface benchmarks, through real sockets on loopback.
 *
 * Client and server share one process, so absolute numbers carry the
 * client's cost too; they are for comparing changes to the hot path, not
 * for capacity. Capacity is `apps/websocket-load`'s job.
 */

const silent = new ConsoleLogger({}, LogLevel.Silent);

interface Served {
	url: string;
	close(): Promise<void>;
}

const servers: Served[] = [];

afterAll(async () => {
	await Promise.all(servers.splice(0).map((served) => served.close()));
});

async function serve(
	surface: WebSocketApi,
	modules: object[],
	env: Record<string, string> = {},
): Promise<Served> {
	const { app, attach, server } = await surface.server({
		envParser: new EnvironmentParser(env),
		context: undefined as never,
		modules,
	});
	const http: Server = createServer(async (req, res) => {
		const response = await app.fetch(new Request(`http://localhost${req.url}`));
		res.writeHead(response.status);
		res.end(await response.text());
	});
	attach(http);
	await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
	const { port } = http.address() as AddressInfo;
	const served = {
		url: `ws://127.0.0.1:${port}`,
		async close() {
			await server.close();
			http.closeAllConnections();
			await new Promise<void>((resolve) => http.close(() => resolve()));
		},
	};
	servers.push(served);
	return served;
}

function open(url: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url, { perMessageDeflate: false });
		socket.once('open', () => resolve(socket));
		socket.once('error', reject);
	});
}

/**
 * Close with a reset rather than a FIN: a closed loopback socket otherwise sits
 * in TIME_WAIT holding its ephemeral port, and a second run within a minute
 * finds macOS's 16k-port range used up.
 */
function drop(socket: WebSocket): void {
	(
		socket as unknown as { _socket?: { resetAndDestroy(): void } }
	)._socket?.resetAndDestroy();
}

/** Open `count` sockets, a batch at a time so the accept queue keeps up. */
async function openMany(url: string, count: number): Promise<WebSocket[]> {
	const sockets: WebSocket[] = [];
	for (let i = 0; i < count; i += 500) {
		const batch = Math.min(500, count - i);
		sockets.push(
			...(await Promise.all(Array.from({ length: batch }, () => open(url)))),
		);
	}
	return sockets;
}

describe('WebSocketApi - frame dispatch', () => {
	test('echo: parse, validate, handle, reply', async ({ bench }) => {
		const realtime = new WebSocketApi('Bench', { path: '.', logger: silent });
		const echo = realtime
			.route('echo')
			.body(z.object({ text: z.string(), n: z.number() }))
			.handle(({ body }) => body);
		const { url } = await serve(realtime, [{ echo }]);
		const socket = await open(url);

		// One pending reply at a time, resolved by id.
		const pending = new Map<number, () => void>();
		socket.on('message', (raw) => {
			const { id } = JSON.parse(raw.toString());
			pending.get(id)?.();
			pending.delete(id);
		});
		let id = 0;

		await bench('round trip of one validated frame', () => {
			const frame = ++id;
			return new Promise<void>((resolve) => {
				pending.set(frame, resolve);
				socket.send(
					JSON.stringify({
						action: 'echo',
						id: frame,
						data: { text: 'hi', n: frame },
					}),
				);
			});
		}).run({ time: 3_000 });

		drop(socket);
	});
});

describe('WebSocketApi - broadcast fan-out', () => {
	for (const count of [1_000, 10_000]) {
		test(`broadcast to ${count} sockets`, async ({ bench }) => {
			const realtime = new WebSocketApi('Bench', {
				path: '.',
				logger: silent,
			});
			let sockets: WebSocketPublisher | undefined;
			const grab = realtime.route('grab').handle(({ sockets: publisher }) => {
				sockets = publisher;
				return true;
			});
			const { url } = await serve(realtime, [{ grab }]);
			const clients = await openMany(url, count);

			// The server's own publisher, taken from a route.
			await new Promise<void>((resolve) => {
				clients[0]!.once('message', () => resolve());
				clients[0]!.send(JSON.stringify({ action: 'grab' }));
			});

			let remaining = 0;
			let done: () => void = () => {};
			for (const client of clients) {
				client.on('message', () => {
					if (--remaining === 0) done();
				});
			}

			await bench(`every one of ${count} sockets received it`, async () => {
				remaining = count;
				const received = new Promise<void>((resolve) => {
					done = resolve;
				});
				await sockets!.broadcast({ t: Date.now() });
				await received;
			}).run({ time: 5_000, iterations: 10 });

			for (const client of clients) drop(client);
		});
	}
});

describe('WebSocketApi - publisher send', () => {
	const transports = {
		memory: (channel: string) => `memory://${channel}`,
		redis: (channel: string) =>
			`redis://localhost:${REDIS_PORT}?channel=${channel}`,
	};

	for (const [name, connectionString] of Object.entries(transports)) {
		test(`send to one socket over ${name}`, async ({ bench }) => {
			const env = {
				BENCH_PUBLISHER_CONNECTION_STRING: connectionString(
					`bench-${randomUUID()}`,
				),
			};
			const realtime = new WebSocketApi('Bench', {
				path: '.',
				logger: silent,
			});
			const hello = realtime
				.route('hello')
				.handle(({ connection }) => connection.id);
			const { url } = await serve(realtime, [{ hello }], env);
			const socket = await open(url);
			const id = await new Promise<string>((resolve) => {
				socket.once('message', (raw) =>
					resolve(JSON.parse(raw.toString()).data),
				);
				socket.send(JSON.stringify({ action: 'hello' }));
			});

			// A publisher as an endpoint in another process would hold it.
			const publisher = await realtime.service.register({
				envParser: new EnvironmentParser(env),
				context: undefined as never,
			});

			let received: () => void = () => {};
			socket.on('message', () => received());

			await bench(`publisher.send → socket (${name})`, async () => {
				const arrived = new Promise<void>((resolve) => {
					received = resolve;
				});
				await publisher.send(id, { t: 1 });
				await arrived;
			}).run({ time: 3_000 });

			drop(socket);
		});
	}
});
