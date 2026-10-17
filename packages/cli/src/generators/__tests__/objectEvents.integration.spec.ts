import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import {
	DeleteObjectCommand,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import { provideKey } from '@geekmidas/manifest';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POSTGRES_PORT } from '../../../../testkit/test/ports';
import { bundleServer } from '../../build/bundler';
import type { BuildContext } from '../../build/types';
import { bucketClient } from '../../reconcile/clients';
import { DEFAULT_IMAGES } from '../../reconcile/containers';
import {
	HOST_GATEWAY,
	minioWebhookEnv,
	objectsWebhookToken,
} from '../../reconcile/objectEvents';
import { applyBuckets, applyNotifications } from '../../reconcile/provision';
import { CronGenerator } from '../CronGenerator';
import { driversFor } from '../drivers';
import { QueueGenerator } from '../QueueGenerator';
import { SubscriberGenerator } from '../SubscriberGenerator';
import { objectsRoute } from '../subscriberRoute';
import { WorkerGenerator, workerBundleName } from '../WorkerGenerator';

const URL = `postgres://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`;
const run = randomBytes(4).toString('hex');
// A broker schema, an effects table and a MinIO of this run's own: MinIO
// reads its webhook targets from its environment, once, at start.
const SCHEMA = `object_events_${run}`;
const TABLE = `object_effects_${run}`;
const BROKER = `pgboss://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas?schema=${SCHEMA}`;
const MINIO = `gkm-object-events-${run}`;
const LOGIN = { user: 'objects', password: `objects-${run}` };
const BUCKET = `uploads-${run}`;
const TOKEN = objectsWebhookToken('object-events', 'Uploads', run);

/**
 * A worker that watches a bucket in MinIO, bundled the way `gkm build
 * --production` bundles one for its image, and run as its own process — with
 * a MinIO started pointing at it, as `gkm dev` and a compose stack start one.
 *
 * An object written to the bucket is posted by MinIO to the worker's relay
 * route, published onto pg-boss under the bucket's name, and drained by the
 * bucket's subscriber, which writes what it saw.
 */
let dir: string;
let worker: string;
let workerPort: number;
let minioPort: number;

const freePort = () =>
	new Promise<number>((resolve) => {
		const s = createServer().listen(0, () => {
			const { port } = s.address() as { port: number };
			s.close(() => resolve(port));
		});
	});

