import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { BetterAuth } from '@geekmidas/constructs/auth';
import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';
import { EnvironmentParser } from '@geekmidas/envkit';
import { serviceContext } from '@geekmidas/services';
import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POSTGRES_PORT } from '../../../../testkit/test/ports';
import { bundleServer } from '../../build/bundler';
import { EndpointGenerator } from '../EndpointGenerator';

/**
 * A production server, generated and bundled into one `server.mjs` the way
 * `gkm build --production` does for an image, and run as its own process —
 * held to what `gkm dev` and a feature test give the same endpoints.
 *
 * Three things it got wrong that dev got right: an endpoint built from a
 * router with `.auditor(...)` was handed `undefined` for `auditor`; an
 * unhandled error was logged as `{}`; and `.dependsOn([auth])` built the whole
 * auth server inside it, which needs a signing secret this app is not given.
 */

const DATABASE = `postgres://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`;
const schema = `parity_${randomUUID().slice(0, 8)}`;

let dir: string;
let bundle: string;
let authServer: Server;
let authUrl: string;

/** The auth server as its own app runs it: a real tenant, a real secret. */
function authConstruct() {
	return new BetterAuth('Auth', {
		path: 'auth',
		database: new KyselyDatabase('AuthDb'),
		options: { emailAndPassword: { enabled: true } },
	});
}

function authOptions(url: string) {
	return {
		envParser: new EnvironmentParser({
			AUTH_DB_URL: `${DATABASE}?search_path=${schema}`,
			AUTH_SECRET: 'a-signing-secret-that-is-at-least-32-chars',
			AUTH_URL: url,
		}),
		context: serviceContext,
	};
}

/** Start the auth server on a free port; its URL is only known once it listens. */
async function startAuthServer(): Promise<void> {
	let app: Hono | undefined;
	authServer = serve({
		fetch: (request) =>
			app ? app.fetch(request) : new Response(null, { status: 503 }),
		port: 0,
	}) as Server;
	await new Promise<void>((resolve) => {
		if (authServer.listening) resolve();
		else authServer.once('listening', () => resolve());
	});
	const { port } = authServer.address() as { port: number };
	authUrl = `http://127.0.0.1:${port}`;

	const client = new pg.Client({ connectionString: DATABASE });
	await client.connect();
	try {
		await client.query(`CREATE SCHEMA "${schema}"`);
		const pending = await authConstruct().pendingMigration(
			authOptions(authUrl),
		);
		await client.query(`SET search_path TO "${schema}"`);
		if (pending) await client.query(pending);
	} finally {
		await client.end();
	}

	({ app } = await authConstruct().server(authOptions(authUrl)));
}

beforeAll(async () => {
	await startAuthServer();

	const cache = join(import.meta.dirname, '../../../node_modules/.cache');
	mkdirSync(cache, { recursive: true });
	dir = mkdtempSync(join(cache, 'gkm-parity-'));
	writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');

	writeFileSync(
		join(dir, 'api.ts'),
		`import { BetterAuth } from '@geekmidas/constructs/auth';
import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';
import { RestApi } from '@geekmidas/constructs/rest-api';
import { createLogger } from '@geekmidas/logger/pino';

export const api = new RestApi('Api', { path: '.', logger: createLogger() });

// Another app's auth server: this one only calls it.
export const auth = new BetterAuth('Auth', {
  path: 'auth',
  database: new KyselyDatabase('AuthDb'),
});

// An audit storage that keeps what it is given, readable back over HTTP.
const records: { type: string; payload: unknown }[] = [];
export const auditStorage = {
  serviceName: 'auditStorage' as const,
  register: () => ({
    async write(batch: { type: string; payload: unknown }[]) {
      records.push(...batch);
    },
    async query() {
      return records;
    },
  }),
};
`,
	);
	mkdirSync(join(dir, 'endpoints'));
	writeFileSync(
		join(dir, 'endpoints', 'users.ts'),
		`import { UnauthorizedError } from '@geekmidas/errors';
import { z } from 'zod';
import { api, auditStorage, auth } from '../api';

const router = api.auditor(auditStorage as any);

export const createUser = router
  .post('/users')
  .body(z.object({ email: z.string() }))
  .output(z.object({ email: z.string() }))
  .handle(async ({ body, auditor }) => {
    auditor.audit('user.created' as never, { email: body.email } as never);
    return { email: body.email };
  });

export const audits = api
  .get('/audits')
  .output(z.object({ audits: z.array(z.object({ type: z.string(), payload: z.any() })) }))
  .handle(async () => ({
    audits: (await auditStorage.register().query()).map(({ type, payload }) => ({ type, payload })),
  }));

export const boom = api
  .get('/boom')
  .output(z.object({ ok: z.boolean() }))
  .handle(async () => {
    throw new TypeError('the handler broke');
  });

export const me = api
  .get('/me')
  .dependsOn([auth])
  .output(z.object({ email: z.string() }))
  .handle(async ({ services, header }) => {
    const session = await services.auth.api.getSession({
      headers: { cookie: header('cookie') ?? '' },
    });
    if (!session) throw new UnauthorizedError('Not signed in');
    return { email: session.user.email };
  });
`,
	);

	const outputDir = join(dir, '.gkm', 'server');
	mkdirSync(outputDir, { recursive: true });
	const generator = new EndpointGenerator();
	const constructs = await generator.load('endpoints/*.ts', dir);
	const module = { specifier: join(dir, 'api.ts'), exportName: 'api' };
	await generator.build(
		{
			surface: { id: 'Api', trustedOriginsKey: 'API_TRUSTED_ORIGINS', module },
			owners: { Api: module },
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
		},
		constructs,
		outputDir,
		{ target: 'server' },
	);

	const { outputPath } = await bundleServer({
		entryPoint: join(outputDir, 'server.ts'),
		outputDir: join(outputDir, 'dist'),
		minify: false,
		sourcemap: false,
		external: [],
	});
	bundle = outputPath;
}, 180_000);

