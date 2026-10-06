import { randomUUID } from 'node:crypto';
import {
	cpSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { EnvironmentParser } from '@geekmidas/envkit';
import { provideKey } from '@geekmidas/manifest';
import { serviceContext } from '@geekmidas/services';
import pg from 'pg';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	type MockInstance,
	vi,
} from 'vitest';
import { TEST_DATABASE_CONFIG } from '../../../../testkit/test/globalSetup';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import type { DiscoveryResponse } from '../discovery';
import { auth } from './__fixtures__/constructs-app/constructs/auth';

/**
 * `gkm dev` against an app written the way apps are now: a `RestApi` its
 * endpoints are built from, a `BetterAuth` that serves itself, a database with
 * a schema tenant, and a `Worker` beside them — no `apps` block, no module
 * paths in config.
 *
 * Everything runs: config loading, discovery, the build, the spawned server,
 * and requests to it over HTTP, against the test Postgres. The one boundary
 * replaced is reconcile's containers — a surface brings a Caddy, and starting
 * one per run would collide with every other stack on the machine. It hands
 * back the URLs reconcile would have, pointed at a schema made for this run.
 */

const fakes = vi.hoisted(() => ({ env: {} as Record<string, string> }));

vi.mock('../../reconcile/workspace.js', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('../../reconcile/workspace.js')>();
	return {
		...actual,
		reconcileWorkspace: vi.fn(async () => ({
			changed: false,
			plan: { containers: [], resources: [] },
			services: [],
			env: fakes.env,
		})),
	};
});

const { devCommand } = await import('../index');

const FIXTURE = join(import.meta.dirname, '__fixtures__', 'constructs-app');
const WEB_ORIGIN = 'http://web.shop.localhost';

// A schema of its own in the shared test database, so runs never see each
// other's users; dropping a schema needs no connection to be killed.
const schema = `dev_spec_${randomUUID().slice(0, 8)}`;
const { host, port, user, password, database } = TEST_DATABASE_CONFIG;
const url = `postgres://${user}:${password}@${host}:${port}/${database}?search_path=${schema}`;
// The events broker: pg-boss in a schema of its own, which it creates.
const brokerSchema = `${schema}_pgboss`;
const broker = `pgboss://${user}:${password}@${host}:${port}/${database}?schema=${brokerSchema}`;

/** What reconcile resolves for this workspace, with auth answering on `authPort`. */
function envFor(authPort: number): Record<string, string> {
	return {
		[provideKey('Database', 'url')]: url,
		[provideKey('Database', 'ownerUrl')]: url,
		[provideKey('AuthDatabase', 'url')]: url,
		[provideKey('AuthDatabase', 'ownerUrl')]: url,
		// A secret's name is its key: `Auth` signs with `AUTH_SECRET`.
		AUTH_SECRET: 'a-signing-secret-that-is-at-least-32-chars',
		[provideKey('Auth', 'url')]: `http://localhost:${authPort}`,
		[provideKey('Auth', 'trustedOrigins')]: WEB_ORIGIN,
		[provideKey('Api', 'trustedOrigins')]: WEB_ORIGIN,
		// What reconcile resolves for a declared worker on pg-boss: the broker a
		// server schedules the worker's crons through.
		EVENT_PUBLISHER_CONNECTION_STRING: broker,
	};
}

async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((r) => server.listen(0, r));
	const address = server.address();
	await new Promise((r) => server.close(r));
	if (!address || typeof address === 'string') throw new Error('no port');
	return address.port;
}

/** Resolves once `check` holds, polling. */
async function until(
	check: () => boolean | Promise<boolean>,
	timeout = 30_000,
): Promise<void> {
	const start = Date.now();
	while (!(await check())) {
		if (Date.now() - start > timeout) throw new Error('timed out waiting');
		await new Promise((r) => setTimeout(r, 100));
	}
}

/** Whether anything answers on `port` yet. */
const answers = (port: number) => () =>
	fetch(`http://localhost:${port}/`).then(
		() => true,
		() => false,
	);

beforeAll(async () => {
	const client = new pg.Client(TEST_DATABASE_CONFIG);
	await client.connect();
	await client.query(`CREATE SCHEMA "${schema}"`);
	await client.end();

	// better-auth's own tables, from the SQL `gkm migration` would commit for
	// the tenant, run in its schema.
	const pending = await auth.pendingMigration({
		envParser: new EnvironmentParser(envFor(0)),
		context: serviceContext,
	});
	if (pending) {
		const tenant = new pg.Client(TEST_DATABASE_CONFIG);
		await tenant.connect();
		try {
			await tenant.query(`SET search_path TO "${schema}"`);
			await tenant.query(pending);
		} finally {
			await tenant.end();
		}
	}
});

