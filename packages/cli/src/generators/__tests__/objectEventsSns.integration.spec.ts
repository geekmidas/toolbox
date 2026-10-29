import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import {
	CreateBucketCommand,
	PutBucketNotificationConfigurationCommand,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import {
	CreateTopicCommand,
	GetSubscriptionAttributesCommand,
	ListSubscriptionsByTopicCommand,
	SNSClient,
} from '@aws-sdk/client-sns';
import { snsUrl } from '@geekmidas/events/sns';
import { provideKey } from '@geekmidas/manifest';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOCALSTACK_URL, POSTGRES_PORT } from '../../../../testkit/test/ports';
import { bundleServer } from '../../build/bundler';
import type { BuildContext } from '../../build/types';
import { CronGenerator } from '../CronGenerator';
import { driversFor } from '../drivers';
import { QueueGenerator } from '../QueueGenerator';
import { SubscriberGenerator } from '../SubscriberGenerator';
import { SNS_SUBSCRIPTIONS_KEY, subscriberRoute } from '../subscriberRoute';
import { WorkerGenerator, workerBundleName } from '../WorkerGenerator';

const URL = `postgres://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`;
const run = randomBytes(4).toString('hex');
const SCHEMA = `object_events_sns_${run}`;
const TABLE = `object_effects_sns_${run}`;
const BROKER = `pgboss://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas?schema=${SCHEMA}`;
const REGION = 'eu-west-1';
const BUCKET = `uploads-sns-${run}`;
const AWS = { accessKeyId: 'test', secretAccessKey: 'test' };

const s3 = new S3Client({
	region: REGION,
	endpoint: LOCALSTACK_URL,
	forcePathStyle: true,
	credentials: AWS,
});
const sns = new SNSClient({
	region: REGION,
	endpoint: LOCALSTACK_URL,
	credentials: AWS,
});

/**
 * A worker watching an S3 bucket, bundled the way `gkm build --production`
 * bundles one for its image and run as its own process: what a compose stage
 * whose bucket is on S3 runs.
 *
 * Against the AWS emulator the whole path runs — an object put in the bucket
 * is published to the bucket's topic, pushed to the worker's route, and
 * handed to the subscriber as an object event. Against SNS itself the worker
 * mounts only the routes the deploy recorded; that half is checked without an
 * emulator, since SNS signs what it sends and the emulator signs nothing.
 */
