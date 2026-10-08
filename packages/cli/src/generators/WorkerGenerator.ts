import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Cron } from '@geekmidas/constructs/crons';
import type { Queue } from '@geekmidas/constructs/queue';
import type { Subscriber } from '@geekmidas/constructs/subscribers';
import type { BuildContext } from '../build/types';
import { appKey } from '../workspace/derive.js';
import { CronGenerator } from './CronGenerator';
import { runtimeFor } from './EndpointGenerator.js';
import type { GeneratedConstruct } from './Generator';
import { QueueGenerator } from './QueueGenerator';
import { SubscriberGenerator } from './SubscriberGenerator';
import {
	startTelemetryCode,
	type TelemetryContext,
	writeTelemetryModule,
} from './telemetry';

/**
 * A worker whose topic subscribers would have to be pushed to over HTTP.
 *
 * On SNS a subscriber is an HTTP endpoint SNS delivers to, and a worker's
 * process serves nothing but its health check. A server target's broker is
 * pg-boss, where each subscriber polls a queue of its own, so this is only
 * reached by building server images for a project that deploys to AWS — where
 * a subscriber is a Lambda instead.
 */
export class WorkerSubscribersNeedPush extends Error {
	constructor(
		readonly worker: string,
		readonly subscribers: readonly string[],
	) {
		super(
			`The worker '${worker}' runs topic subscribers (${subscribers.join(', ')}), ` +
				`and this build's broker is SNS, which pushes each event to its ` +
				`subscriber over HTTP. A worker image serves only its health check. ` +
				`Deploy to a server target, whose broker is pg-boss and whose ` +
				`subscribers poll, or to AWS, where each subscriber is a Lambda.`,
		);
		this.name = 'WorkerSubscribersNeedPush';
	}
}

/** Where a worker's generated entry lives, under an app's `.gkm/server`. */
export function workerEntryDir(serverDir: string, workerId: string): string {
	return join(serverDir, 'workers', appKey(workerId));
}

/** The file a worker's bundle is written to, beside the server's. */
export function workerBundleName(workerId: string): string {
	return `worker-${appKey(workerId)}.mjs`;
}

export interface WorkerEntryInput {
	context: BuildContext;
	/** The worker's construct id, `Jobs`. */
	workerId: string;
	/** The worker's own directory — see `workerEntryDir`. */
	outputDir: string;
	/** Everything built from this worker, and nothing built from another. */
	crons: GeneratedConstruct<Cron<any, any, any, any, any, any>>[];
	queues: GeneratedConstruct<Queue<any, any, any, any, any, any>>[];
	subscribers: GeneratedConstruct<
		Subscriber<any, any, any, any, any, any, any>
	>[];
	/** What its process starts OpenTelemetry with — none without an edge. */
	telemetry?: TelemetryContext;
}

/**
 * A Worker's production entry: the process that runs its crons, its queue
 * consumers and its topic subscribers, and answers nothing but a health check.
 *
 * It is the server's runtime without the server. The `crons.ts`, `queues.ts`
 * and `subscribers.ts` it starts are the files `gkm dev` starts — written by
 * the same generators, given only this worker's constructs — so a consumer
 * runs the same code in development and in the image. What it adds is the
 * process around them: drivers, a health check that says when a consumer or
 * the broker is down, and a shutdown that drains.
 */
export class WorkerGenerator {
	constructor(
		private readonly generators = {
			cron: new CronGenerator(),
			queue: new QueueGenerator(),
			subscriber: new SubscriberGenerator(),
		},
	) {}

	/** Write the worker's files; returns its entry, `worker.ts`. */
	async build(input: WorkerEntryInput): Promise<string> {
		const { context, workerId, outputDir } = input;

		if (
			input.subscribers.length > 0 &&
			context.eventsBackends?.includes('sns')
		) {
			throw new WorkerSubscribersNeedPush(
				workerId,
				input.subscribers.map(({ key }) => key),
			);
		}

		await mkdir(outputDir, { recursive: true });
		const options = { target: 'server' as const };
		await Promise.all([
			this.generators.cron.build(context, input.crons, outputDir, options),
			this.generators.queue.build(context, input.queues, outputDir, options),
			this.generators.subscriber.build(
				context,
				input.subscribers,
				outputDir,
				options,
			),
		]);

		await writeFile(
			join(outputDir, 'app.ts'),
			workerApp(context, workerId, outputDir),
		);
		// The worker's own edge decides, not the app's that carries it.
		await writeTelemetryModule(outputDir, input.telemetry);

		const entry = join(outputDir, 'worker.ts');
		await writeFile(
			entry,
			workerEntry(context.production?.healthCheck ?? '/health'),
		);
		return entry;
	}
}

/**
 * `app.ts`: the worker's runtime — its logger and environment parser off the
 * Worker construct, the drivers its target needs, and a `startWorker` that
 * starts every cron, consumer and subscriber it owns.
 */
