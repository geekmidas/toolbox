import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

const URL = `postgres://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`;
const run = randomBytes(4).toString('hex');
// A broker schema and an effects table of this run's own.
const SCHEMA = `worker_bundle_${run}`;
const TABLE = `worker_effects_${run}`;
const BROKER = `pgboss://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas?schema=${SCHEMA}`;

/**
 * An API and its Worker, each generated and bundled the way `gkm build
 * --production` does for an image, each run as its own process.
 *
 * A request to the API sends a message to a queue and an event to a topic;
 * the worker's consumer and subscriber write what they saw, and its cron
 * writes on its schedule. The API runs none of them.
 */
let dir: string;
let server: string;
let worker: string;

beforeAll(async () => {
	const cache = join(import.meta.dirname, '../../../node_modules/.cache');
	mkdirSync(cache, { recursive: true });
	dir = mkdtempSync(join(cache, 'gkm-worker-bundle-'));
	writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');

	writeFileSync(
		join(dir, 'constructs.ts'),
		`import { RestApi } from '@geekmidas/constructs/rest-api';
import { Worker } from '@geekmidas/constructs/worker';
import { Topic } from '@geekmidas/constructs/topic';
import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';
import { z } from 'zod';

export const api = new RestApi('Storefront', { path: '.', defaultAuthorizer: 'none' });
export const store = new KyselyDatabase('Store');
export const jobs = new Worker('Fulfilment').database(store);
export const things = new Topic('Things', {
  events: { 'thing.happened': z.object({ id: z.string() }) },
});
`,
	);
	mkdirSync(join(dir, 'work'));
	writeFileSync(
		join(dir, 'work', 'effects.ts'),
		`import { sql } from 'kysely';
import { z } from 'zod';
import { jobs, things } from '../constructs';

const record = (db: any, kind: string, id: string) =>
  sql\`insert into ${TABLE} (kind, id, pid) values (\${kind}, \${id}, \${process.pid})\`.execute(db);

export const work = jobs
  .queue('Work')
  .message(z.object({ id: z.string() }))
  .handle(async ({ messages, db }) => {
    for (const { id } of messages) await record(db, 'queue', id);
  });

export const onThing = jobs
  .topic(things)
  .subscribe(['thing.happened'])
  .handle(async ({ events, db }) => {
    for (const event of events) await record(db, 'topic', event.payload.id);
  });

export const tick = jobs
  .cron('rate(1 minute)')
  .handle(async ({ db }) => {
    await record(db, 'cron', new Date().toISOString());
  });
`,
	);
	mkdirSync(join(dir, 'endpoints'));
	writeFileSync(
		join(dir, 'endpoints', 'things.ts'),
		`import { z } from 'zod';
import { api, things } from '../constructs';
import { work } from '../work/effects';

export const createThing = api
  .post('/things')
  .dependsOn([work])
  .body(z.object({ id: z.string() }))
  .output(z.object({ id: z.string() }))
  .event(things, {
    type: 'thing.happened',
    payload: (thing) => ({ id: thing.id }),
  })
  .handle(async ({ body, services }) => {
    await services.work.publish([{ type: 'Work', payload: { id: body.id } }]);
    return { id: body.id };
  });
`,
	);

	const module = (exportName: string) => ({
		specifier: join(dir, 'constructs.ts'),
		exportName,
	});
	const production = {
		enabled: true,
		bundle: true,
		minify: false,
		healthCheck: '/health',
		gracefulShutdown: true,
		external: [],
		subscribers: 'exclude' as const,
		openapi: false,
	};
	const context: BuildContext = {
		surface: {
			id: 'Storefront',
			trustedOriginsKey: 'STOREFRONT_TRUSTED_ORIGINS',
			module: module('api'),
		},
		owners: { Storefront: module('api'), Fulfilment: module('jobs') },
		eventsBackends: ['pgboss'],
		storageDrivers: driversFor({ appRoot: dir, events: ['pgboss'] }),
		production,
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
		workerId: 'Fulfilment',
		outputDir: join(serverDir, 'workers', 'fulfilment'),
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
	worker = (await bundle(workerEntry, workerBundleName('Fulfilment')))
		.outputPath;

	const client = new pg.Client({ connectionString: URL });
	await client.connect();
	await client.query(
		`create table ${TABLE} (kind text, id text, pid int, at timestamptz default now())`,
	);
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
});

const freePort = () =>
	new Promise<number>((resolve) => {
		const s = createServer().listen(0, () => {
			const { port } = s.address() as { port: number };
			s.close(() => resolve(port));
		});
	});

const ENV = {
	STORE_URL: URL,
	EVENT_PUBLISHER_CONNECTION_STRING: BROKER,
	[provideKey('Work', 'publisherConnectionString')]: BROKER,
	[provideKey('Things', 'publisherConnectionString')]: BROKER,
};

/** A bundle, run with node alone; resolves once its health check passes. */
async function start(bundle: string) {
	const port = await freePort();
	const child = spawn(process.execPath, [bundle], {
		cwd: dir,
		env: { ...process.env, PORT: String(port), ...ENV },
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

async function effects(): Promise<{ kind: string; id: string; pid: number }[]> {
	const client = new pg.Client({ connectionString: URL });
	await client.connect();
	try {
		const { rows } = await client.query(
			`select kind, id, pid from ${TABLE} order by at`,
		);
		return rows;
	} finally {
		await client.end();
	}
}

async function until<T>(
	read: () => Promise<T>,
	done: (value: T) => boolean,
	timeoutMs: number,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await read();
		if (done(value)) return value;
		if (Date.now() > deadline) return value;
		await new Promise((r) => setTimeout(r, 250));
	}
}

describe('a worker bundle beside its API', { timeout: 180_000 }, () => {
	it('runs the cron, the queue consumer and the subscriber; the API serves only HTTP', async () => {
		const workerProcess = await start(worker);
		const apiProcess = await start(server);

		const response = await fetch(`http://localhost:${apiProcess.port}/things`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id: 'thing-1' }),
		});
		expect(response.ok).toBe(true);

		const pid = workerProcess.child.pid;
		const seen = await until(
			effects,
			(rows) =>
				['queue', 'topic'].every((kind) =>
					rows.some((r) => r.kind === kind && r.id === 'thing-1'),
				),
			20_000,
		);
		// Each in the worker's process.
		expect(seen.filter((r) => r.kind !== 'cron')).toEqual(
			expect.arrayContaining([
				{ kind: 'queue', id: 'thing-1', pid },
				{ kind: 'topic', id: 'thing-1', pid },
			]),
		);

		// pg-boss fires a minute's schedule on the minute, checked every 30s.
		const fired = await until(
			effects,
			(rows) => rows.some((r) => r.kind === 'cron'),
			120_000,
		);
		expect(fired.find((r) => r.kind === 'cron')?.pid).toBe(pid);

		// The API started no consumer and scheduled nothing.
		expect(apiProcess.output()).not.toMatch(
			/Queue consumer started|Subscriber started|Cron scheduled/,
		);
		expect(workerProcess.output()).toMatch(/Queue consumer started/);
		expect((await effects()).every((r) => r.pid !== apiProcess.child.pid)).toBe(
			true,
		);

		// The worker answers its health check and nothing else.
		const other = await fetch(`http://localhost:${workerProcess.port}/things`);
		expect(other.status).toBe(404);
		const health = await fetch(`http://localhost:${workerProcess.port}/health`);
		expect(await health.json()).toMatchObject({
			status: 'ok',
			healthy: true,
			failed: [],
			down: 0,
		});
	});
});