let dir: string;
let worker: string;
let topicArn: string;

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
	dir = mkdtempSync(join(cache, 'gkm-object-events-sns-'));
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
  .on(['object.created'], { prefix: 'avatars/' })
  .handle(async ({ objects, db }) => {
    for (const object of objects) {
      await sql\`insert into ${TABLE} (key) values (\${object.key})\`.execute(db as any);
    }
  });
`,
	);

	const context: BuildContext = {
		owners: {
			Fulfilment: { specifier: join(dir, 'constructs.ts'), exportName: 'jobs' },
		},
		// A server stage: its own events go through pg-boss, and the bucket's
		// come from SNS all the same.
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
	const entry = await new WorkerGenerator().build({
		context,
		workerId: 'Fulfilment',
		outputDir: join(serverDir, 'workers', 'fulfilment'),
		crons: await new CronGenerator().load('work/*.ts', dir),
		queues: await new QueueGenerator().load('work/*.ts', dir),
		subscribers: await new SubscriberGenerator().load('work/*.ts', dir),
	});
	worker = (
		await bundleServer({
			entryPoint: entry,
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
		`create table ${TABLE} (key text, at timestamptz default now())`,
	);
	await client.end();

	// The bucket and its topic, wired as the `s3` provider wires them.
	({ TopicArn: topicArn } = (await sns.send(
		new CreateTopicCommand({ Name: `${BUCKET}-events` }),
	)) as { TopicArn: string });
	await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
	await s3.send(
		new PutBucketNotificationConfigurationCommand({
			Bucket: BUCKET,
			NotificationConfiguration: {
				TopicConfigurations: [
					{
						Id: 'gkm-Uploads',
						TopicArn: topicArn,
						Events: ['s3:ObjectCreated:*', 's3:ObjectRemoved:*'],
					},
				],
			},
		}),
	);
}, 180_000);

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

async function startWorker(
	env: Record<string, string>,
	healthy: (status: number) => boolean = (status) => status === 200,
) {
	const port = await freePort();
	const child = spawn(process.execPath, [worker], {
		cwd: dir,
		env: {
			...process.env,
			PORT: String(port),
			STORE_URL: URL,
			EVENT_PUBLISHER_CONNECTION_STRING: BROKER,
			AWS_ACCESS_KEY_ID: AWS.accessKeyId,
			AWS_SECRET_ACCESS_KEY: AWS.secretAccessKey,
			AWS_REGION: REGION,
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
		const health = await fetch(`http://localhost:${port}/health`).then(
			(r) => r.status,
			() => 0,
		);
		if (health !== 0 && healthy(health)) break;
		if (Date.now() > deadline || child.exitCode !== null) {
			throw new Error(`the worker did not start:\n${output}`);
		}
		await new Promise((r) => setTimeout(r, 100));
	}
	return { port, child, output: () => output };
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

async function handled(): Promise<string[]> {
	const client = new pg.Client({ connectionString: URL });
	await client.connect();
	try {
		const { rows } = await client.query(`select key from ${TABLE} order by at`);
		return rows.map((r) => r.key as string);
	} finally {
		await client.end();
	}
}

const EVENTS_KEY = provideKey('Uploads', 'eventsConnectionString');

describe(
	'object events from S3, in a worker image',
	{ timeout: 180_000 },
	() => {
		it('serves the push route, and hands an object put in the bucket to its subscriber', async () => {
			const running = await startWorker({
				[EVENTS_KEY]: snsUrl.build({
					topicArn,
					region: REGION,
					endpoint: LOCALSTACK_URL,
				}),
			});

			// The emulator runs in Docker, where this machine is host.docker.internal:
			// the worker subscribes its route there once it is listening. The
			// emulator lists a subscription with its ARN before it is confirmed,
			// and drops what is published to it meanwhile — so wait for the
			// confirmation, not the ARN, before putting anything in the bucket.
			const route = `http://host.docker.internal:${running.port}${subscriberRoute('onAvatar')}`;
			const confirmed = await until(
				async () => {
					const { Subscriptions = [] } = await sns.send(
						new ListSubscriptionsByTopicCommand({ TopicArn: topicArn }),
					);
					const ours = Subscriptions.find((s) =>
						s.Endpoint?.startsWith(
							`http://host.docker.internal:${running.port}`,
						),
					);
					if (!ours?.SubscriptionArn?.startsWith('arn:')) return false;
					const { Attributes } = await sns.send(
						new GetSubscriptionAttributesCommand({
							SubscriptionArn: ours.SubscriptionArn,
						}),
					);
					return Attributes?.PendingConfirmation === 'false';
				},
				Boolean,
				30_000,
			);
			expect(confirmed, running.output()).toBe(true);

			// A space in the key, which S3's notification encodes as `+`, and one
			// the subscriber does not watch.
			await s3.send(
				new PutObjectCommand({
					Bucket: BUCKET,
					Key: 'avatars/a b.png',
					Body: 'x',
				}),
			);
			await s3.send(
				new PutObjectCommand({ Bucket: BUCKET, Key: 'other/c.png', Body: 'x' }),
			);

			const keys = await until(
				handled,
				(rows) => rows.includes('avatars/a b.png'),
				60_000,
			);
			expect(keys, running.output()).toContain('avatars/a b.png');
			await new Promise((r) => setTimeout(r, 1_000));
			expect(await handled()).not.toContain('other/c.png');
			expect(route).toContain('/__gkm/subscribers/onAvatar');

			running.child.kill('SIGTERM');
		});

		it('against SNS itself, mounts a route only for a subscription the deploy recorded', async () => {
			const real = snsUrl.build({ topicArn, region: REGION });

			// Unhealthy, so a deploy waiting on it sees the missing subscription.
			const unrecorded = await startWorker(
				{ [EVENTS_KEY]: real },
				(status) => status === 503,
			);
			const missing = await fetch(
				`http://localhost:${unrecorded.port}${subscriberRoute('onAvatar')}`,
				{ method: 'POST', body: '{}' },
			);
			expect(missing.status).toBe(404);
			expect(unrecorded.output()).toMatch(/No subscription recorded/);
			unrecorded.child.kill('SIGTERM');

			const recorded = await startWorker({
				[EVENTS_KEY]: real,
				[SNS_SUBSCRIPTIONS_KEY]: JSON.stringify({
					onAvatar: `${topicArn}:recorded`,
				}),
			});
			// Mounted: an unsigned message is refused by the route, not missing.
			const unsigned = await fetch(
				`http://localhost:${recorded.port}${subscriberRoute('onAvatar')}`,
				{
					method: 'POST',
					body: JSON.stringify({
						Type: 'Notification',
						TopicArn: topicArn,
						MessageId: 'forged',
						Message: '{}',
						Timestamp: new Date().toISOString(),
						SignatureVersion: '1',
						Signature: 'forged',
						SigningCertURL: 'https://example.com/cert.pem',
					}),
					headers: {
						'x-amz-sns-subscription-arn': `${topicArn}:recorded`,
					},
				},
			);
			expect(unsigned.status).toBe(403);
			recorded.child.kill('SIGTERM');
		});
	},
);
