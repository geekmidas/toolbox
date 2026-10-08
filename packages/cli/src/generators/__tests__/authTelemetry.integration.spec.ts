import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import {
	createServer as createHttpServer,
	type IncomingMessage,
	type Server,
} from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POSTGRES_PORT } from '../../../../testkit/test/ports';
import { bundleServer } from '../../build/bundler';
import {
	writeSurfaceEntry,
	writeSurfaceServer,
} from '../../build/surfaceEntry';
import { EndpointGenerator } from '../EndpointGenerator';

/**
 * One trace across an API and its auth server: a bundled API whose endpoint
 * reads the session, and the bundled auth server it asks — the API's SERVER
 * span → the session check's CLIENT span → the auth server's SERVER span for
 * `get-session` — each process exporting to one OTLP receiver.
 *
 * The session check is an internal caller's request: it says whose request
 * it is in `x-gkm-client-ip`, not a forwarding header, so the auth server
 * continues the API's trace rather than starting one of its own.
 */

const DATABASE = `postgres://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`;

interface OtlpSpan {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	kind: number;
	links?: { traceId: string }[];
	attributes: { key: string; value: Record<string, unknown> }[];
}

/** OTLP's span kinds. */
const SERVER = 2;
const CLIENT = 3;

const spans: (OtlpSpan & { service?: string })[] = [];
let receiver: Server;
let collector: string;
let dir: string;
let apiBundle: string;
let authBundle: string;

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
	dir = mkdtempSync(join(cache, 'gkm-auth-trace-'));
	writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');

	writeFileSync(
		join(dir, 'auth.ts'),
		`import { BetterAuth } from '@geekmidas/constructs/auth';
import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';

export const auth = new BetterAuth('Auth', {
  path: '.',
  database: new KyselyDatabase('AuthDb'),
  options: { emailAndPassword: { enabled: true } },
});
`,
	);
	writeFileSync(
		join(dir, 'api.ts'),
		`import { RestApi } from '@geekmidas/constructs/rest-api';
import { createLogger } from '@geekmidas/logger/pino';
import { auth } from './auth';

export const api = new RestApi('Shop', {
  path: '.',
  defaultAuthorizer: 'none',
  logger: createLogger(),
}).auth(auth);
`,
	);
	mkdirSync(join(dir, 'endpoints'));
	writeFileSync(
		join(dir, 'endpoints', 'me.ts'),
		`import { z } from 'zod';
import { api } from '../api';

export const me = api
  .session(async ({ auth }) => auth.getSession())
  .get('/me')
  .output(z.object({ signedIn: z.boolean() }))
  .handle(async ({ session }) => ({ signedIn: Boolean(session) }));
`,
	);

	const telemetry = (serviceName: string) => ({
		serviceName,
		ignorePaths: [],
		attributes: {},
		routes: [],
	});

	// The API, as `gkm build --production` generates and bundles it.
	const apiDir = join(dir, '.gkm', 'server');
	mkdirSync(apiDir, { recursive: true });
	const endpoints = new EndpointGenerator();
	const module = { specifier: join(dir, 'api.ts'), exportName: 'api' };
	await endpoints.build(
		{
			surface: {
				id: 'Shop',
				trustedOriginsKey: 'SHOP_TRUSTED_ORIGINS',
				module,
			},
			owners: { Shop: module },
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
			telemetry: telemetry('Shop'),
		},
		await endpoints.load('endpoints/*.ts', dir),
		apiDir,
		{ target: 'server' },
	);
	apiBundle = (
		await bundleServer({
			entryPoint: join(apiDir, 'server.ts'),
			outputDir: join(apiDir, 'dist'),
			minify: false,
			sourcemap: false,
			external: [],
		})
	).outputPath;

	// The auth server: the construct's own app, behind the generated server.
	const authDir = join(dir, '.gkm', 'auth');
	const { auth } = await import(join(dir, 'auth.ts'));
	await writeSurfaceEntry(authDir, {
		file: join(dir, 'auth.ts'),
		exportName: 'auth',
		construct: auth,
	});
	const authEntry = await writeSurfaceServer(authDir, {
		healthCheck: '/health',
		gracefulShutdown: false,
		telemetry: telemetry('Auth'),
	});
	authBundle = (
		await bundleServer({
			entryPoint: authEntry,
			outputDir: join(authDir, 'dist'),
			minify: false,
			sourcemap: false,
			external: [],
		})
	).outputPath;
}, 180_000);