function workerApp(
	context: BuildContext,
	workerId: string,
	outputDir: string,
): string {
	const runtime = runtimeFor(context, outputDir, workerId);

	return `/**
 * Generated worker runtime for ${workerId}.
 * Generated by 'gkm build --production'.
 */
import { setupCrons, cronsStatus, stopCrons } from './crons.js';
import { setupQueues, queuesStatus, stopQueues } from './queues.js';
import { setupSubscribers, subscribersStatus, stopSubscribers } from './subscribers.js';
${runtime.imports}
${context.storageDrivers?.imports ?? ''}

${runtime.bindings}

${
	context.storageDrivers?.setup
		? `// The entry point registers the drivers its target needs.
${context.storageDrivers.setup}
`
		: ''
}
// Who this worker is to Postgres: application_name on every connection.
process.env.GKM_APP_NAME ??= ${JSON.stringify(workerId)};

export { logger };

/** What the health check answers, and why. */
export interface WorkerHealth {
  healthy: boolean;
  /** The crons, queues and subscribers that could not start. */
  failed: string[];
  /** How many broker connections did not answer. */
  down: number;
}

/** Whether one broker connection answers: open, and — on pg-boss — a query. */
async function answers(connection: unknown): Promise<boolean> {
  const c = connection as {
    isConnected?: () => boolean;
    instance?: { getDb?: () => { executeSql: (sql: string) => Promise<unknown> } };
  };
  if (c.isConnected && !c.isConnected()) return false;
  const db = c.instance?.getDb?.();
  if (!db) return true;
  try {
    await Promise.race([
      db.executeSql('select 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000).unref()),
    ]);
    return true;
  } catch {
    return false;
  }
}

/** Start everything this worker runs. */
export async function startWorker(): Promise<{
  health: () => Promise<WorkerHealth>;
  stop: () => Promise<void>;
}> {
  // An app object with no routes: on a server target nothing is pushed to a
  // subscriber, so there is nothing to mount.
  const noRoutes = { post: () => undefined };

  await setupSubscribers(noRoutes, envParser, logger).catch((error) => {
    logger.error({ err: error }, 'Failed to start subscribers');
  });
  await setupQueues(envParser, logger).catch((error) => {
    logger.error({ err: error }, 'Failed to start queue consumers');
  });
  await setupCrons(envParser, logger).catch((error) => {
    logger.error({ err: error }, 'Failed to schedule crons');
  });

  const statuses = () => [subscribersStatus(), queuesStatus(), cronsStatus()];

  return {
    async health() {
      const all = statuses();
      const failed = all.flatMap((s) => s.failed);
      const alive = await Promise.all(
        all.flatMap((s) => s.connections as unknown[]).map(answers),
      );
      const down = alive.filter((ok) => !ok).length;
      return { healthy: failed.length === 0 && down === 0, failed, down };
    },
    // Each stops pulling, waits for what it has in flight, and closes its
    // broker connection. Together, so one slow handler does not hold the
    // others' connections open.
    async stop() {
      await Promise.all([stopSubscribers(), stopQueues(), stopCrons()]);
    },
  };
}
`;
}

/**
 * `worker.ts`: the process. Health first, so the container answers while the
 * consumers connect; then the worker; then a shutdown that drains.
 */
function workerEntry(healthCheck: string): string {
	return `#!/usr/bin/env node
/**
 * Production worker entry point.
 * Generated by 'gkm build --production'.
 *
 * Runs this worker's crons, queue consumers and topic subscribers, and serves
 * one route: ${healthCheck}, on PORT — 200 when every consumer started and
 * every broker connection answers, 503 otherwise.
 *
 * On SIGTERM it stops pulling messages and scheduling crons, lets the handlers
 * in flight finish, closes its broker connections and database pools, and
 * exits 0 — or 1, at GKM_SHUTDOWN_TIMEOUT_MS (8s by default, under Docker's
 * 10s stop timeout).
 */
import { createServer } from 'node:http';
import { runShutdownHooks } from '@geekmidas/constructs';

${startTelemetryCode([healthCheck])}
const { startWorker, logger } = await import('./app.js');

const port = Number(process.env.PORT) || 3000;

let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
let stopping = false;

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path !== ${JSON.stringify(healthCheck)} || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(404).end();
    return;
  }
  const answer = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (stopping) return answer(503, { status: 'stopping' });
  if (!worker) return answer(503, { status: 'starting' });
  worker.health().then(
    (health) => answer(health.healthy ? 200 : 503, { status: health.healthy ? 'ok' : 'unhealthy', ...health }),
    (error) => answer(503, { status: 'unhealthy', error: String(error) }),
  );
});
server.listen(port);

const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  const deadline = Number(process.env.GKM_SHUTDOWN_TIMEOUT_MS) || 8000;
  logger.info({ deadline }, 'Graceful shutdown initiated');
  setTimeout(() => {
    logger.warn({ deadline }, 'Shutdown deadline reached, exiting');
    process.exit(1);
  }, deadline).unref();

  // Nothing new is pulled or scheduled; what is in flight finishes.
  await worker?.stop().catch((error) => logger.error({ err: error }, 'Failed to stop the worker'));
  // Then what the handlers used: database pools.
  await runShutdownHooks((error) => logger.error({ err: error }, 'Shutdown hook failed'));
  server.close();
  logger.info('Worker stopped');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

worker = await startWorker();
logger.info({ port }, 'Worker started');
`;
}