beforeAll(async () => {
	const cache = join(import.meta.dirname, '../../../node_modules/.cache');
	mkdirSync(cache, { recursive: true });
	dir = mkdtempSync(join(cache, 'gkm-object-events-'));
	writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');

	writeFileSync(
		join(dir, 'constructs.ts'),
		`import { Worker } from '@geekmidas/constructs/worker';
import { ObjectStorage } from '@geekmidas/constructs/object-storage';
import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';

export const store = new KyselyDatabase('Store');
export const uploads = new ObjectStorage('Uploads');
export const jobs = new Worker('Fulfilment').database(store);
`,
	);
	mkdirSync(join(dir, 'work'));
	writeFileSync(
		join(dir, 'work', 'avatars.ts'),
		`import { sql } from 'kysely';
import { jobs, uploads } from '../constructs';

export const onAvatar = jobs
  .objects(uploads)
  .on(['object.created', 'object.deleted'], { prefix: 'avatars/', suffix: '.png' })
  .handle(async ({ events, db }) => {
    for (const event of events) {
      await sql\`insert into ${TABLE} (type, key, size) values (\${event.type}, \${event.payload.key}, \${event.payload.size ?? null})\`.execute(db as any);
    }
  });
`,
	);

	const module = (exportName: string) => ({
		specifier: join(dir, 'constructs.ts'),
		exportName,
	});
	const context: BuildContext = {
		owners: { Fulfilment: module('jobs') },
		eventsBackends: ['pgboss'],
		storageDrivers: driversFor({ appRoot: dir, events: ['pgboss'] }),
		production: {
			enabled: true,
			bundle: true,
			minify: false,
			healthCheck: '/health',
			gracefulShutdown: true,
			external: [],
			subscribers: 'exclude' as const,
			openapi: false,
		},
	};

	const serverDir = join(dir, '.gkm', 'server');
	mkdirSync(serverDir, { recursive: true });
	const workerEntry = await new WorkerGenerator().build({
		context,
		workerId: 'Fulfilment',
		outputDir: join(serverDir, 'workers', 'fulfilment'),
		crons: await new CronGenerator().load('work/*.ts', dir),
		queues: await new QueueGenerator().load('work/*.ts', dir),
		subscribers: await new SubscriberGenerator().load('work/*.ts', dir),
	});
	worker = (
		await bundleServer({
			entryPoint: workerEntry,
			outputDir: join(serverDir, 'dist'),
			outfile: workerBundleName('Fulfilment'),
			minify: false,
			sourcemap: false,
			external: [],
		})
	).outputPath;

	const client = new pg.Client({ connectionString: URL });
	await client.connect();
	await client.query(
		`create table ${TABLE} (type text, key text, size int, at timestamptz default now())`,
	);
	await client.end();

	// MinIO first, pointed at where the worker will listen — before it does,
	// as a stack starts them. What it cannot deliver yet, it keeps.
	workerPort = await freePort();
	const env = minioWebhookEnv([
		{
			bucket: 'Uploads',
			endpoint: `http://${HOST_GATEWAY}:${workerPort}${objectsRoute('Uploads')}`,
			token: TOKEN,
		},
	]);
	execFileSync('docker', [
		'run',
		'-d',
		'--rm',
		'--name',
		MINIO,
		'-p',
		'127.0.0.1::9000',
		'--add-host',
		`${HOST_GATEWAY}:host-gateway`,
		'-e',
		`MINIO_ROOT_USER=${LOGIN.user}`,
		'-e',
		`MINIO_ROOT_PASSWORD=${LOGIN.password}`,
		...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
		DEFAULT_IMAGES.minio!,
		'server',
		'/data',
	]);
	minioPort = Number(
		execFileSync('docker', ['port', MINIO, '9000'], { encoding: 'utf8' })
			.trim()
			.split(':')
			.pop(),
	);
	const deadline = Date.now() + 30_000;
	while (
		!(await fetch(`http://127.0.0.1:${minioPort}/minio/health/ready`).then(
			(r) => r.ok,
			() => false,
		))
	) {
		if (Date.now() > deadline) throw new Error('MinIO did not start');
		await new Promise((r) => setTimeout(r, 250));
	}

	// The bucket and its notification, as reconcile writes them.
	const buckets = bucketClient(minioPort, LOGIN);
	await applyBuckets(buckets, [BUCKET]);
	await applyNotifications(
		buckets,
		[{ id: 'Uploads', name: BUCKET }],
		new Set(['Uploads']),
	);
}, 180_000);

const children: ChildProcess[] = [];

afterAll(async () => {
	for (const child of children) child.kill('SIGKILL');
	try {
		execFileSync('docker', ['rm', '-f', MINIO], { stdio: 'ignore' });
	} catch {
		// Already gone.
	}
	const client = new pg.Client({ connectionString: URL });
	await client.connect();
	await client.query(`drop table if exists ${TABLE}`);
	await client.query(`drop schema if exists ${SCHEMA} cascade`);
	await client.end();
	rmSync(dir, { recursive: true, force: true });
});

