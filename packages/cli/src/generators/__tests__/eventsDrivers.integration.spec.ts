import { type ChildProcess, spawn } from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { build, type Plugin } from 'esbuild';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POSTGRES_PORT } from '../../../../testkit/test/ports';
import { bundleServer } from '../../build/bundler';
import type { BuildContext } from '../../build/types';
import type { EventsBackend } from '../../types';
import { CronGenerator } from '../CronGenerator';
import { driversFor } from '../drivers';
import { EndpointGenerator } from '../EndpointGenerator';
import { QueueGenerator } from '../QueueGenerator';
import { SubscriberGenerator } from '../SubscriberGenerator';

/**
 * A production server, generated and bundled the way `gkm build --provider
 * server --production` does, for a project with events — issue #192.
 *
 * The bundle used to take every broker `@geekmidas/events` could load, because
 * the core picked one with a literal `import()` per broker and esbuild follows
 * those. A project that installed only its own broker failed with `Could not
 * resolve "pg-boss"` or `"amqplib"`. Now the entry registers its target's
 * driver, and only that driver's subpath is in the graph.
 *
 * Each case is bundled twice: once by `bundleServer` itself, and once with the
 * other brokers made unresolvable — the condition of a project that never
 * installed them — which must build all the same.
 */

/** Every broker's client library, by the backend that uses it. */
const BROKER_MODULES: Record<EventsBackend, string[]> = {
	pgboss: ['pg-boss'],
	rabbitmq: ['amqplib'],
	sns: ['@aws-sdk/client-sns', '@aws-sdk/client-sqs'],
};

/** A module a project never installed: resolving it is an error. */
function notInstalled(modules: string[]): Plugin {
	const escape = (m: string) => m.replace(/[/\\^$*+?.()|[\]{}-]/g, '\\$&');
	const filter = new RegExp(`^(${modules.map(escape).join('|')})(/|$)`);
	return {
		name: 'not-installed',
		setup(build) {
			build.onResolve({ filter }, ({ path }) => ({
				errors: [{ text: `Could not resolve "${path}" (not installed)` }],
			}));
		},
	};
}

const cache = join(import.meta.dirname, '../../../node_modules/.cache');
const dirs: string[] = [];

afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A project with a topic, its subscriber, a queue, a cron and a publishing endpoint. */
function project(): string {
	mkdirSync(cache, { recursive: true });
	const dir = mkdtempSync(join(cache, 'gkm-events-drivers-'));
	dirs.push(dir);
	writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');

	writeFileSync(
		join(dir, 'constructs.ts'),
		`import { RestApi } from '@geekmidas/constructs/rest-api';
import { Topic } from '@geekmidas/constructs/topic';
import { Worker } from '@geekmidas/constructs/worker';
import { createLogger } from '@geekmidas/logger/pino';
import { z } from 'zod';

const logger = createLogger();

export const api = new RestApi('Api', { path: '.', logger });
export const worker = new Worker('Jobs', { logger });

export const users = new Topic('Users', {
  events: { 'user.created': z.object({ userId: z.string() }) },
});

export const emails = worker
  .queue('Emails')
  .message(z.object({ to: z.string() }))
  .handle(async ({ messages }) => {
    for (const { to } of messages) {
      console.log(JSON.stringify({ marker: 'queue', to }));
    }
  });
`,
	);

	mkdirSync(join(dir, 'endpoints'));
	writeFileSync(
		join(dir, 'endpoints', 'users.ts'),
		`import { z } from 'zod';
import { api, emails, users } from '../constructs';

export const createUser = api
  .post('/users')
  .dependsOn([emails])
  .body(z.object({ id: z.string() }))
  .output(z.object({ id: z.string() }))
  .event(users, {
    type: 'user.created',
    payload: (user) => ({ userId: user.id }),
  })
  .handle(async ({ body, services }) => {
    await services.emails.publish([
      { type: 'Emails', payload: { to: \`\${body.id}@example.com\` } },
    ]);
    return { id: body.id };
  });
`,
	);

	mkdirSync(join(dir, 'workers'));
	writeFileSync(
		join(dir, 'workers', 'jobs.ts'),
		`import { users, worker } from '../constructs';

export const onUser = worker
  .topic(users)
  .subscribe(['user.created'])
  .handle(async ({ events }) => {
    for (const event of events) {
      console.log(JSON.stringify({ marker: 'subscriber', userId: event.payload.userId }));
    }
  });

export const nightly = worker.cron('rate(1 day)').handle(async () => {});
`,
	);

	return dir;
}

