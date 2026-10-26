/**
 * Real sockets, as many as asked for, held open against a `WebSocketApi`.
 *
 * It opens `--connections` sockets at `--ramp` per second, keeps them alive
 * (`ws` answers the server's pings), samples round trips through `echo` on a
 * few sockets at a time, asks for `--broadcasts` fan-outs and times how long
 * each takes to reach every socket it holds, then reports what the server
 * says each connection cost it.
 *
 * Built for tens of thousands of sockets in one process: there is no timer per
 * socket — one loop ramps, one samples — and a socket keeps three numbers.
 *
 *   tsx src/simulate.ts --url ws://localhost:3000 --connections 10000 \
 *     --ramp 1000 --hold 30 --broadcasts 5 --json out.json
 */

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import WebSocket from 'ws';
import { type Distribution, distribution, printTable } from './stats';

/** A flag that is not a positive number. */
export class InvalidSimulationFlag extends Error {
	constructor(
		readonly flag: string,
		readonly value: string,
	) {
		super(`--${flag} is '${value}'. Give it a number of 0 or more.`);
		this.name = 'InvalidSimulationFlag';
	}
}

/** No `--url`: nothing to connect to. */
export class SimulationNeedsUrl extends Error {
	constructor() {
		super(
			'Give the surface to connect to with --url ws://host:port (a comma-separated list spreads sockets across them).',
		);
		this.name = 'SimulationNeedsUrl';
	}
}

/** What one process of the server reported about itself. */
export interface InstanceStats {
	instance: string;
	sockets: number;
	rss: number;
	heapUsed: number;
	external: number;
	uptime: number;
}

/** Everything one simulator measured — what `--json` writes. */
export interface SimulationReport {
	generator: string;
	urls: string[];
	asked: number;
	opened: number;
	openAtEnd: number;
	failures: Record<string, number>;
	unexpectedCloses: Record<string, number>;
	rampSeconds: number;
	connectMs: Distribution;
	rttMs: Distribution;
	rttLost: number;
	broadcasts: {
		seq: number;
		/** Sockets that got it, of those open when it was sent. */
		received: number;
		expected: number;
		/** From the server stamping it to the last of this simulator's sockets. */
		allMs: number;
		latencyMs: Distribution;
	}[];
	server: { before: InstanceStats[]; after: InstanceStats[] };
	/** RSS growth per socket gained, per instance seen both times. */
	bytesPerConnection?: number;
	/** The samples themselves, so several simulators' can be pooled. */
	raw: {
		connectMs: number[];
		rttMs: number[];
		broadcasts: Record<string, number[]>;
	};
}

const { values } = parseArgs({
	// `pnpm run x -- --flag` passes the `--` through.
	args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== '--'),
	options: {
		url: { type: 'string' },
		connections: { type: 'string', default: '1000' },
		ramp: { type: 'string', default: '500' },
		hold: { type: 'string', default: '30' },
		'rtt-every': { type: 'string', default: '1' },
		'rtt-sample': { type: 'string', default: '50' },
		broadcasts: { type: 'string', default: '3' },
		'broadcast-every': { type: 'string', default: '3' },
		/** Only this simulator triggers broadcasts; others just receive. */
		'no-trigger': { type: 'boolean', default: false },
		/** Seconds after the ramp before the first broadcast. */
		settle: { type: 'string', default: '3' },
		name: { type: 'string', default: process.env.HOSTNAME ?? 'local' },
		json: { type: 'string' },
		quiet: { type: 'boolean', default: false },
		/** Accept the edge's own certificate — Caddy's internal CA, Traefik's default. */
		insecure: { type: 'boolean', default: false },
	},
});

function num(flag: keyof typeof values): number {
	const raw = String(values[flag]);
	const value = Number(raw);
	if (!Number.isFinite(value) || value < 0) {
		throw new InvalidSimulationFlag(flag, raw);
	}
	return value;
}

if (!values.url) throw new SimulationNeedsUrl();
const urls = values.url.split(',').map((url) => url.trim());
const asked = num('connections');
const ramp = num('ramp');
const hold = num('hold');
const rttEvery = num('rtt-every');
const rttSample = num('rtt-sample');
const broadcastCount = num('broadcasts');
const broadcastEvery = num('broadcast-every');
const settle = num('settle');

