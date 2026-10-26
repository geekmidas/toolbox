/**
 * One load run, end to end, in Docker: the target as `--replicas` processes
 * sharing Redis, the edge a stack deploys in front of them, and
 * `--generators` simulators — each its own container, so its own IP, so no
 * single client is held to the ~28k ephemeral ports one address gets to one
 * destination.
 *
 * The compose file is written per run into `.run/`, shaped as `gkm compose`
 * renders a stack: one service per replica, every replica an upstream of one
 * route. Nothing is published on the host — the generators are inside the
 * network — so it never competes with another project's ports.
 *
 *   pnpm --filter @geekmidas/websocket-load run scenario -- \
 *     --connections 20000 --generators 4 --replicas 2 --proxy caddy
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { SimulationReport } from './simulate';
import { distribution, type Printable, printTable } from './stats';

/** A proxy this scenario does not know how to run. */
export class UnknownProxy extends Error {
	constructor(readonly proxy: string) {
		super(
			`--proxy is '${proxy}'. Use caddy, traefik, or none (straight to the replicas).`,
		);
		this.name = 'UnknownProxy';
	}
}

/** A generator wrote no report — it crashed, or never started. */
export class GeneratorWroteNothing extends Error {
	constructor(readonly generator: string) {
		super(
			`${generator} wrote no report. Run with --keep and read \`docker compose -f .run/docker-compose.yml logs ${generator}\`.`,
		);
		this.name = 'GeneratorWroteNothing';
	}
}

const { values } = parseArgs({
	// `pnpm run x -- --flag` passes the `--` through.
	args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== '--'),
	options: {
		connections: { type: 'string', default: '10000' },
		generators: { type: 'string', default: '2' },
		replicas: { type: 'string', default: '2' },
		proxy: { type: 'string', default: 'caddy' },
		/** Sockets per second, across every generator. */
		ramp: { type: 'string', default: '2000' },
		hold: { type: 'string', default: '30' },
		broadcasts: { type: 'string', default: '3' },
		/** Seconds between the server's pings. */
		heartbeat: { type: 'string', default: '30' },
		/**
		 * Hold every socket silent for --hold seconds: no round trips, no
		 * broadcasts, and pings every 300s — what an idle client looks like to
		 * the edge's timeouts.
		 */
		idle: { type: 'boolean', default: false },
		/**
		 * The edge without TLS, to tell what terminating TLS costs apart from
		 * what proxying does. A deployed stack always terminates TLS.
		 */
		plain: { type: 'boolean', default: false },
		/** The edge's Go GC target — how much garbage it may hold before collecting. */
		gogc: { type: 'string' },
		/**
		 * Leave the edge's ephemeral port range at Docker's default
		 * (32768–60999), to see the ceiling one replica hits behind it.
		 */
		'default-ports': { type: 'boolean', default: false },
		keep: { type: 'boolean', default: false },
		label: { type: 'string' },
	},
});

const PROXY_IMAGES = {
	caddy: 'caddy:2-alpine',
	// The edge `gkm compose` runs; see packages/cli/src/compose/traefik.ts.
	traefik: 'traefik:v3.7.13',
} as const;
const NODE_IMAGE = 'node:24-alpine';
const REDIS_IMAGE = 'redis:8-alpine';

const proxy = values.proxy!;
if (proxy !== 'caddy' && proxy !== 'traefik' && proxy !== 'none') {
	throw new UnknownProxy(proxy);
}
const connections = Number(values.connections);
const generators = Number(values.generators);
const replicas = Number(values.replicas);
const ramp = Number(values.ramp);
const hold = Number(values.hold);
const idle = values.idle!;
const heartbeat = idle ? 300 : Number(values.heartbeat);

