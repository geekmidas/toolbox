import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import {
	createServer as createHttpServer,
	type IncomingMessage,
	type Server,
} from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { provideKey } from '@geekmidas/manifest';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POSTGRES_PORT } from '../../../../testkit/test/ports';
import { bundleServer } from '../../build/bundler';
import type { BuildContext } from '../../build/types';
import { CronGenerator } from '../CronGenerator';
import { driversFor } from '../drivers';
import { EndpointGenerator } from '../EndpointGenerator';
import { QueueGenerator } from '../QueueGenerator';
import { SubscriberGenerator } from '../SubscriberGenerator';
import { WorkerGenerator, workerBundleName } from '../WorkerGenerator';

/**
 * One trace across two processes: a bundled API whose request enqueues a job,
 * and the bundled worker that runs it — request → PRODUCER → CONSUMER → the
 * job's database query — exported by each process to one OTLP receiver.
 *
 * Both are bundles, so nothing is traced by a load-time hook: what arrives is
 * what the request middleware, the events drivers and the database pool send.
 */

const URL = `postgres://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`;
const run = randomBytes(4).toString('hex');
const SCHEMA = `worker_trace_${run}`;
const TABLE = `worker_trace_effects_${run}`;
const BROKER = `pgboss://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas?schema=${SCHEMA}`;

interface OtlpSpan {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	kind: number;
	attributes: { key: string; value: Record<string, unknown> }[];
}

/** OTLP's span kinds. */
const SERVER = 2;
const PRODUCER = 4;
const CONSUMER = 5;
const CLIENT = 3;

const spans: (OtlpSpan & { service?: string })[] = [];
let receiver: Server;
let collector: string;
let dir: string;
let server: string;
let worker: string;

function body(req: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		let data = '';
		req.on('data', (chunk) => {
			data += chunk;
		});
		req.on('end', () => resolve(data));
	});
}

function attr(
	attributes: { key: string; value: Record<string, unknown> }[] | undefined,
	key: string,
): unknown {
	const value = attributes?.find((a) => a.key === key)?.value;
	return value && Object.values(value)[0];
}

beforeAll(async () => {
	receiver = createHttpServer(async (req, res) => {
		const payload = JSON.parse((await body(req)) || '{}');
		if (req.url === '/v1/traces') {
			for (const resource of payload.resourceSpans ?? []) {
				const service = attr(resource.resource?.attributes, 'service.name');
				for (const scope of resource.scopeSpans ?? []) {
					for (const span of scope.spans ?? []) {
						spans.push({ ...span, service: service as string });
					}
				}
			}
		}
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end('{}');
	});
	await new Promise<void>((resolve) => receiver.listen(0, resolve));
	const { port } = receiver.address() as { port: number };
	collector = `http://127.0.0.1:${port}`;

	const cache = join(import.meta.dirname, '../../../node_modules/.cache');
	mkdirSync(cache, { recursive: true });
	dir = mkdtempSync(join(cache, 'gkm-worker-trace-'));
	writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');

	writeFileSync(
		join(dir, 'constructs.ts'),
		`import { RestApi } from '@geekmidas/constructs/rest-api';
import { Worker } from '@geekmidas/constructs/worker';
import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';
import { createLogger } from '@geekmidas/logger/pino';

const logger = createLogger();
export const api = new RestApi('Shop', { path: '.', defaultAuthorizer: 'none', logger });
export const store = new KyselyDatabase('Store');
export const jobs = new Worker('Packing', { logger }).database(store);
`,
	);
	mkdirSync(join(dir, 'work'));
	writeFileSync(
		join(dir, 'work', 'pack.ts'),
		`import { sql } from 'kysely';
import { z } from 'zod';
import { jobs } from '../constructs';

export const pack = jobs
  .queue('Pack')
  .message(z.object({ id: z.string() }))
  .handle(async ({ messages, db }) => {
    for (const { id } of messages) {
      await sql\`insert into ${TABLE} (id) values (\${id})\`.execute(db as any);
    }
  });
`,
	);
	mkdirSync(join(dir, 'endpoints'));
	writeFileSync(
		join(dir, 'endpoints', 'orders.ts'),
		`import { z } from 'zod';
import { api } from '../constructs';
import { pack } from '../work/pack';

export const placeOrder = api
  .post('/orders')
  .dependsOn([pack])
  .body(z.object({ id: z.string() }))
  .output(z.object({ id: z.string() }))
  .handle(async ({ body, services }) => {
    await services.pack.publish([{ type: 'Pack', payload: { id: body.id } }]);
    return { id: body.id };
  });
`,
	);

	const module = (exportName: string) => ({
		specifier: join(dir, 'constructs.ts'),
		exportName,
	});
	const context: BuildContext = {
		surface: {
			id: 'Shop',
			trustedOriginsKey: 'SHOP_TRUSTED_ORIGINS',
			module: module('api'),
		},
		owners: { Shop: module('api'), Packing: module('jobs') },
		eventsBackends: ['pgboss'],
		storageDrivers: driversFor({ appRoot: dir, events: ['pgboss'] }),
		production: {
			enabled: true,
			bundle: true,
			minify: false,
			healthCheck: '/health',
			gracefulShutdown: true,
			external: [],
			subscribers: 'exclude',
			openapi: false,
		},
		telemetry: { serviceName: 'Shop', available: true },
	};

	const serverDir = join(dir, '.gkm', 'server');
	mkdirSync(serverDir, { recursive: true });
	const endpoints = new EndpointGenerator();
	await endpoints.build(
		context,
		await endpoints.load('endpoints/*.ts', dir),
		serverDir,
		{ target: 'server' },
	);
	const workerEntry = await new WorkerGenerator().build({
		context,
		workerId: 'Packing',
		outputDir: join(serverDir, 'workers', 'packing'),
		crons: await new CronGenerator().load('work/*.ts', dir),
		queues: await new QueueGenerator().load('work/*.ts', dir),
		subscribers: await new SubscriberGenerator().load('work/*.ts', dir),
	});

	const dist = join(serverDir, 'dist');
	const bundle = (entryPoint: string, outfile?: string) =>
		bundleServer({
			entryPoint,
			outputDir: dist,
			...(outfile ? { outfile } : {}),
			minify: false,
			sourcemap: false,
			external: [],
		});
	server = (await bundle(join(serverDir, 'server.ts'))).outputPath;
	worker = (await bundle(workerEntry, workerBundleName('Packing'))).outputPath;

	const client = new pg.Client({ connectionString: URL });
	await client.connect();
	await client.query(`create table ${TABLE} (id text)`);
	await client.end();
}, 120_000);

