/**
 * The server under load: a `WebSocketApi` served the way the generated entry
 * serves one — Node's `http` server, `/health` on the same port, the surface
 * attached to its upgrades.
 *
 * Three routes, each one thing the simulator measures:
 *
 * - `echo` returns its body — a round trip, for RTT.
 * - `stats` returns this process's memory and socket count, so the cost of a
 *   connection is read off the server rather than guessed.
 * - `fanout` broadcasts to every socket on every replica, stamped with the
 *   time it was sent.
 *
 * With `REALTIME_PUBLISHER_CONNECTION_STRING` set to a `redis://` URL, any
 * number of these share their sockets the way replicas on a stack do.
 */

import { createServer } from 'node:http';
import { WebSocketApi } from '@geekmidas/constructs/websocket-api';
import { EnvironmentParser } from '@geekmidas/envkit';
import { LogLevel } from '@geekmidas/logger';
import { ConsoleLogger } from '@geekmidas/logger/console';
import { z } from 'zod';

const logger = new ConsoleLogger({}, LogLevel.Silent);

export const realtime = new WebSocketApi('Realtime', {
	path: '.',
	logger,
	// Long enough that a heartbeat never lands inside a measurement window by
	// accident, short enough that a dead peer is noticed within a run.
	heartbeat: Number(process.env.HEARTBEAT_SECONDS) || 30,
});

let seq = 0;

const echo = realtime.route('echo').handle(({ body }) => body);

const fanout = realtime
	.route('fanout')
	.body(z.object({ seq: z.number() }).optional())
	.handle(async ({ body, sockets }) => {
		const sent = body?.seq ?? ++seq;
		await sockets.broadcast({ fanout: sent, t: Date.now() });
		return { seq: sent };
	});

const { attach, server } = await realtime.server({
	envParser: new EnvironmentParser({ ...process.env }),
	context: undefined as never,
	modules: [{ echo, fanout, stats: statsRoute() }],
});

function statsRoute() {
	return realtime.route('stats').handle(() => {
		const memory = process.memoryUsage();
		return {
			instance: server.instance,
			sockets: server.size,
			rss: memory.rss,
			heapUsed: memory.heapUsed,
			external: memory.external,
			uptime: process.uptime(),
		};
	});
}

const http = createServer((req, res) => {
	if (req.url === '/health') {
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ status: 'ok', sockets: server.size }));
		return;
	}
	res.writeHead(426, { upgrade: 'websocket' });
	res.end();
});
// The edge holds one connection per client open for as long as the client
// does; Node's defaults would time a quiet one out.
http.requestTimeout = 0;
http.headersTimeout = 10_000;
attach(http);

const port = Number(process.env.PORT) || 3000;
http.listen(port, () => {
	console.log(
		JSON.stringify({
			msg: 'target listening',
			port,
			instance: server.instance,
		}),
	);
});

const stop = async () => {
	await server.close();
	http.close();
	process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