const root = join(import.meta.dirname, '..');
const run = join(root, '.run');
const out = join(run, 'out');
rmSync(run, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const targets = Array.from({ length: replicas }, (_, i) => `target-${i + 1}`);
const gens = Array.from({ length: generators }, (_, i) => `gen-${i + 1}`);

/** Every port a process may connect from, and file descriptors to match. */
const tuned = {
	sysctls: { 'net.ipv4.ip_local_port_range': '1024 65535' },
	ulimits: { nofile: { soft: 1048576, hard: 1048576 } },
};

const plain = values.plain!;

const caddyfile = `{
	local_certs
	auto_https disable_redirects
	admin off
}

${plain ? 'http://edge' : 'https://edge'} {${plain ? '' : '\n\ttls internal'}
	reverse_proxy ${targets.map((t) => `${t}:3000`).join(' ')} {
		flush_interval -1
	}
}
`;

const traefikStatic = `entryPoints:
  websecure:
    address: ":${plain ? 80 : 443}"
  ping:
    address: ":8082"
ping:
  entryPoint: ping
providers:
  file:
    filename: /etc/traefik/dynamic.yml
log:
  level: WARN
`;

const traefikDynamic = `http:
  routers:
    realtime:
      rule: Host(\`edge\`)
      entryPoints: [websecure]
      service: realtime
${plain ? '' : '      tls: {}\n'}  services:
    realtime:
      loadBalancer:
        servers:
${targets.map((t) => `          - url: http://${t}:3000`).join('\n')}
        responseForwarding:
          flushInterval: -1ms
        healthCheck:
          path: /health
          interval: 5s
          timeout: 3s
`;

const url =
	proxy === 'none'
		? targets.map((t) => `ws://${t}:3000`).join(',')
		: plain
			? 'ws://edge'
			: 'wss://edge';
const perGenerator = Math.ceil(connections / generators);

const services: Record<string, unknown> = {
	redis: {
		image: REDIS_IMAGE,
		healthcheck: {
			test: ['CMD', 'redis-cli', 'ping'],
			interval: '1s',
			retries: 30,
		},
	},
};

for (const target of targets) {
	services[target] = {
		image: NODE_IMAGE,
		command: ['node', '/app/target.mjs'],
		working_dir: '/app',
		volumes: ['../dist:/app:ro'],
		environment: {
			PORT: '3000',
			HEARTBEAT_SECONDS: String(heartbeat),
			REALTIME_PUBLISHER_CONNECTION_STRING: 'redis://redis:6379?channel=load',
		},
		...tuned,
		depends_on: { redis: { condition: 'service_healthy' } },
		healthcheck: {
			test: ['CMD', 'wget', '-qO-', 'http://127.0.0.1:3000/health'],
			interval: '1s',
			retries: 30,
		},
	};
}

const edgeTuned = values['default-ports'] ? { ulimits: tuned.ulimits } : tuned;

const edgeEnvironment = values.gogc
	? { environment: { GOGC: values.gogc } }
	: {};

const dependsOnTargets = Object.fromEntries(
	targets.map((t) => [t, { condition: 'service_healthy' }]),
);

if (proxy === 'caddy') {
	writeFileSync(join(run, 'Caddyfile'), caddyfile);
	services.edge = {
		image: PROXY_IMAGES.caddy,
		volumes: ['./Caddyfile:/etc/caddy/Caddyfile:ro'],
		...edgeEnvironment,
		...edgeTuned,
		depends_on: dependsOnTargets,
	};
} else if (proxy === 'traefik') {
	writeFileSync(join(run, 'traefik.yml'), traefikStatic);
	writeFileSync(join(run, 'dynamic.yml'), traefikDynamic);
	services.edge = {
		image: PROXY_IMAGES.traefik,
		volumes: [
			'./traefik.yml:/etc/traefik/traefik.yml:ro',
			'./dynamic.yml:/etc/traefik/dynamic.yml:ro',
		],
		...edgeEnvironment,
		...edgeTuned,
		depends_on: dependsOnTargets,
	};
}

gens.forEach((gen, i) => {
	services[gen] = {
		image: NODE_IMAGE,
		profiles: ['load'],
		command: [
			'node',
			'/app/simulate.mjs',
			'--url',
			url,
			'--connections',
			String(perGenerator),
			'--ramp',
			String(Math.ceil(ramp / generators)),
			'--hold',
			String(hold),
			'--name',
			gen,
			'--json',
			`/out/${gen}.json`,
			'--insecure',
			...(idle
				? ['--rtt-every', '0', '--broadcasts', '0']
				: [
						'--broadcasts',
						String(values.broadcasts),
						'--broadcast-every',
						'3',
					]),
			// One generator triggers each broadcast; every one times its arrival.
			...(i === 0 ? [] : ['--no-trigger']),
		],
		volumes: ['../dist:/app:ro', './out:/out'],
		...tuned,
		// Each generator holds 1/K of the sockets; give V8 room for 50k+.
		environment: { NODE_OPTIONS: '--max-old-space-size=4096' },
	};
});

const compose = { name: 'gkm-websocket-load', services };
const composeFile = join(run, 'docker-compose.yml');
writeFileSync(composeFile, `${JSON.stringify(compose, null, 2)}\n`);

const docker = (...args: string[]) =>
	execFileSync('docker', ['compose', '-f', composeFile, ...args], {
		cwd: run,
		encoding: 'utf-8',
		stdio: ['ignore', 'pipe', 'inherit'],
	});

/** Memory of the edge and each replica, as Docker sees the container. */
function containerMemory(): Record<string, string> {
	const ids = docker('ps', '-q').trim().split('\n').filter(Boolean);
	if (!ids.length) return {};
	const lines = execFileSync(
		'docker',
		[
			'stats',
			'--no-stream',
			'--format',
			'{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}',
			...ids,
		],
		{ encoding: 'utf-8' },
	);
	return Object.fromEntries(
		lines
			.trim()
			.split('\n')
			.map((line) => {
				const [name, memory, cpu] = line.split('\t');
				return [
					name!.replace(/^gkm-websocket-load-/, ''),
					`${memory} (${cpu} CPU)`,
				];
			}),
	);
}

console.error(
	`▶ ${connections} sockets, ${generators} generators, ${replicas} replicas, proxy ${proxy}${idle ? ', idle' : ''}`,
);
const upServices = ['redis', ...targets, ...(proxy === 'none' ? [] : ['edge'])];
docker('up', '-d', '--wait', ...upServices);
// Caddy issues its internal certificate on the first handshake.
await new Promise((resolve) => setTimeout(resolve, 2_000));
const memoryBefore = containerMemory();

const started = Date.now();
const load = spawn(
	'docker',
	[
		'compose',
		'-f',
		composeFile,
		'--profile',
		'load',
		'up',
		'--no-log-prefix',
		...gens,
	],
	{ cwd: run, stdio: ['ignore', 'inherit', 'inherit'] },
);

// Sample the containers once every socket should be open and holding.
const settledAt = (connections / ramp + 3 + hold * 0.6) * 1000;
let memoryHolding: Record<string, string> = {};
const sampler = setTimeout(() => {
	memoryHolding = containerMemory();
}, settledAt);

await new Promise<void>((resolve) => load.on('exit', () => resolve()));
clearTimeout(sampler);
const seconds = (Date.now() - started) / 1000;

const reports = gens.map((gen) => {
	try {
		return JSON.parse(
			readFileSync(join(out, `${gen}.json`), 'utf-8'),
		) as SimulationReport;
	} catch {
		throw new GeneratorWroteNothing(gen);
	}
});

if (!values.keep) docker('--profile', 'load', 'down', '-v', '--remove-orphans');

// Pooled across generators.
const sum = (pick: (r: SimulationReport) => number) =>
	reports.reduce((total, r) => total + pick(r), 0);
const merge = (pick: (r: SimulationReport) => Record<string, number>) => {
	const merged: Record<string, number> = {};
	for (const r of reports) {
		for (const [key, value] of Object.entries(pick(r))) {
			merged[key] = (merged[key] ?? 0) + value;
		}
	}
	return merged;
};

const seqs = [
	...new Set(reports.flatMap((r) => Object.keys(r.raw.broadcasts))),
].sort();
const broadcasts = seqs.map((seq) => {
	const latencies = reports.flatMap((r) => r.raw.broadcasts[seq] ?? []);
	const expected = reports.reduce(
		(total, r) =>
			total + (r.broadcasts.find((b) => String(b.seq) === seq)?.expected ?? 0),
		0,
	);
	return {
		seq: Number(seq),
		received: latencies.length,
		expected,
		allMs: Math.max(...latencies),
		latencyMs: distribution(latencies),
	};
});

// Per instance: the fewest sockets any generator saw before, the most after.
const instances = new Map<
	string,
	{
		before?: { sockets: number; rss: number };
		after?: { sockets: number; rss: number; instance: string };
	}
>();
for (const r of reports) {
	for (const s of r.server.before) {
		const entry = instances.get(s.instance) ?? {};
		if (!entry.before || s.sockets < entry.before.sockets) entry.before = s;
		instances.set(s.instance, entry);
	}
	for (const s of r.server.after) {
		const entry = instances.get(s.instance) ?? {};
		if (!entry.after || s.sockets > entry.after.sockets) entry.after = s;
		instances.set(s.instance, entry);
	}
}
let grownBytes = 0;
let grownSockets = 0;
for (const { before, after } of instances.values()) {
	if (!before || !after || after.sockets <= before.sockets) continue;
	grownBytes += after.rss - before.rss;
	grownSockets += after.sockets - before.sockets;
}

const pooled: Printable = {
	generator: `all ${generators} (${proxy}${plain ? ' plain' : ''}${values.gogc ? ` GOGC=${values.gogc}` : ''}, ${replicas} replicas)`,
	asked: sum((r) => r.asked),
	opened: sum((r) => r.opened),
	openAtEnd: sum((r) => r.openAtEnd),
	failures: merge((r) => r.failures),
	unexpectedCloses: merge((r) => r.unexpectedCloses),
	rampSeconds: Math.max(...reports.map((r) => r.rampSeconds)),
	connectMs: distribution(reports.flatMap((r) => r.raw.connectMs)),
	rttMs: distribution(reports.flatMap((r) => r.raw.rttMs)),
	rttLost: sum((r) => r.rttLost),
	broadcasts,
	server: {
		after: [...instances.values()].flatMap(({ after }) =>
			after ? [after] : [],
		),
	},
	...(grownSockets ? { bytesPerConnection: grownBytes / grownSockets } : {}),
};

printTable([pooled]);
console.log(`containers before   ${JSON.stringify(memoryBefore, null, 1)}`);
console.log(`containers holding  ${JSON.stringify(memoryHolding, null, 1)}`);
console.log(`wall clock          ${seconds.toFixed(0)} s`);

const summary = {
	label: values.label ?? null,
	params: {
		connections,
		generators,
		replicas,
		proxy,
		tls: !plain && proxy !== 'none',
		gogc: values.gogc ?? null,
		edgePortRange: values['default-ports'] ? 'docker default' : '1024-65535',
		ramp,
		hold,
		idle,
		heartbeat,
	},
	pooled,
	containers: { before: memoryBefore, holding: memoryHolding },
	generators: reports.map(({ raw: _raw, ...report }) => report),
};
writeFileSync(
	join(run, 'summary.json'),
	`${JSON.stringify(summary, null, 2)}\n`,
);
console.error(`summary: ${join(run, 'summary.json')}`);