/**
 * Generate the production server — endpoints, subscribers, queues and crons in
 * one process — as the build does for a target whose broker is `backend`.
 */
async function generate(dir: string, backend: EventsBackend): Promise<string> {
	const outputDir = join(dir, '.gkm', 'server');
	mkdirSync(outputDir, { recursive: true });

	const api = { specifier: join(dir, 'constructs.ts'), exportName: 'api' };
	const jobs = { specifier: join(dir, 'constructs.ts'), exportName: 'worker' };
	const context: BuildContext = {
		surface: {
			id: 'Api',
			trustedOriginsKey: 'API_TRUSTED_ORIGINS',
			module: api,
		},
		owners: { Api: api, Jobs: jobs },
		production: {
			enabled: true,
			bundle: true,
			minify: false,
			healthCheck: '/health',
			gracefulShutdown: true,
			external: [],
			subscribers: 'include',
			openapi: false,
		},
		storageDrivers: driversFor({ appRoot: dir, events: [backend] }),
		eventsBackends: [backend],
	};
	const options = { target: 'server' as const };

	const endpoints = new EndpointGenerator();
	const subscribers = new SubscriberGenerator();
	const queues = new QueueGenerator();
	const crons = new CronGenerator();
	const [e, s, q, c] = await Promise.all([
		endpoints.load('endpoints/*.ts', dir),
		subscribers.load('workers/*.ts', dir),
		queues.load('constructs.ts', dir),
		crons.load('workers/*.ts', dir),
	]);
	expect([e.length, s.length, q.length, c.length]).toEqual([1, 1, 1, 1]);

	await Promise.all([
		subscribers.build(context, s, outputDir, options),
		queues.build(context, q, outputDir, options),
		crons.build(context, c, outputDir, options),
	]);
	await endpoints.build(context, e, outputDir, options);

	return outputDir;
}

/** Bundle with `bundleServer`, then again with `missing` unresolvable. */
async function bundle(
	outputDir: string,
	missing: string[],
): Promise<{ bundle: string; text: string }> {
	const { outputPath } = await bundleServer({
		entryPoint: join(outputDir, 'server.ts'),
		outputDir: join(outputDir, 'dist'),
		minify: false,
		sourcemap: false,
		external: [],
	});

	// The same bundle a project without the other brokers installed gets.
	// Throws, with esbuild's "Could not resolve", if anything still reaches one.
	await build({
		entryPoints: [join(outputDir, 'server.ts')],
		outfile: join(outputDir, 'without-other-brokers', 'server.mjs'),
		bundle: true,
		platform: 'node',
		target: 'node22',
		format: 'esm',
		logLevel: 'silent',
		banner: {
			js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
		},
		plugins: [notInstalled(missing)],
	});

	return { bundle: outputPath, text: readFileSync(outputPath, 'utf8') };
}

/** Each broker module's own files, as the unminified bundle names them. */
const bundled = (text: string, module: string) =>
	text.includes(`node_modules/${module}/`);