afterAll(async () => {
	if (dir) rmSync(dir, { recursive: true, force: true });
	await new Promise((resolve) => authServer?.close(resolve));
	const client = new pg.Client({ connectionString: DATABASE });
	await client.connect();
	await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
	await client.end();
});

const freePort = () =>
	new Promise<number>((resolve) => {
		const server = createServer().listen(0, () => {
			const { port } = server.address() as { port: number };
			server.close(() => resolve(port));
		});
	});

/** The environment the API's container is given: the auth URL, no secret. */
const apiEnv = () => ({
	PATH: process.env.PATH ?? '',
	NODE_ENV: 'production',
	AUTH_URL: authUrl,
});

/** The bundle, started with node alone; resolves once /health answers. */
async function start(env: Record<string, string>) {
	const port = await freePort();
	const child = spawn(process.execPath, [bundle], {
		// Somewhere with no node_modules: everything comes from the bundle.
		cwd: join(dir, '.gkm', 'server', 'dist'),
		env: { ...env, PORT: String(port) },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
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
			throw new Error(`server did not start:\n${output}`);
		}
		await new Promise((r) => setTimeout(r, 100));
	}

	return { port, child, output: () => output };
}

/** The JSON lines the server logged. */
function logLines(output: string): Record<string, any>[] {
	return output
		.split('\n')
		.filter((line) => line.startsWith('{'))
		.map((line) => JSON.parse(line));
}

describe('a bundled production server', { timeout: 60_000 }, () => {
	let server: {
		port: number;
		child: ChildProcess;
		output: () => string;
	};
	const url = (path: string) => `http://localhost:${server.port}${path}`;

	beforeAll(async () => {
		server = await start(apiEnv());
	}, 40_000);

	afterAll(() => {
		server?.child.kill('SIGKILL');
	});

	it('hands an endpoint from an .auditor() router a working auditor', async () => {
		const response = await fetch(url('/users'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email: 'ada@example.com' }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ email: 'ada@example.com' });

		const { audits } = await (await fetch(url('/audits'))).json();
		expect(audits).toEqual([
			{ type: 'user.created', payload: { email: 'ada@example.com' } },
		]);
	});

	it('logs a thrown error with its message and stack', async () => {
		const response = await fetch(url('/boom'));
		expect(response.status).toBe(500);

		await expect
			.poll(() =>
				logLines(server.output()).find(
					(line) => line.err?.message === 'the handler broke',
				),
			)
			.toBeDefined();
		const line = logLines(server.output()).find(
			(l) => l.err?.message === 'the handler broke',
		)!;
		expect(line.level).toBe('ERROR');
		expect(line.err.type).toBe('TypeError');
		expect(line.err.stack).toContain('TypeError: the handler broke');
	});

	it('logs what the app-level error handler catches under err', () => {
		const app = readFileSync(join(dir, '.gkm', 'server', 'app.ts'), 'utf8');

		expect(app).toContain("logger.error({ err: error }, 'Unhandled error')");
		expect(app).not.toMatch(/logger\.error\(\{ error[ ,}]/);
	});

	describe('with .dependsOn([auth]) in an app that is not the auth server', () => {
		it('starts and serves without the auth server’s secret, tenant or mailer', () => {
			const env = apiEnv();

			expect(env).not.toHaveProperty('AUTH_SECRET');
			expect(env).not.toHaveProperty('AUTH_DB_URL');
			expect(env).not.toHaveProperty('MAIL_URL');
			expect(server.child.exitCode).toBeNull();
		});

		it('reads a signed-in cookie’s user from the auth server, over HTTP', async () => {
			const email = `grace-${randomUUID()}@example.com`;
			const signUp = await fetch(`${authUrl}/api/auth/sign-up/email`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', origin: authUrl },
				body: JSON.stringify({
					email,
					password: 'correct horse battery',
					name: 'Grace',
				}),
			});
			expect(signUp.status).toBe(200);
			const cookie = signUp.headers
				.getSetCookie()
				.map((c) => c.split(';')[0])
				.join('; ');

			const response = await fetch(url('/me'), { headers: { cookie } });

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ email });
		});

		it('answers 401 with no cookie', async () => {
			const response = await fetch(url('/me'));

			expect(response.status).toBe(401);
		});

		it('answers 401 for a cookie the auth server does not know', async () => {
			const response = await fetch(url('/me'), {
				headers: { cookie: 'better-auth.session_token=not-a-real-token' },
			});

			expect(response.status).toBe(401);
		});
	});
});