const children: ChildProcess[] = [];

afterAll(async () => {
	for (const child of children) child.kill('SIGKILL');
	const client = new pg.Client({ connectionString: URL });
	await client.connect();
	await client.query(`drop table if exists ${TABLE}`);
	await client.query(`drop schema if exists ${SCHEMA} cascade`);
	await client.end();
	rmSync(dir, { recursive: true, force: true });
	await new Promise((resolve) => receiver.close(resolve));
});

const freePort = () =>
	new Promise<number>((resolve) => {
		const s = createServer().listen(0, () => {
			const { port } = s.address() as { port: number };
			s.close(() => resolve(port));
		});
	});

/** A bundle, run with node alone, exporting to the receiver. */
async function start(bundle: string) {
	const port = await freePort();
	const child = spawn(process.execPath, [bundle], {
		// Somewhere with no node_modules: everything comes from the bundle.
		cwd: join(dir, '.gkm', 'server', 'dist'),
		env: {
			PATH: process.env.PATH,
			NODE_ENV: 'production',
			PORT: String(port),
			STORE_URL: URL,
			EVENT_PUBLISHER_CONNECTION_STRING: BROKER,
			[provideKey('Pack', 'publisherConnectionString')]: BROKER,
			OTEL_EXPORTER_OTLP_ENDPOINT: collector,
			OTEL_BSP_SCHEDULE_DELAY: '200',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	children.push(child);
	let output = '';
	child.stdout!.on('data', (chunk) => {
		output += chunk;
	});
	child.stderr!.on('data', (chunk) => {
		output += chunk;
	});

	const deadline = Date.now() + 30_000;
	for (;;) {
		const up = await fetch(`http://localhost:${port}/health`).then(
			(r) => r.ok,
			() => false,
		);
		if (up) break;
		if (Date.now() > deadline || child.exitCode !== null) {
			throw new Error(`${bundle} did not start:\n${output}`);
		}
		await new Promise((r) => setTimeout(r, 100));
	}
	return { port, child, output: () => output };
}

async function until<T>(find: () => T | undefined, what: string): Promise<T> {
	const deadline = Date.now() + 30_000;
	for (;;) {
		const found = find();
		if (found) return found;
		if (Date.now() > deadline) {
			throw new Error(
				`${what} was not exported in time:\n${JSON.stringify(
					spans.map((s) => [s.service, s.kind, s.name, s.traceId]),
					null,
					1,
				)}`,
			);
		}
		await new Promise((r) => setTimeout(r, 200));
	}
}

describe('request → queue → worker', { timeout: 120_000 }, () => {
	it('is one trace: SERVER → PRODUCER → CONSUMER → the job’s query', async () => {
		await start(worker);
		const api = await start(server);

		const response = await fetch(`http://localhost:${api.port}/orders`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id: 'order-1' }),
		});
		expect(response.status).toBe(200);

		const request = await until(
			() => spans.find((s) => s.kind === SERVER && s.name === 'POST /orders'),
			'the request span',
		);
		const inTrace = () => spans.filter((s) => s.traceId === request.traceId);

		const producer = await until(
			() => inTrace().find((s) => s.kind === PRODUCER),
			'the producer span',
		);
		const consumer = await until(
			() => inTrace().find((s) => s.kind === CONSUMER),
			'the consumer span',
		);
		const query = await until(
			() =>
				inTrace().find(
					(s) => s.kind === CLIENT && s.name === `insert ${TABLE}`,
				),
			'the job’s query span',
		);

		// The producer is the request's descendant, in the API's process.
		const ancestors = (span: OtlpSpan): string[] => {
			const parent = inTrace().find((s) => s.spanId === span.parentSpanId);
			return parent ? [parent.spanId, ...ancestors(parent)] : [];
		};
		expect(ancestors(producer)).toContain(request.spanId);
		expect(producer.service).toBe('Shop');
		expect(attr(producer.attributes, 'messaging.system')).toBe('pgboss');
		expect(attr(producer.attributes, 'messaging.destination.name')).toBe(
			'Pack',
		);

		// The worker's consumer span is the producer's child, in its process.
		expect(consumer.parentSpanId).toBe(producer.spanId);
		expect(consumer.service).toBe('Packing');
		expect(consumer.name).toBe('Pack process');

		// And the job's query is the consumer's child.
		expect(query.parentSpanId).toBe(consumer.spanId);
		expect(attr(query.attributes, 'db.system')).toBe('postgresql');
		expect(attr(query.attributes, 'db.operation')).toBe('insert');
		expect(JSON.stringify(query.attributes)).not.toContain('order-1');

		expect(
			new Set([request, producer, consumer, query].map((s) => s.traceId)).size,
		).toBe(1);
	});
});
