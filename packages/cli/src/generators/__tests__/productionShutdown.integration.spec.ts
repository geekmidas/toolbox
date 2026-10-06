import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POSTGRES_PORT } from '../../../../testkit/test/ports';
import { EndpointGenerator } from '../EndpointGenerator';

const URL = `postgres://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`;

/**
 * A real production server, generated the way `gkm build --production` does,
 * run as its own process: what a container runs when Docker stops it.
 *
 * The project sits under the CLI's own `node_modules/.cache` so its imports —
 * `@geekmidas/constructs`, `@hono/node-server` — resolve from this package.
 */
let dir: string;

beforeAll(async () => {
	const cache = join(import.meta.dirname, '../../../node_modules/.cache');
	mkdirSync(cache, { recursive: true });
	dir = mkdtempSync(join(cache, 'gkm-shutdown-'));
	// An app is an ES module, as a generated server's top-level await needs.
	writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');

	writeFileSync(
		join(dir, 'api.ts'),
		`import { RestApi } from '@geekmidas/constructs/rest-api';
import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';

export const api = new RestApi('Api', { path: '.' });
export const orders = new KyselyDatabase('Orders');
`,
	);
	mkdirSync(join(dir, 'endpoints'));
	// Holds a database connection for as long as the request asks.
	writeFileSync(
		join(dir, 'endpoints', 'slow.ts'),
		`import { sql } from 'kysely';
import { z } from 'zod';
import { api, orders } from '../api';

export const slow = api
  .database(orders)
  .get('/slow')
  .query(z.object({ seconds: z.coerce.number() }))
  .output(z.object({ ok: z.boolean() }))
  .handle(async ({ db, query }) => {
    await sql\`select pg_sleep(\${query.seconds})\`.execute(db as any);
    return { ok: true };
  });
`,
	);

	mkdirSync(join(dir, '.gkm', 'server'), { recursive: true });
	const generator = new EndpointGenerator();
	const constructs = await generator.load('endpoints/*.ts', dir);
	const module = { specifier: join(dir, 'api.ts'), exportName: 'api' };
	await generator.build(
		{
			surface: { id: 'Api', trustedOriginsKey: 'API_TRUSTED_ORIGINS', module },
			owners: { Api: module },
			production: {
				enabled: true,
				bundle: false,
				minify: false,
				healthCheck: '/health',
				gracefulShutdown: true,
				external: [],
				subscribers: 'exclude',
				openapi: false,
				optimizedHandlers: false,
			},
		},
		constructs,
		join(dir, '.gkm', 'server'),
		{ target: 'server' },
	);
}, 60_000);

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

const freePort = () =>
	new Promise<number>((resolve) => {
		const server = createServer().listen(0, () => {
			const { port } = server.address() as { port: number };
			server.close(() => resolve(port));
		});
	});

/** The generated server, started; resolves once /health answers. */
async function start(env: Record<string, string>) {
	const port = await freePort();
	const child = spawn(
		process.execPath,
		['--import', 'tsx', join(dir, '.gkm', 'server', 'server.ts')],
		{
			cwd: dir,
			env: { ...process.env, PORT: String(port), ORDERS_URL: URL, ...env },
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	);
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
			throw new Error(`server did not start:\n${output}`);
		}
		await new Promise((r) => setTimeout(r, 100));
	}

	return { port, child, exited, output: () => output };
}

/** Connections Postgres still has open for the server, by its name. */
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

describe('a production server stopped by SIGTERM', { timeout: 60_000 }, () => {
	let server: Awaited<ReturnType<typeof start>> | undefined;

	it('finishes the request in flight, takes no new one, and closes its pools', async () => {
		server = await start({ GKM_SHUTDOWN_TIMEOUT_MS: '5000' });
		const { port, child, exited } = server;

		const inFlight = fetch(`http://localhost:${port}/slow?seconds=1.5`);
		// Let the request reach the database before the signal.
		await new Promise((r) => setTimeout(r, 400));
		expect(await connectionsNamed('Api')).toBeGreaterThan(0);

		const signalledAt = Date.now();
		child.kill('SIGTERM');

		// Stopped taking requests: a new one is refused while the slow one drains.
		await new Promise((r) => setTimeout(r, 200));
		await expect(fetch(`http://localhost:${port}/health`)).rejects.toThrow();

		const response = await inFlight;
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });

		const { code, at } = await exited;
		expect(code).toBe(0);
		expect(at - signalledAt).toBeLessThan(5000);
		expect(await connectionsNamed('Api')).toBe(0);
	});

	it('exits at the deadline when a request will not finish', async () => {
		server = await start({ GKM_SHUTDOWN_TIMEOUT_MS: '1000' });
		const { port, child, exited, output } = server;

		fetch(`http://localhost:${port}/slow?seconds=10`).catch(() => {});
		await new Promise((r) => setTimeout(r, 400));

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