const children: ChildProcess[] = [];

afterAll(async () => {
	for (const child of children) child.kill('SIGKILL');
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
async function start(
	bundle: string,
	port: number,
	env: Record<string, string>,
): Promise<ChildProcess> {
	const child = spawn(process.execPath, [bundle], {
		// Somewhere with no node_modules: everything comes from the bundle.
		cwd: join(bundle, '..'),
		env: {
			PATH: process.env.PATH,
			NODE_ENV: 'production',
			PORT: String(port),
			OTEL_EXPORTER_OTLP_ENDPOINT: collector,
			OTEL_BSP_SCHEDULE_DELAY: '200',
			...env,
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
	return child;
}

async function until<T>(find: () => T | undefined, what: string): Promise<T> {
	const deadline = Date.now() + 30_000;
	for (;;) {
		const found = find();
		if (found) return found;
		if (Date.now() > deadline) {
			throw new Error(
				`${what} was not exported in time:\n${JSON.stringify(
					spans.map((s) => [
						s.service,
						s.kind,
						s.name,
						s.traceId,
						s.spanId,
						s.parentSpanId,
					]),
					null,
					1,
				)}`,
			);
		}
		await new Promise((r) => setTimeout(r, 200));
	}
}

describe('API → auth server', { timeout: 120_000 }, () => {
	it('is one trace: the API request → its session check → get-session', async () => {
		const authPort = await freePort();
		const authUrl = `http://127.0.0.1:${authPort}`;
		await start(authBundle, authPort, {
			AUTH_DB_URL: DATABASE,
			AUTH_SECRET: 'a-signing-secret-that-is-at-least-32-chars',
			AUTH_URL: authUrl,
		});
		const apiPort = await freePort();
		await start(apiBundle, apiPort, { AUTH_URL: authUrl });

		// From outside, through a proxy: the API starts its own trace.
		const response = await fetch(`http://localhost:${apiPort}/me`, {
			headers: { 'x-forwarded-for': '203.0.113.7' },
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ signedIn: false });

		const request = await until(
			() =>
				spans.find(
					(s) =>
						s.service === 'Shop' && s.kind === SERVER && s.name === 'GET /me',
				),
			"the API's request span",
		);
		const inTrace = () => spans.filter((s) => s.traceId === request.traceId);

		const getSession = await until(
			() =>
				inTrace().find(
					(s) =>
						s.service === 'Auth' &&
						s.kind === SERVER &&
						attr(s.attributes, 'url.path') === '/api/auth/get-session',
				),
			"the auth server's get-session span, in the API's trace",
		);
		// Parented, not linked: the auth server trusted the call as internal.
		expect(getSession.links ?? []).toEqual([]);

		// Its parent is the session check's CLIENT span, in the API ...
		const check = inTrace().find((s) => s.spanId === getSession.parentSpanId);
		expect(check).toBeDefined();
		expect(check!.service).toBe('Shop');
		expect(check!.kind).toBe(CLIENT);
		expect(attr(check!.attributes, 'url.full')).toBe(
			`${authUrl}/api/auth/get-session`,
		);

		// ... which runs inside the API's request span.
		const ancestors = new Set<string>();
		for (
			let span: OtlpSpan | undefined = check;
			span?.parentSpanId;
			span = inTrace().find((s) => s.spanId === span!.parentSpanId)
		) {
			ancestors.add(span.parentSpanId);
		}
		expect(ancestors).toContain(request.spanId);
	});
});