const log = (message: string) => {
	if (!values.quiet) console.error(`[${values.name}] ${message}`);
};

interface Client {
	socket: WebSocket;
	open: boolean;
	/** Asks the server for its stats, and is counted nowhere else. */
	probe: boolean;
	/** Its failure is counted once, by whichever event names it first. */
	failed?: boolean;
}

const clients: Client[] = [];
const connectMs: number[] = [];
const rttMs: number[] = [];
const failures: Record<string, number> = {};
const unexpectedCloses: Record<string, number> = {};
let opened = 0;
let openNow = 0;
let ending = false;

/** Round trips in flight: frame id → when it was sent. */
const inFlight = new Map<number, number>();
let nextFrame = 1;

/** What arrived of each broadcast: seq → latencies. */
const arrivals = new Map<number, number[]>();
const expectedFor = new Map<number, number>();

/** Replies to `stats`, by the frame id that asked. */
const statsWaiting = new Map<number, (stats: InstanceStats) => void>();

function count(into: Record<string, number>, key: string): void {
	into[key] = (into[key] ?? 0) + 1;
}

function onMessage(this: Client, raw: WebSocket.RawData): void {
	const frame = JSON.parse(raw.toString());
	if (frame.action === 'fanned') {
		if (this.probe) return;
		const at = Date.now();
		const { seq, t } = frame.data as { seq: number; t: number };
		let list = arrivals.get(seq);
		if (!list) {
			list = [];
			arrivals.set(seq, list);
			expectedFor.set(seq, openNow);
		}
		list.push(at - t);
		return;
	}
	if (frame.action === 'echo' && typeof frame.id === 'number') {
		const sent = inFlight.get(frame.id);
		if (sent !== undefined) {
			rttMs.push(performance.now() - sent);
			inFlight.delete(frame.id);
		}
		return;
	}
	if (frame.action === 'stats' && typeof frame.id === 'number') {
		statsWaiting.get(frame.id)?.(frame.data);
		statsWaiting.delete(frame.id);
	}
}

function connect(url: string, probe = false): Client {
	const started = performance.now();
	const socket = new WebSocket(url, {
		perMessageDeflate: false,
		handshakeTimeout: 30_000,
		...(values.insecure ? { rejectUnauthorized: false } : {}),
	});
	const client: Client = { socket, open: false, probe };
	socket.on('open', () => {
		client.open = true;
		if (probe) return;
		opened++;
		openNow++;
		connectMs.push(performance.now() - started);
	});
	socket.on('unexpected-response', (_request, response) => {
		client.failed = true;
		count(failures, `http ${response.statusCode}`);
		socket.terminate();
	});
	socket.on('error', (error: NodeJS.ErrnoException) => {
		if (client.open || client.failed) return;
		client.failed = true;
		count(failures, error.code ?? error.message);
	});
	socket.on('close', (code) => {
		if (!client.open) return;
		client.open = false;
		if (probe) return;
		openNow--;
		if (!ending) count(unexpectedCloses, String(code));
	});
	socket.on('message', onMessage.bind(client));
	return client;
}

/** Ask whichever instances `sockets` land on for their stats. */
async function serverStats(sockets: Client[]): Promise<InstanceStats[]> {
	const replies = await Promise.all(
		sockets
			.filter((client) => client.open)
			.map(
				(client) =>
					new Promise<InstanceStats | undefined>((resolve) => {
						const id = nextFrame++;
						statsWaiting.set(id, resolve);
						client.socket.send(JSON.stringify({ action: 'stats', id }));
						setTimeout(() => resolve(undefined), 5_000).unref();
					}),
			),
	);
	const byInstance = new Map<string, InstanceStats>();
	for (const reply of replies) {
		if (reply) byInstance.set(reply.instance, reply);
	}
	return [...byInstance.values()];
}

