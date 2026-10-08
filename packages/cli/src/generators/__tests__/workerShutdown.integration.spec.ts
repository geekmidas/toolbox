import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { provideKey } from '@geekmidas/manifest';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POSTGRES_PORT } from '../../../../testkit/test/ports';
import { bundleServer } from '../../build/bundler';
import { driversFor } from '../drivers';
import { QueueGenerator } from '../QueueGenerator';
import { WorkerGenerator, workerBundleName } from '../WorkerGenerator';

const URL = `postgres://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`;
// A schema of this run's own, so nothing another run left behind is pulled.
const SCHEMA = `worker_shutdown_${randomBytes(4).toString('hex')}`;
// What the worker is named to Postgres: its own, so nothing else running
// against the test database is counted.
const NAME = `ShutdownJobs-${process.pid}`;
const BROKER = `pgboss://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas?schema=${SCHEMA}`;

/**
 * A real worker, generated and bundled the way `gkm build --production` does
 * for an image, run as its own process against the test Postgres: what a container runs when Docker
 * stops it.
 *
 * The project sits under the CLI's own `node_modules/.cache` so its imports —
 * `@geekmidas/constructs`, `@geekmidas/events` — resolve from this package.
 */
let dir: string;
let entry: string;
let boss: PgBoss;

beforeAll(async () => {
	const cache = join(import.meta.dirname, '../../../node_modules/.cache');
	mkdirSync(cache, { recursive: true });
	dir = mkdtempSync(join(cache, 'gkm-worker-shutdown-'));
	writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');

	writeFileSync(
		join(dir, 'worker.ts'),
		`import { Worker } from '@geekmidas/constructs/worker';
import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';

export const orders = new KyselyDatabase('Orders');
export const jobs = new Worker('Jobs').database(orders);
`,
	);
	mkdirSync(join(dir, 'queues'));
	// Holds a database connection for as long as the message asks.
	writeFileSync(
		join(dir, 'queues', 'slow.ts'),
		`import { sql } from 'kysely';
import { z } from 'zod';
import { jobs } from '../worker';

export const slow = jobs
  .queue('Slow')
  .message(z.object({ seconds: z.number() }))
  .handle(async ({ messages, db }) => {
    for (const { seconds } of messages) {
      await sql\`select pg_sleep(\${seconds})\`.execute(db as any);
    }
  });
`,
	);

	const queues = await new QueueGenerator().load('queues/*.ts', dir);
	const module = { specifier: join(dir, 'worker.ts'), exportName: 'jobs' };
	const source = await new WorkerGenerator().build({
		context: {
			owners: { Jobs: module },
			eventsBackends: ['pgboss'],
			storageDrivers: driversFor({ appRoot: dir, events: ['pgboss'] }),
			production: {
				enabled: true,
				bundle: false,
				minify: false,
				healthCheck: '/health',
				gracefulShutdown: true,
				external: [],
				subscribers: 'exclude',
				openapi: false,
			},
		},
		workerId: 'Jobs',
		outputDir: join(dir, '.gkm', 'server', 'workers', 'jobs'),
		crons: [],
		queues,
		subscribers: [],
	});
	// Bundled, as an image runs it: one file, run with node alone.
	entry = (
		await bundleServer({
			entryPoint: source,
			outputDir: join(dir, '.gkm', 'server', 'dist'),
			outfile: workerBundleName('Jobs'),
			minify: false,
			sourcemap: false,
			external: [],
		})
	).outputPath;

	boss = new PgBoss({ connectionString: URL, schema: SCHEMA });
	await boss.start();
	await boss.createQueue('Slow');
}, 60_000);

afterAll(async () => {
	await boss?.stop({ graceful: false });
	const client = new pg.Client({ connectionString: URL });
	await client.connect();
	await client.query(`drop schema if exists ${SCHEMA} cascade`);
	await client.end();
	rmSync(dir, { recursive: true, force: true });
});

const freePort = () =>
	new Promise<number>((resolve) => {
		const server = createServer().listen(0, () => {
			const { port } = server.address() as { port: number };
			server.close(() => resolve(port));
		});
	});

