import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
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
 * A file server's processors, generated and bundled the way `gkm build
 * --production` does for their image, and run as a process of their own
 * against the test stack's MinIO.
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

let dir: string;
let bundle: string;
let awsHandler: string;

beforeAll(async () => {
	const cache = join(import.meta.dirname, '../../../node_modules/.cache');
	mkdirSync(cache, { recursive: true });
	dir = mkdtempSync(join(cache, 'gkm-processor-bundle-'));
	writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');

	writeFileSync(
		join(dir, 'storage.ts'),
		`import { FileServer } from '@geekmidas/constructs/file-server';
import { z } from 'zod';

export const media = new FileServer('Media', { open: ['${run}/open/**'] });

export const shouting = media
  .process('/shout/:times/*')
  .params(z.object({ times: z.enum(['1', '2']) }))
  .handle(async ({ params, object }) => {
    const text = new TextDecoder().decode(await object.bytes());
    return {
      body: text.toUpperCase().repeat(Number(params.times)),
      contentType: 'text/plain',
      cache: 'immutable',
    };
  });
`,
	);

	const context: BuildContext = {
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
	});
	bundle = (
		await bundleServer({
			entryPoint: entry,
			outputDir: join(serverDir, 'dist'),
			outfile: processorBundleName('MediaServer'),
			minify: false,
			sourcemap: false,
			external: [],
		})
	).outputPath;

	const [info] = await generator.build(
		context,
		processors,
		join(dir, '.gkm', 'aws'),
		{ target: 'aws', root: dir },
	);
	awsHandler = join(dir, info!.handler.replace(/\.handler$/, '.ts'));

	registerStorageDriver(s3Driver);
	await createStorageClient(BUCKET_URL).upload(
		`${run}/open/hello.txt`,
		Buffer.from('hello'),
		'text/plain',
	);
}, 120_000);

const children: ChildProcess[] = [];

afterAll(() => {
	for (const child of children) child.kill('SIGKILL');
	rmSync(dir, { recursive: true, force: true });
});

const freePort = () =>
	new Promise<number>((resolve) => {
		const s = createServer().listen(0, () => {
			const { port } = s.address() as { port: number };
			s.close(() => resolve(port));
		});
	});

/** The bundle, run with node alone; resolves once its health check passes. */
async function start() {
	const port = await freePort();
	const child = spawn(process.execPath, [bundle], {
		cwd: dir,
		env: { ...process.env, PORT: String(port), MEDIA_URL: BUCKET_URL },
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
	return { port, child };
}

describe('a processor unit, bundled', () => {
	it('answers its patterns from the bucket, and nothing else', async () => {
		const { port } = await start();
		const base = `http://localhost:${port}`;

		const made = await fetch(`${base}/shout/2/${run}/open/hello.txt`);
		expect(made.status).toBe(200);
		expect(await made.text()).toBe('HELLOHELLO');
		expect(made.headers.get('cache-control')).toBe(
			'public, max-age=31536000, immutable',
		);

		// Kept: the second answer comes from the bucket.
		const kept = await fetch(`${base}/shout/2/${run}/open/hello.txt`);
		expect(kept.headers.get('x-gkm-processor')).toBe('kept');
		expect(await kept.text()).toBe('HELLOHELLO');

		expect((await fetch(`${base}/shout/9/${run}/open/hello.txt`)).status).toBe(
			400,
		);
		expect((await fetch(`${base}/${run}/open/hello.txt`)).status).toBe(404);
	});

	it('stops on SIGTERM', async () => {
		const { child } = await start();
		const exited = new Promise<number | null>((resolve) =>
			child.once('exit', resolve),
		);
		child.kill('SIGTERM');
		expect(await exited).toBe(0);
	});
});

describe('a processor on AWS', () => {
	it('is a Lambda handler behind a function URL', () => {
		const source = readFileSync(awsHandler, 'utf8');

		expect(source).toContain(
			"import { AWSLambdaProcessor } from '@geekmidas/constructs/processors';",
		);
		expect(source).toContain("import { shouting } from '../../../storage.js';");
		expect(source).toContain('new AWSLambdaProcessor(shouting)');
		expect(source).toContain('export const handler = adapter.handler;');
	});
});
