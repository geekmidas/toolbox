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
import { bundleServer } from '../../build/bundler';
import { EndpointGenerator } from '../EndpointGenerator';
import { routeTelemetry } from '../telemetry';

/**
 * A real production server, generated and bundled into one `server.mjs` the
 * way `gkm build --production` does for an image, run as its own process
 * against an OTLP receiver in this test.
 *
 * The bundle is the case that matters: inside it no module is loaded through
 * `require`, so OpenTelemetry's load-time hooks see neither pino nor
 * `node:http`'s server. What arrives here is what the code sends explicitly —
 * the logger's bridge and the request middleware.
 *
 * The OTLP/HTTP exporters the setup uses (`exporter-*-otlp-http`) send JSON,
 * so the receiver decodes JSON; no protocol variable is needed.
 */

interface OtlpSpan {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	kind: number;
	status?: { code?: number };
	attributes: { key: string; value: Record<string, unknown> }[];
	events?: { name: string }[];
	links?: { traceId: string; spanId: string }[];
}

interface OtlpLog {
	traceId?: string;
	spanId?: string;
	severityText?: string;
	body?: { stringValue?: string };
	attributes?: { key: string; value: Record<string, unknown> }[];
}

/** SPAN_KIND_SERVER in OTLP's encoding. */
const SERVER = 2;
/** STATUS_CODE_ERROR in OTLP's encoding. */
const ERROR = 2;

const spans: OtlpSpan[] = [];
const logs: OtlpLog[] = [];
let receiver: Server;
let collector: string;
let dir: string;
let bundle: string;

function body(req: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		let data = '';
		req.on('data', (chunk) => {
			data += chunk;
		});
		req.on('end', () => resolve(data));
	});
}