afterAll(async () => {
	const client = new pg.Client(TEST_DATABASE_CONFIG);
	await client.connect();
	await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
	await client.query(`DROP SCHEMA IF EXISTS "${brokerSchema}" CASCADE`);
	await client.end();
});

describe(
	'gkm dev, on the constructs an app is written with',
	{
		timeout: 90_000,
	},
	() => {
		let dir: string;
		let cwd: string;
		let signals: Record<string, () => void>;
		let exit: MockInstance;
		let log: MockInstance;
		const originalOn = process.on.bind(process);

		const output = (spy: MockInstance) => spy.mock.calls.flat().join('\n');

		beforeEach(async () => {
			signals = {};
			// Resolved, because the process sees the real path and macOS's temp
			// directory is behind a symlink.
			dir = realpathSync(await createTempDir('gkm-dev-constructs-'));
			cwd = process.cwd();
			vi.stubEnv('HOME', dir);

			cpSync(FIXTURE, dir, { recursive: true });
			writeFileSync(
				join(dir, 'package.json'),
				JSON.stringify({ name: 'shop', private: true, type: 'module' }),
			);
			// An app is a directory with a package name. The auth app has nothing
			// else in it: its server is the construct's.
			for (const app of ['api', 'auth']) {
				mkdirSync(join(dir, 'apps', app), { recursive: true });
				writeFileSync(
					join(dir, 'apps', app, 'package.json'),
					JSON.stringify({
						name: `@shop/${app}`,
						private: true,
						type: 'module',
					}),
				);
			}
			// What shop's says: a name, the stages, and where constructs live.
			// The apps are read off the graph.
			writeFileSync(
				join(dir, 'gkm.config.ts'),
				`import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'shop',
  stages: { local: 'dev', deployed: ['prod'] },
  constructs: ['./constructs/**/*.ts', './apps/*/endpoints/**/*.ts'],
});
`,
			);

			vi.spyOn(process, 'on').mockImplementation(((
				event: string,
				handler: () => void,
			) => {
				if (event === 'SIGINT' || event === 'SIGTERM') {
					signals[event] = handler;
					return process;
				}
				return originalOn(event, handler);
			}) as typeof process.on);
			exit = vi
				.spyOn(process, 'exit')
				.mockImplementation((() => undefined) as never);
			log = vi.spyOn(console, 'log');
		});

		afterEach(async () => {
			// Stop the server even when an assertion failed, or it outlives the run.
			if (signals.SIGINT && exit?.mock.calls.length === 0) {
				signals.SIGINT();
				await until(() => exit.mock.calls.length > 0);
			}
			process.chdir(cwd);
			vi.unstubAllEnvs();
			vi.restoreAllMocks();
			await cleanupDir(dir);
		});

		/** `gkm dev` run from inside an app, the way turbo runs it. */
		async function dev(app: string, env: Record<string, string>) {
			fakes.env = env;
			process.chdir(join(dir, 'apps', app));
			const port = await freePort();
			await devCommand({ port, portExplicit: true });
			await until(answers(port));
			return (path: string, init?: RequestInit) =>
				fetch(`http://localhost:${port}${path}`, init);
		}

		it('serves the API: its endpoints, the database it declared, and its dev tools', async () => {
			const authPort = await freePort();
			const request = await dev('api', envFor(authPort));

			// The auth server's address is the one reconcile resolved — behind
			// the edge, where its trusted origins point — not the workspace's
			// `http://localhost:<port>` fallback, which used to overwrite it.
			const written = JSON.parse(
				readFileSync(join(dir, '.gkm', 'dev-secrets-api.json'), 'utf-8'),
			);
			expect(written[provideKey('Auth', 'url')]).toBe(
				`http://localhost:${authPort}`,
			);

			const health = await request('/health');
			expect(health.status).toBe(200);
			expect(await health.json()).toEqual({ ok: true });

			// Through the surface's `.database()` branch, to the test Postgres.
			const db = await request('/database');
			expect(db.status).toBe(200);
			expect(await db.json()).toEqual({ answer: 42 });

			// The worker's cron, scheduled through the broker — the row pg-boss
			// fires it from, not a timer in the process.
			await until(async () => {
				const client = new pg.Client(TEST_DATABASE_CONFIG);
				await client.connect();
				try {
					const { rows } = await client.query(
						`select name, cron from "${brokerSchema}".schedule`,
					);
					return rows.some(
						(row) => row.name === 'cron.nightly' && row.cron === '0 0 * * *',
					);
				} catch {
					return false;
				} finally {
					await client.end();
				}
			});

			// The surface declared no Telescope; the entry supplies one. Headless:
			// its JSON API, no dashboard.
			expect((await request('/__telescope/api/stats')).status).toBe(200);
			expect((await request('/__telescope')).status).toBe(404);

			// The declared database, read through its JSON API with the client the
			// handlers use.
			const tables = await request('/__gkm/db/tables');
			expect(tables.status).toBe(200);
			expect(await tables.json()).toMatchObject({
				tables: expect.any(Array),
			});
			expect(output(log)).toContain('db /__gkm/db');

			// Found through discovery, from the connect URL dev printed — the
			// suite runs it on a port of its own — and read through it.
			const connect = output(log).match(
				/🧭 Discovery: (http:\/\/127\.0\.0\.1:\d+\/__gkm\?token=\S+)/,
			)?.[1];
			expect(connect).toBeDefined();
			const discovered = await fetch(connect!);
			expect(discovered.status).toBe(200);
			const { workspaces } = (await discovered.json()) as DiscoveryResponse;
			// This workspace's: the suite's other `gkm dev`s share the registry.
			const api = workspaces
				.find((w) => w.root === dir)
				?.apps.find((a) => a.name === 'api');
			expect(api).toMatchObject({
				status: 'ready',
				dataApis: expect.arrayContaining([
					expect.objectContaining({ kind: 'database', path: '/__gkm/db' }),
					expect.objectContaining({
						kind: 'telescope',
						path: '/__telescope/api',
					}),
				]),
			});
			const database = api?.dataApis.find((a) => a.kind === 'database');
			const { origin, searchParams } = new URL(connect!);
			const proxied = await fetch(`${origin}${database?.proxy}/tables`, {
				headers: { authorization: `Bearer ${searchParams.get('token')}` },
			});
			expect(proxied.status).toBe(200);
			expect(await proxied.json()).toMatchObject({
				tables: expect.any(Array),
			});

			// CORS from the graph: the web origin may call it, nothing else.
			const preflight = await request('/health', {
				method: 'OPTIONS',
				headers: {
					origin: WEB_ORIGIN,
					'access-control-request-method': 'GET',
				},
			});
			expect(preflight.headers.get('access-control-allow-origin')).toBe(
				WEB_ORIGIN,
			);
		});

		it('serves the auth server from its own declaration', async () => {
			const authPort = await freePort();
			fakes.env = envFor(authPort);
			process.chdir(join(dir, 'apps', 'auth'));
			await devCommand({ port: authPort, portExplicit: true });
			await until(answers(authPort));
			const request = (path: string, init?: RequestInit) =>
				fetch(`http://localhost:${authPort}${path}`, init);

			// Started from its own declaration, and advertising nothing it does not
			// mount: an auth server has no docs, Telescope or database API.
			expect(output(log)).toMatch(/auth ready in [\d.]+s/);
			expect(output(log)).not.toContain('docs /__docs');
			expect(output(log)).not.toContain('db /__gkm/db');

			// Signed out is an answer, not a failure.
			const signedOut = await request('/api/auth/get-session');
			expect(signedOut.status).toBe(200);
			expect(await signedOut.json()).toBeNull();

			// A real sign-up, in the schema its migrations made, and a session back.
			const email = `ada-${randomUUID()}@shop.test`;
			const signUp = await request('/api/auth/sign-up/email', {
				method: 'POST',
				headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
				body: JSON.stringify({
					email,
					password: 'correct horse battery',
					name: 'Ada',
				}),
			});
			expect(signUp.status).toBe(200);

			const cookie = signUp.headers.getSetCookie().join('; ');
			const session = await request('/api/auth/get-session', {
				headers: { cookie },
			});
			expect((await session.json())?.user.email).toBe(email);
		});

		it('stops the server on a signal', async () => {
			const port = await freePort();
			fakes.env = envFor(await freePort());
			process.chdir(join(dir, 'apps', 'api'));
			await devCommand({ port, portExplicit: true });
			await until(answers(port));

			signals.SIGINT!();
			await until(() => exit.mock.calls.length > 0);

			await until(async () => !(await answers(port)()));
		});
	},
);
