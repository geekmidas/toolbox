import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { composeEmail, deliverRaw } from '@geekmidas/emailkit/inbound';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POSTGRES_PORT } from '../../../../testkit/test/ports';
import { bundleServer } from '../../build/bundler';
import type { BuildContext } from '../../build/types';
import { DEFAULT_IMAGES } from '../../reconcile/containers';
import {
	INBOX_RELAY_TOKEN_KEY,
	INBOX_ROUTE,
	inboxWebhookUrl,
} from '../../reconcile/inboxRelay';
import { HOST_GATEWAY } from '../../reconcile/objectEvents';
import { CronGenerator } from '../CronGenerator';
import { driversFor } from '../drivers';
import { QueueGenerator } from '../QueueGenerator';
import { SubscriberGenerator } from '../SubscriberGenerator';
import { WorkerGenerator, workerBundleName } from '../WorkerGenerator';

const URL = `postgres://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`;
const run = randomBytes(4).toString('hex');
// A broker schema, an effects table and a Mailpit of this run's own: Mailpit
// reads its webhook from its environment, once, at start.
const SCHEMA = `inbox_${run}`;
const TABLE = `inbox_effects_${run}`;
const BROKER = `pgboss://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas?schema=${SCHEMA}`;
const MAILPIT = `gkm-inbox-${run}`;
const TOKEN = `inbox-token-${run}`;
const DOMAIN = 'fixwell.localhost';

/**
 * A worker running an inbox's subscriber, bundled the way `gkm build
 * --production` bundles one, and run as its own process — with a Mailpit
 * whose webhook points at it, as `gkm dev` and a local compose stack start
 * one.
 *
 * Mail delivered to Mailpit over SMTP is posted to the worker's inbox route,
 * received by the receiver `mailbox.receive` also calls, announced on the
 * inbox's topic on pg-boss, and handed to the subscriber — which reads the
 * raw message back from Mailpit and writes what it saw.
 */
let dir: string;
let worker: string;
let workerPort: number;
let smtpPort: number;
let apiPort: number;
const children: ChildProcess[] = [];

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
	dir = mkdtempSync(join(cache, 'gkm-inbox-'));
	writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');

	writeFileSync(
		join(dir, 'constructs.ts'),
		`import { Inbox } from '@geekmidas/constructs/inbox';
import { Worker } from '@geekmidas/constructs/worker';
import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';

export const store = new KyselyDatabase('Store');
export const requests = new Inbox('Requests', { addresses: ['requests'], subdomains: true });
export const jobs = new Worker('Jobs').database(store);
`,
	);
	mkdirSync(join(dir, 'work'));
	writeFileSync(
		join(dir, 'work', 'requests.ts'),
		`import { sql } from 'kysely';
import { jobs, requests } from '../constructs';

export const onRequest = jobs
  .inbox(requests)
  .handle(async ({ messages, db }) => {
    for (const m of messages) {
      const size = m.attachments[0]?.size ?? null;
      await sql\`insert into ${TABLE} (tenant, tag, subject, size) values (\${m.recipient.subdomain ?? null}, \${m.recipient.tag ?? null}, \${m.subject ?? null}, \${size})\`.execute(db as any);
    }
  });
`,
	);

	const module = (exportName: string) => ({
		specifier: join(dir, 'constructs.ts'),
		exportName,
	});
	const context: BuildContext = {
		owners: { Jobs: module('jobs') },
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
		workerId: 'Jobs',
		outputDir: join(serverDir, 'workers', 'jobs'),
		crons: await new CronGenerator().load('work/*.ts', dir),
		queues: await new QueueGenerator().load('work/*.ts', dir),
		subscribers: await new SubscriberGenerator().load('work/*.ts', dir),
	});
	worker = (
		await bundleServer({
			entryPoint: workerEntry,
			outputDir: join(serverDir, 'dist'),
			outfile: workerBundleName('Jobs'),
			minify: false,
			sourcemap: false,
			external: [],
		})
	).outputPath;

	const client = new pg.Client({ connectionString: URL });
	await client.connect();
	await client.query(
		`create table ${TABLE} (tenant text, tag text, subject text, size int, at timestamptz default now())`,
	);
	await client.end();

	// Mailpit first, pointed at where the worker will listen.
	workerPort = await freePort();
	execFileSync('docker', [
		'run',
		'-d',
		'--rm',
		'--name',
		MAILPIT,
		'-p',
		'127.0.0.1::1025',
		'-p',
		'127.0.0.1::8025',
		'--add-host',
		`${HOST_GATEWAY}:host-gateway`,
		'-e',
		`MP_WEBHOOK_URL=${inboxWebhookUrl(`http://${HOST_GATEWAY}:${workerPort}`, TOKEN)}`,
		DEFAULT_IMAGES.mailpit!,
	]);
	const port = (inside: number) =>
		Number(
			execFileSync('docker', ['port', MAILPIT, String(inside)], {
				encoding: 'utf8',
			})
				.trim()
				.split('\n')[0]!
				.split(':')
				.pop(),
		);
	smtpPort = port(1025);
	apiPort = port(8025);
	const deadline = Date.now() + 30_000;
	while (
		!(await fetch(`http://127.0.0.1:${apiPort}/readyz`).then(
			(r) => r.ok,
			() => false,
		))
	) {
		if (Date.now() > deadline) throw new Error('Mailpit did not start');
		await new Promise((r) => setTimeout(r, 250));
	}
}, 180_000);