/** A value of an OTLP attribute, whatever its type. */
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
				for (const scope of resource.scopeSpans ?? []) {
					spans.push(...(scope.spans ?? []));
				}
			}
		} else if (req.url === '/v1/logs') {
			for (const resource of payload.resourceLogs ?? []) {
				for (const scope of resource.scopeLogs ?? []) {
					logs.push(...(scope.logRecords ?? []));
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
	dir = mkdtempSync(join(cache, 'gkm-telemetry-'));
	writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');

	writeFileSync(
		join(dir, 'api.ts'),
		`import { RestApi } from '@geekmidas/constructs/rest-api';
import { createLogger } from '@geekmidas/logger/pino';

export const api = new RestApi('Api', { path: '.', logger: createLogger() });
`,
	);
	mkdirSync(join(dir, 'endpoints'));
	writeFileSync(
		join(dir, 'endpoints', 'orders.ts'),
		`import { z } from 'zod';
import { api } from '../api';

export const order = api
  .get('/orders/:id')
  .telemetry({ attributes: { 'app.area': 'orders' } })
  .params(z.object({ id: z.string() }))
  .output(z.object({ id: z.string() }))
  .handle(async ({ params, logger }) => {
    logger.info({ orderId: params.id, password: 'hunter2' }, 'Fetching order');
    return { id: params.id };
  });

export const probe = api
  .get('/probe')
  .telemetry({ ignore: true })
  .output(z.object({ ok: z.boolean() }))
  .handle(async ({ logger }) => {
    logger.info('Probed');
    return { ok: true };
  });

export const boom = api
  .get('/boom')
  .output(z.object({ ok: z.boolean() }))
  .handle(async () => {
    throw new TypeError('the handler broke');
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
			telemetry: {
				serviceName: 'Api',
				ignorePaths: [],
				attributes: {},
				routes: routeTelemetry(constructs.map(({ construct }) => construct)),
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
}, 120_000);

afterAll(async () => {
	rmSync(dir, { recursive: true, force: true });
	await new Promise((resolve) => receiver.close(resolve));
});

/** The API's one site. */
const SITE = 'https://web.example.com';

const freePort = () =>
	new Promise<number>((resolve) => {
		const server = createServer().listen(0, () => {
			const { port } = server.address() as { port: number };
			server.close(() => resolve(port));
		});
	});

/** The bundle, started with node alone; resolves once /health answers. */
async function start(
	env: Record<string, string> = {},
): Promise<{ port: number; child: ChildProcess }> {
	const port = await freePort();
	const child = spawn(process.execPath, [bundle], {
		// Somewhere with no node_modules: everything comes from the bundle.
		cwd: join(dir, '.gkm', 'server', 'dist'),
		env: {
			PATH: process.env.PATH,
			PORT: String(port),
			OTEL_EXPORTER_OTLP_ENDPOINT: collector,
			// Nothing else configures the app; it is told so.
			NODE_ENV: 'production',
			// Its site, as the graph composes it: CORS and trace trust.
			API_TRUSTED_ORIGINS: SITE,
			...env,
		},
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
	return { port, child };
}

/** Wait for what the batch processors export, up to their delay and more. */
async function until<T>(find: () => T | undefined): Promise<T> {
	const deadline = Date.now() + 20_000;
	for (;;) {
		const found = find();
		if (found) return found;
		if (Date.now() > deadline) {
			throw new Error(
				`not exported in time:\n${JSON.stringify({ spans, logs }, null, 1)}`,
			);
		}
		await new Promise((r) => setTimeout(r, 200));
	}
}

describe(
	'a bundled production server with OTEL_EXPORTER_OTLP_ENDPOINT',
	{
		timeout: 60_000,
	},
	() => {
		let server: { port: number; child: ChildProcess };

		beforeAll(async () => {
			server = await start();
		}, 40_000);

		afterAll(() => {
			server?.child.kill('SIGKILL');
		});

		it('exports a SERVER span per request and the handler log in its trace', async () => {
			const response = await fetch(
				`http://localhost:${server.port}/orders/ord_1?token=secret`,
				{ headers: { 'user-agent': 'telemetry-test' } },
			);
			expect(response.status).toBe(200);

			const span = await until(() =>
				spans.find(
					(s) =>
						s.name === 'GET /orders/:id' &&
						attr(s.attributes, 'url.path') === '/orders/ord_1',
				),
			);
			expect(span.kind).toBe(SERVER);
			expect(attr(span.attributes, 'http.request.method')).toBe('GET');
			expect(attr(span.attributes, 'http.route')).toBe('/orders/:id');
			expect(Number(attr(span.attributes, 'http.response.status_code'))).toBe(
				200,
			);
			expect(attr(span.attributes, 'url.scheme')).toBe('http');
			expect(attr(span.attributes, 'user_agent.original')).toBe(
				'telemetry-test',
			);
			expect(JSON.stringify(span.attributes)).not.toContain('secret');
			// The route's own `.telemetry({ attributes })`.
			expect(attr(span.attributes, 'app.area')).toBe('orders');

			const log = await until(() =>
				logs.find(
					(l) =>
						l.body?.stringValue === 'Fetching order' &&
						attr(l.attributes, 'orderId') === 'ord_1',
				),
			);
			expect(log.severityText).toBe('INFO');
			expect(log.traceId).toBe(span.traceId);
			expect(log.spanId).toBe(span.spanId);
			// The exported copy is redacted as stdout is.
			expect(attr(log.attributes, 'password')).toBe('[Redacted]');
		});

		it('continues an incoming traceparent', async () => {
			const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
			const parent = '00f067aa0ba902b7';

			const response = await fetch(
				`http://localhost:${server.port}/orders/ord_2`,
				{
					headers: { traceparent: `00-${traceId}-${parent}-01` },
				},
			);
			expect(response.status).toBe(200);

			const span = await until(() =>
				spans.find((s) => attr(s.attributes, 'url.path') === '/orders/ord_2'),
			);
			expect(span.traceId).toBe(traceId);
			expect(span.parentSpanId).toBe(parent);

			const log = await until(() =>
				logs.find((l) => attr(l.attributes, 'orderId') === 'ord_2'),
			);
			expect(log.traceId).toBe(traceId);
		});

		it("continues a trace from the API's own site", async () => {
			const traceId = '5bf92f3577b34da6a3ce929d0e0e4736';
			const parent = '10f067aa0ba902b7';

			await fetch(`http://localhost:${server.port}/orders/ord_site`, {
				headers: { origin: SITE, traceparent: `00-${traceId}-${parent}-01` },
			});

			const span = await until(() =>
				spans.find(
					(s) => attr(s.attributes, 'url.path') === '/orders/ord_site',
				),
			);
			expect(span.traceId).toBe(traceId);
			expect(span.parentSpanId).toBe(parent);
		});

		it('starts a linked trace for an origin that is not its own', async () => {
			const traceId = '6bf92f3577b34da6a3ce929d0e0e4736';
			const parent = '20f067aa0ba902b7';

			await fetch(`http://localhost:${server.port}/orders/ord_other`, {
				headers: {
					origin: 'https://evil.example.net',
					traceparent: `00-${traceId}-${parent}-01`,
				},
			});

			const span = await until(() =>
				spans.find(
					(s) => attr(s.attributes, 'url.path') === '/orders/ord_other',
				),
			);
			expect(span.traceId).not.toBe(traceId);
			expect(span.parentSpanId ?? '').toBe('');
			expect(span.links?.[0]?.traceId).toBe(traceId);
			expect(span.links?.[0]?.spanId).toBe(parent);
		});

		it('marks a thrown error as an ERROR span with the exception', async () => {
			const response = await fetch(`http://localhost:${server.port}/boom`);
			expect(response.status).toBe(500);

			const span = await until(() => spans.find((s) => s.name === 'GET /boom'));
			expect(Number(attr(span.attributes, 'http.response.status_code'))).toBe(
				500,
			);
			expect(span.status?.code).toBe(ERROR);
			expect(span.events?.map((e) => e.name)).toContain('exception');
		});

		it('opens no span for a route that says `.telemetry({ ignore: true })`', async () => {
			const response = await fetch(`http://localhost:${server.port}/probe`);
			expect(response.status).toBe(200);
			// Its log is still exported; only its span is not recorded.
			await until(() => logs.find((l) => l.body?.stringValue === 'Probed'));
			await fetch(`http://localhost:${server.port}/orders/after_probe`);
			await until(() =>
				spans.find(
					(s) => attr(s.attributes, 'url.path') === '/orders/after_probe',
				),
			);

			expect(
				spans.filter((s) => attr(s.attributes, 'url.path') === '/probe'),
			).toEqual([]);
		});

		it('opens no span for the health check', async () => {
			await fetch(`http://localhost:${server.port}/health`);
			await until(() => spans.find((s) => s.name === 'GET /boom'));

			expect(
				spans.filter((s) => s.kind === SERVER).map((s) => s.name),
			).not.toContain('GET /health');
			expect(
				spans.filter((s) => attr(s.attributes, 'url.path') === '/health'),
			).toEqual([]);
		});
	},
);