describe('a bundled production server registers only its own broker', () => {
	it(
		'bundles an SNS project with pg-boss and amqplib not installed',
		{ timeout: 120_000 },
		async () => {
			const dir = project();
			const outputDir = await generate(dir, 'sns');

			const app = readFileSync(join(outputDir, 'app.ts'), 'utf8');
			expect(app).toContain('registerEventsDriver(snsEventsDriver);');
			expect(app).toContain('registerEventsDriver(sqsEventsDriver);');
			expect(app).not.toContain('pgbossEventsDriver');

			const { text } = await bundle(outputDir, [
				...BROKER_MODULES.pgboss,
				...BROKER_MODULES.rabbitmq,
			]);

			expect(bundled(text, '@aws-sdk/client-sns')).toBe(true);
			expect(bundled(text, '@aws-sdk/client-sqs')).toBe(true);
			expect(bundled(text, 'pg-boss')).toBe(false);
			expect(bundled(text, 'amqplib')).toBe(false);
		},
	);

	describe('a pg-boss project with the AWS SDK not installed', () => {
		const schema = `pgboss_bundle_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
		const database = `geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`;
		const broker = `pgboss://${database}?schema=${schema}`;
		let dir: string;
		let outputDir: string;
		let server: string;

		beforeAll(async () => {
			dir = project();
			outputDir = await generate(dir, 'pgboss');
			server = (
				await bundle(outputDir, [
					...BROKER_MODULES.sns,
					...BROKER_MODULES.rabbitmq,
				])
			).bundle;
		}, 120_000);

		afterAll(async () => {
			const client = new Client({
				connectionString: `postgres://${database}`,
			});
			await client.connect();
			await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
			await client.end();
		});

		it('registers pg-boss alone and bundles none of the others', () => {
			const app = readFileSync(join(outputDir, 'app.ts'), 'utf8');
			expect(app).toContain('registerEventsDriver(pgbossEventsDriver);');
			expect(app).not.toMatch(/(sns|sqs|rabbitmq)EventsDriver/);

			const text = readFileSync(server, 'utf8');
			expect(bundled(text, 'pg-boss')).toBe(true);
			expect(bundled(text, '@aws-sdk/client-sns')).toBe(false);
			expect(bundled(text, '@aws-sdk/client-sqs')).toBe(false);
			expect(bundled(text, 'amqplib')).toBe(false);
		});

		it(
			'runs from a directory with no node_modules and delivers what it publishes',
			{ timeout: 60_000 },
			async () => {
				const { child, port, output } = await start(server, {
					USERS_PUBLISHER_CONNECTION_STRING: broker,
					EMAILS_PUBLISHER_CONNECTION_STRING: broker,
					EVENT_PUBLISHER_CONNECTION_STRING: broker,
				});
				try {
					// The subscriber and the queue consumer start polling as the
					// server starts; the cron is scheduled through the same driver.
					await until(output, 'Crons scheduled');

					const response = await fetch(`http://localhost:${port}/users`, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ id: 'u_192' }),
					});
					expect(response.status).toBe(200);

					await until(
						output,
						JSON.stringify({ marker: 'subscriber', userId: 'u_192' }),
					);
					await until(
						output,
						JSON.stringify({ marker: 'queue', to: 'u_192@example.com' }),
					);
					expect(output()).not.toContain('UnregisteredEventsScheme');
				} finally {
					child.kill('SIGKILL');
				}
			},
		);
	});
});

const freePort = () =>
	new Promise<number>((resolve) => {
		const server = createServer().listen(0, () => {
			const { port } = server.address() as { port: number };
			server.close(() => resolve(port));
		});
	});

/** The bundle, started with node alone; resolves once /health answers. */
async function start(
	bundle: string,
	env: Record<string, string>,
): Promise<{ port: number; child: ChildProcess; output: () => string }> {
	const port = await freePort();
	const child = spawn(process.execPath, [bundle], {
		// Somewhere with no node_modules: everything comes from the bundle.
		cwd: join(bundle, '..'),
		env: {
			PATH: process.env.PATH,
			PORT: String(port),
			NODE_ENV: 'production',
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
			child.kill('SIGKILL');
			throw new Error(`server did not start:\n${output}`);
		}
		await new Promise((r) => setTimeout(r, 100));
	}
	return { port, child, output: () => output };
}

/** Wait for a line in the server's output. */
async function until(output: () => string, text: string): Promise<void> {
	const deadline = Date.now() + 30_000;
	while (!output().includes(text)) {
		if (Date.now() > deadline) {
			throw new Error(`never logged ${text}:\n${output()}`);
		}
		await new Promise((r) => setTimeout(r, 200));
	}
}
