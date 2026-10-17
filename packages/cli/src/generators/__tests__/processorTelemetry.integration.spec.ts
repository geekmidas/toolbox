import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {
	createServer as createHttpServer,
	type IncomingMessage,
	type Server,
} from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { createStorageClient, registerStorageDriver } from '@geekmidas/storage';
import { s3Driver, s3Url } from '@geekmidas/storage/aws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MINIO_URL } from '../../../../testkit/test/ports';
import { bundleServer } from '../../build/bundler';
import type { BuildContext } from '../../build/types';
import { driversFor } from '../drivers';
import {
	ProcessorGenerator,
	processorBundleName,
	processorEntryDir,
} from '../ProcessorGenerator';

/**
 * A processor unit whose file server has a `Telemetry` node, bundled and run
 * as its own process: each request it answers is a SERVER span, named after
 * the processor's pattern, exported to an OTLP receiver. One without a node
 * imports no tracing at all.
 */
const run = randomBytes(4).toString('hex');
const BUCKET_URL = s3Url.build({
	bucket: 'geekmidas',
	region: 'us-east-1',
	endpoint: MINIO_URL,
	forcePathStyle: true,
	accessKeyId: 'geekmidas',
	secretAccessKey: 'geekmidas',
});

interface OtlpSpan {
	name: string;
	kind: number;
	attributes: { key: string; value: Record<string, unknown> }[];
	service?: string;
}

/** OTLP's SERVER span kind. */
const SERVER = 2;

const spans: OtlpSpan[] = [];
let receiver: Server;
let collector: string;
let dir: string;
let traced: string;
let untracedEntry: string;

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
	collector = `http://127.0.0.1:${(receiver.address() as { port: number }).port}`;

	const cache = join(import.meta.dirname, '../../../node_modules/.cache');
	mkdirSync(cache, { recursive: true });
	dir = mkdtempSync(join(cache, 'gkm-processor-trace-'));
	writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');
	writeFileSync(
		join(dir, 'storage.ts'),
		`import { FileServer } from '@geekmidas/constructs/file-server';
import { z } from 'zod';

export const media = new FileServer('Media', { open: ['${run}/open/**'] });

export const shouting = media
  .process('/shout/:times/*')
  .params(z.object({ times: z.enum(['1', '2']) }))
  .handle(async ({ params, object }) => ({
    body: new TextDecoder().decode(await object.bytes()).toUpperCase().repeat(Number(params.times)),
    contentType: 'text/plain',
  }));
`,
	);

	const context = {
		storageDrivers: driversFor({ appRoot: dir }),
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
	} as BuildContext;

	const generator = new ProcessorGenerator();
	const processors = await generator.load('storage.ts', dir);
	const serverDir = join(dir, '.gkm', 'server');
	const entry = await generator.buildEntry({
		context,
		fileServerId: 'MediaServer',
		outputDir: processorEntryDir(serverDir, 'MediaServer'),
		processors,
		// The file server's own edge to the Telemetry construct.
		telemetry: {
			serviceName: 'MediaServer',
			ignorePaths: [],
			attributes: {},
			routes: [],
		},
	});
	traced = (
		await bundleServer({
			entryPoint: entry,
			outputDir: join(serverDir, 'dist'),
			outfile: processorBundleName('MediaServer'),
			minify: false,
			sourcemap: false,
			external: [],
		})
	).outputPath;

	untracedEntry = await generator.buildEntry({
		context,
		fileServerId: 'MediaServer',
		outputDir: join(dir, 'untraced'),
		processors,
	});

	registerStorageDriver(s3Driver);
	await createStorageClient(BUCKET_URL).upload(
		`${run}/open/hello.txt`,
		Buffer.from('hello'),
		'text/plain',
	);
}, 120_000);

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

async function until<T>(find: () => T | undefined, what: string): Promise<T> {
	const deadline = Date.now() + 20_000;
	for (;;) {
		const found = find();
		if (found) return found;
		if (Date.now() > deadline) throw new Error(`no ${what} arrived`);
		await new Promise((r) => setTimeout(r, 100));
	}
}

describe('a processor unit with telemetry', { timeout: 60_000 }, () => {
	it('exports a SERVER span per request, named after the pattern', async () => {
		const port = await freePort();
		const child = spawn(process.execPath, [traced], {
			cwd: dir,
			env: {
				...process.env,
				PORT: String(port),
				MEDIA_URL: BUCKET_URL,
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
		while (
			!(await fetch(`http://localhost:${port}/health`).then(
				(r) => r.ok,
				() => false,
			))
		) {
			if (Date.now() > deadline || child.exitCode !== null) {
				throw new Error(`the unit did not start:\n${output}`);
			}
			await new Promise((r) => setTimeout(r, 100));
		}

		const made = await fetch(
			`http://localhost:${port}/shout/2/${run}/open/hello.txt`,
		);
		expect(await made.text()).toBe('HELLOHELLO');
		await fetch(`http://localhost:${port}/shout/9/${run}/open/hello.txt`);

		const ok = await until(
			() =>
				spans.find(
					(s) =>
						s.kind === SERVER &&
						attr(s.attributes, 'http.response.status_code') === 200,
				),
			'span for the processed request',
		);
		expect(ok.name).toBe('GET /shout/:times/*');
		expect(ok.service).toBe('MediaServer');
		expect(attr(ok.attributes, 'http.route')).toBe('/shout/:times/*');
		expect(attr(ok.attributes, 'url.path')).toBe(
			`/shout/2/${run}/open/hello.txt`,
		);

		const refused = await until(
			() =>
				spans.find(
					(s) =>
						s.kind === SERVER &&
						attr(s.attributes, 'http.response.status_code') === 400,
				),
			'span for the refused request',
		);
		expect(refused.name).toBe('GET /shout/:times/*');
		// The health check is never a span.
		expect(
			spans.some((s) => attr(s.attributes, 'url.path') === '/health'),
		).toBe(false);
	});

	it('imports no tracing where its file server has no Telemetry node', () => {
		expect(readFileSync(untracedEntry, 'utf8')).not.toContain(
			'@opentelemetry/api',
		);
	});
});