async function startWorker() {
	const child = spawn(process.execPath, [worker], {
		cwd: dir,
		env: {
			...process.env,
			PORT: String(workerPort),
			STORE_URL: URL,
			EVENT_PUBLISHER_CONNECTION_STRING: BROKER,
			[provideKey('Uploads', 'eventsConnectionString')]: BROKER,
			[provideKey('Uploads', 'eventsToken')]: TOKEN,
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
		const health = await fetch(`http://localhost:${workerPort}/health`).then(
			(r) => r.status,
			() => 0,
		);
		if (health === 200) break;
		if (Date.now() > deadline || child.exitCode !== null) {
			throw new Error(`the worker did not start:\n${output}`);
		}
		await new Promise((r) => setTimeout(r, 100));
	}
	return { child, output: () => output };
}

async function effects(): Promise<{ type: string; key: string }[]> {
	const client = new pg.Client({ connectionString: URL });
	await client.connect();
	try {
		const { rows } = await client.query(
			`select type, key from ${TABLE} order by at`,
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

describe('object events from MinIO', { timeout: 180_000 }, () => {
	it('relays what MinIO posts onto pg-boss, to the subscriber watching those keys', async () => {
		const s3 = new S3Client({
			region: 'us-east-1',
			endpoint: `http://127.0.0.1:${minioPort}`,
			forcePathStyle: true,
			credentials: {
				accessKeyId: LOGIN.user,
				secretAccessKey: LOGIN.password,
			},
		});

		// Written before the worker is up: MinIO keeps it, and sends it once
		// the route answers.
		await s3.send(
			new PutObjectCommand({
				Bucket: BUCKET,
				Key: 'avatars/early.png',
				Body: 'x',
			}),
		);

		const running = await startWorker();
		expect(running.output()).toMatch(/Relaying object events/);

		// A space in the key, which S3's notification encodes as `+`; and two
		// the subscriber does not watch.
		await s3.send(
			new PutObjectCommand({
				Bucket: BUCKET,
				Key: 'avatars/a b.png',
				Body: 'hello',
			}),
		);
		await s3.send(
			new PutObjectCommand({ Bucket: BUCKET, Key: 'avatars/c.jpg', Body: 'x' }),
		);
		await s3.send(
			new PutObjectCommand({ Bucket: BUCKET, Key: 'other/d.png', Body: 'x' }),
		);
		await s3.send(
			new DeleteObjectCommand({ Bucket: BUCKET, Key: 'avatars/a b.png' }),
		);

		const seen = await until(
			effects,
			(rows) =>
				rows.some((r) => r.type === 'object.deleted') &&
				rows.some((r) => r.key === 'avatars/early.png'),
			60_000,
		);
		expect(seen).toEqual(
			expect.arrayContaining([
				{ type: 'object.created', key: 'avatars/early.png' },
				{ type: 'object.created', key: 'avatars/a b.png' },
				{ type: 'object.deleted', key: 'avatars/a b.png' },
			]),
		);
		expect(seen.map((r) => r.key)).not.toContain('avatars/c.jpg');
		expect(seen.map((r) => r.key)).not.toContain('other/d.png');
	});

	it('refuses a post without the bucket’s token', async () => {
		const route = `http://localhost:${workerPort}${objectsRoute('Uploads')}`;
		const body = JSON.stringify({
			Records: [
				{
					eventName: 's3:ObjectCreated:Put',
					s3: {
						bucket: { name: BUCKET },
						object: { key: 'avatars/forged.png', size: 1 },
					},
				},
			],
		});

		const none = await fetch(route, { method: 'POST', body });
		const wrong = await fetch(route, {
			method: 'POST',
			body,
			headers: { authorization: 'Bearer not-the-token' },
		});
		expect(none.status).toBe(401);
		expect(wrong.status).toBe(401);

		// And a bucket nobody relays has no route at all.
		const other = await fetch(
			`http://localhost:${workerPort}${objectsRoute('Reports')}`,
			{ method: 'POST', body, headers: { authorization: `Bearer ${TOKEN}` } },
		);
		expect(other.status).toBe(404);

		await new Promise((r) => setTimeout(r, 1_000));
		expect((await effects()).map((r) => r.key)).not.toContain(
			'avatars/forged.png',
		);
	});

	it('reads back the notification it wrote as converged, and removes it once unwatched', async () => {
		const buckets = bucketClient(minioPort, LOGIN);
		const uploads = [{ id: 'Uploads', name: BUCKET }];

		const again = await applyNotifications(
			buckets,
			uploads,
			new Set(['Uploads']),
		);
		expect(again).toEqual([
			{
				id: `${BUCKET}:events`,
				describe: `object events from ${BUCKET}`,
				created: false,
			},
		]);

		await applyNotifications(buckets, uploads, new Set());
		expect(
			(await buckets.notification(BUCKET)).QueueConfigurations ?? [],
		).toEqual([]);

		// Back, for the tests after this one.
		await applyNotifications(buckets, uploads, new Set(['Uploads']));
	});

	it('takes a post with the token, and an S3 test event, as delivered', async () => {
		const route = `http://localhost:${workerPort}${objectsRoute('Uploads')}`;
		const test = await fetch(route, {
			method: 'POST',
			body: JSON.stringify({ Event: 's3:TestEvent', Bucket: BUCKET }),
			headers: { authorization: `Bearer ${TOKEN}` },
		});
		expect(test.status).toBe(200);
		expect(await test.json()).toEqual({ status: 'ok', relayed: 0 });

		const malformed = await fetch(route, {
			method: 'POST',
			body: 'not json',
			headers: { authorization: `Bearer ${TOKEN}` },
		});
		expect(malformed.status).toBe(400);
	});
});