describe(
	"a bundled production server at the stage's sample rate",
	{ timeout: 60_000 },
	() => {
		let server: { port: number; child: ChildProcess };

		beforeAll(async () => {
			server = await start({
				OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',
				OTEL_TRACES_SAMPLER_ARG: '0',
			});
		}, 40_000);

		afterAll(() => {
			server?.child.kill('SIGKILL');
		});

		it("does not let a site's sampled flag force a trace the stage would not keep", async () => {
			const traceId = '7bf92f3577b34da6a3ce929d0e0e4736';

			const response = await fetch(
				`http://localhost:${server.port}/orders/ord_capped`,
				{
					headers: {
						origin: SITE,
						traceparent: `00-${traceId}-30f067aa0ba902b7-01`,
					},
				},
			);
			expect(response.status).toBe(200);

			// Logs are not sampled: the handler's arrives, in the site's trace.
			const log = await until(() =>
				logs.find((l) => attr(l.attributes, 'orderId') === 'ord_capped'),
			);
			expect(log.traceId).toBe(traceId);
			// Spans are batched every 5s: wait out one whole interval, after
			// which nothing of this request may have been exported.
			await new Promise((r) => setTimeout(r, 6000));
			expect(
				spans.filter(
					(s) =>
						s.traceId === traceId ||
						attr(s.attributes, 'url.path') === '/orders/ord_capped',
				),
			).toEqual([]);
		});
	},
);