afterAll(async () => {
	for (const child of children) child.kill('SIGKILL');
	try {
		execFileSync('docker', ['rm', '-f', '-v', MAILPIT], { stdio: 'ignore' });
	} catch {
		// Already gone.
	}
	const client = new pg.Client({ connectionString: URL });
	await client.connect();
	await client.query(`drop table if exists ${TABLE}`);
	await client.query(`drop schema if exists ${SCHEMA} cascade`);
	await client.end();
	rmSync(dir, { recursive: true, force: true });
}, 60_000);

async function startWorker() {
	const child = spawn(process.execPath, [worker], {
		cwd: dir,
		env: {
			...process.env,
			PORT: String(workerPort),
			STORE_URL: URL,
			EVENT_PUBLISHER_CONNECTION_STRING: BROKER,
			REQUESTS_MAIL_PUBLISHER_CONNECTION_STRING: BROKER,
			REQUESTS_URL: `http://localhost:${apiPort}`,
			REQUESTS_DOMAIN: DOMAIN,
			[INBOX_RELAY_TOKEN_KEY]: TOKEN,
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

async function effects(): Promise<
	{ tenant: string; tag: string | null; subject: string; size: number }[]
> {
	const client = new pg.Client({ connectionString: URL });
	await client.connect();
	try {
		const { rows } = await client.query(
			`select tenant, tag, subject, size from ${TABLE} order by at`,
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

const send = async (to: string, subject: string, attach = false) =>
	deliverRaw(
		`smtp://localhost:${smtpPort}`,
		{ from: 'ada@resident.example', to: [to] },
		await composeEmail({
			from: 'ada@resident.example',
			to,
			subject,
			text: 'The kitchen tap drips.',
			...(attach
				? {
						attachments: [
							{ filename: 'tap.jpg', content: new Uint8Array([1, 2, 3]) },
						],
					}
				: {}),
		}),
	);

describe('mail received locally, through Mailpit', { timeout: 180_000 }, () => {
	it("hands what Mailpit posts to the inbox's subscriber, and nothing addressed elsewhere", async () => {
		const running = await startWorker();
		expect(running.output()).toMatch(/Receiving mail from Mailpit/);

		await send('requests+t_8f3k@acme.fixwell.localhost', 'Leaking tap', true);
		// Neither is an address the inbox receives at.
		await send('support@acme.fixwell.localhost', 'Not declared');
		await send('someone@resident.example', 'Mail the app sent elsewhere');

		const seen = await until(effects, (rows) => rows.length >= 1, 30_000);
		// Give anything wrongly routed a moment to arrive too.
		await new Promise((r) => setTimeout(r, 1_500));

		expect(await effects()).toEqual([
			{ tenant: 'acme', tag: 't_8f3k', subject: 'Leaking tap', size: 3 },
		]);
		expect(seen).toHaveLength(1);
	});

	it('refuses a post without the token Mailpit was given', async () => {
		const response = await fetch(
			`http://localhost:${workerPort}${INBOX_ROUTE}?token=wrong`,
			{ method: 'POST', body: JSON.stringify({ ID: 'x' }) },
		);

		expect(response.status).toBe(401);
	});
});