/** The generated worker, started; resolves once its health check passes. */
async function start(env: Record<string, string>) {
	const port = await freePort();
	const child: ChildProcess = spawn(process.execPath, [entry], {
		cwd: dir,
		env: {
			...process.env,
			PORT: String(port),
			ORDERS_URL: URL,
			GKM_APP_NAME: NAME,
			[provideKey('Slow', 'publisherConnectionString')]: BROKER,
			...env,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let output = '';
	const collect = (chunk: Buffer) => {
		output += chunk;
	};
	child.stdout!.on('data', collect);
	child.stderr!.on('data', collect);
	const exited = new Promise<{ code: number | null; at: number }>((resolve) =>
		child.once('exit', (code) => resolve({ code, at: Date.now() })),
	);

	const deadline = Date.now() + 30_000;
	for (;;) {
		const up = await fetch(`http://localhost:${port}/health`).then(
			(r) => r.ok,
			() => false,
		);
		if (up) break;
		if (Date.now() > deadline || child.exitCode !== null) {
			child.kill('SIGKILL');
			throw new Error(`worker did not start:\n${output}`);
		}
		await new Promise((r) => setTimeout(r, 100));
	}

	return { port, child, exited, output: () => output };
}

/** A job's state, as pg-boss keeps it. */
async function stateOf(id: string): Promise<string | undefined> {
	const [job] = await boss.findJobs('Slow', { id });
	return job?.state;
}

async function until(
	check: () => Promise<boolean>,
	timeoutMs = 15_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!(await check())) {
		if (Date.now() > deadline) throw new Error('timed out waiting');
		await new Promise((r) => setTimeout(r, 50));
	}
}

/** Connections Postgres still has open for the worker, by its name. */
async function connectionsNamed(name: string): Promise<number> {
	const client = new pg.Client({ connectionString: URL });
	await client.connect();
	try {
		const { rows } = await client.query(
			'select count(*)::int as n from pg_stat_activity where application_name = $1',
			[name],
		);
		return rows[0].n;
	} finally {
		await client.end();
	}
}

describe('a worker stopped by SIGTERM', { timeout: 60_000 }, () => {
	it('finishes the job in flight, pulls no new one, and closes its connections', async () => {
		const { child, exited, output } = await start({
			GKM_SHUTDOWN_TIMEOUT_MS: '6000',
		});

		const inFlight = (await boss.send('Slow', { seconds: 1.5 }))!;
		const next = (await boss.send('Slow', { seconds: 0 }))!;
		// Mid-job: pulled, and holding a database connection.
		await until(async () => (await stateOf(inFlight)) === 'active');
		expect(await connectionsNamed(NAME)).toBeGreaterThan(0);

		const signalledAt = Date.now();
		child.kill('SIGTERM');

		const { code, at } = await exited;
		expect(code, output()).toBe(0);
		expect(at - signalledAt).toBeLessThan(6000);
		// The job it held finished; the one waiting was never pulled.
		expect(await stateOf(inFlight)).toBe('completed');
		expect(await stateOf(next)).toBe('created');
		expect(output()).toContain('Worker stopped');
		await until(async () => (await connectionsNamed(NAME)) === 0, 5_000);

		await boss.deleteJob('Slow', next);
	});

	it('exits 1 at the deadline when a job will not finish', async () => {
		const { child, exited, output } = await start({
			GKM_SHUTDOWN_TIMEOUT_MS: '1000',
		});

		const stuck = (await boss.send('Slow', { seconds: 10 }))!;
		await until(async () => (await stateOf(stuck)) === 'active');

		const signalledAt = Date.now();
		child.kill('SIGTERM');
		const { code, at } = await exited;

		// Its own exit, before an orchestrator's SIGKILL — and not a clean one.
		expect(code).toBe(1);
		expect(at - signalledAt).toBeGreaterThanOrEqual(900);
		expect(at - signalledAt).toBeLessThan(3000);
		expect(output()).toContain('Shutdown deadline reached');
	});
});