/** Open the probes, wait for them, and return those that opened. */
async function probes(n: number): Promise<Client[]> {
	const list = Array.from({ length: n }, (_, i) =>
		connect(urls[i % urls.length]!, true),
	);
	await new Promise((resolve) => setTimeout(resolve, 1_000));
	return list;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------

// The server before this simulator added anything: a few probes, so each
// replica behind the edge is likely to be asked.
const probeClients = await probes(Math.max(8, urls.length * 4));
const before = await serverStats(probeClients);
log(
	`server before: ${before.map((s) => `${s.instance} ${s.sockets} sockets ${mb(s.rss)}`).join(', ')}`,
);

// Ramp: one loop, opening however many sockets are due each tick.
const rampStart = performance.now();
await new Promise<void>((resolve) => {
	let due = 0;
	const tick = 10;
	const timer = setInterval(() => {
		due += (ramp * tick) / 1000;
		while (due >= 1 && clients.length < asked) {
			clients.push(connect(urls[clients.length % urls.length]!));
			due--;
		}
		if (clients.length >= asked) {
			clearInterval(timer);
			resolve();
		}
	}, tick);
});
// Wait for the handshakes still in flight, or 30s.
const waitUntil = performance.now() + 30_000;
while (
	opened + Object.values(failures).reduce((a, b) => a + b, 0) < asked &&
	performance.now() < waitUntil
) {
	await sleep(100);
}
const rampSeconds = (performance.now() - rampStart) / 1000;
log(
	`opened ${opened}/${asked} in ${rampSeconds.toFixed(1)}s, failures ${JSON.stringify(failures)}`,
);

// Hold: sample round trips, and fan out after the settle.
const holdEnd = Date.now() + hold * 1000;
let rttTimer: NodeJS.Timeout | undefined;
if (rttEvery > 0) {
	rttTimer = setInterval(() => {
		const open = clients.filter((client) => client.open);
		for (let i = 0; i < Math.min(rttSample, open.length); i++) {
			const client = open[Math.floor(Math.random() * open.length)]!;
			const id = nextFrame++;
			inFlight.set(id, performance.now());
			client.socket.send(JSON.stringify({ action: 'echo', id, data: { id } }));
		}
	}, rttEvery * 1000);
}

const triggered: number[] = [];
if (!values['no-trigger'] && broadcastCount > 0) {
	await sleep(settle * 1000);
	for (let i = 0; i < broadcastCount; i++) {
		const trigger = clients.find((client) => client.open);
		if (!trigger) break;
		// A seq unlikely to collide with another simulator's.
		const seq = Date.now() * 10 + i;
		triggered.push(seq);
		trigger.socket.send(
			JSON.stringify({ action: 'fanout', id: nextFrame++, data: { seq } }),
		);
		await sleep(broadcastEvery * 1000);
	}
}

while (Date.now() < holdEnd) await sleep(250);
if (rttTimer) clearInterval(rttTimer);
// Give the last round trips a moment.
await sleep(1_000);

const after = await serverStats([
	...probeClients,
	...clients.filter((client) => client.open).slice(0, 64),
]);

const perConnection = after.flatMap((now) => {
	const then = before.find((s) => s.instance === now.instance);
	const gained = then ? now.sockets - then.sockets : 0;
	return then && gained > 0 ? [(now.rss - then.rss) / gained] : [];
});

const report: SimulationReport = {
	generator: values.name!,
	urls,
	asked,
	opened,
	openAtEnd: openNow,
	failures,
	unexpectedCloses,
	rampSeconds,
	connectMs: distribution(connectMs),
	rttMs: distribution(rttMs),
	rttLost: inFlight.size,
	broadcasts: [...arrivals.keys()]
		.sort((a, b) => a - b)
		.map((seq) => {
			const latencies = arrivals.get(seq)!;
			return {
				seq,
				received: latencies.length,
				expected: expectedFor.get(seq) ?? 0,
				allMs: Math.max(...latencies),
				latencyMs: distribution(latencies),
			};
		}),
	server: { before, after },
	...(perConnection.length
		? {
				bytesPerConnection:
					perConnection.reduce((a, b) => a + b, 0) / perConnection.length,
			}
		: {}),
	raw: {
		connectMs,
		rttMs,
		broadcasts: Object.fromEntries(
			[...arrivals].map(([seq, latencies]) => [String(seq), latencies]),
		),
	},
};

ending = true;
for (const client of [...clients, ...probeClients]) client.socket.terminate();

if (values.json)
	writeFileSync(values.json, `${JSON.stringify(report, null, 2)}\n`);
if (!values.quiet) printTable([report]);

function mb(bytes: number): string {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

process.exit(0);
