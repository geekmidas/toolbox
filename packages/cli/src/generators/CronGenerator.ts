import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { Cron } from '@geekmidas/constructs/crons';
import type { BuildContext } from '../build/types';
import type { CronInfo } from '../types';
import { runtimeFor } from './EndpointGenerator.js';
import {
	ConstructGenerator,
	type GeneratedConstruct,
	type GeneratorOptions,
} from './Generator';

export class CronGenerator extends ConstructGenerator<
	Cron<any, any, any, any, any, any>,
	CronInfo[]
> {
	async build(
		context: BuildContext,
		constructs: GeneratedConstruct<Cron<any, any, any, any, any, any>>[],
		outputDir: string,
		options?: GeneratorOptions,
	): Promise<CronInfo[]> {
		const target = options?.target ?? 'aws';
		const logger = console;
		const cronInfos: CronInfo[] = [];

		if (target === 'server') {
			// A server runs its crons itself, the way it already runs its
			// subscribers: one file, wired into the generated entry. Written even
			// when there are none, so the entry can import it unconditionally.
			await this.generateServerCronsFile(outputDir, constructs);

			logger.log(`Generated server crons file with ${constructs.length} crons`);

			// A server cron has no individual handler to point infra at — the
			// process schedules it.
			return cronInfos;
		}

		if (constructs.length === 0) {
			return cronInfos;
		}

		// Create crons subdirectory
		const cronsDir = join(outputDir, 'crons');
		await mkdir(cronsDir, { recursive: true });

		// Generate cron handlers
		for (const { key, construct, path } of constructs) {
			const handlerFile = await this.generateCronHandler(
				cronsDir,
				path.relative,
				key,
				context,
				construct.owner,
			);

			cronInfos.push({
				name: key,
				handler: relative(options?.root ?? process.cwd(), handlerFile).replace(
					/\.ts$/,
					'.handler',
				),
				schedule: construct.schedule || 'rate(1 hour)',
				timeout: construct.timeout,
				memorySize: construct.memorySize,
				environment: await construct.getEnvironment({
					markOptional: context.markOptional,
				}),
				dependencies: construct.constructs,
			});

			logger.log(`Generated cron handler: ${key}`);
		}

		return cronInfos;
	}

	isConstruct(value: any): value is Cron<any, any, any, any, any, any> {
		return Cron.isCron(value);
	}

	/**
	 * The crons file a server entry imports.
	 *
	 * Shaped after `generateServerSubscribersFile`: one module, every cron, a
	 * `setupCrons` the generated entry calls beside `setupSubscribers`.
	 *
	 * It picks its scheduler from what the process can reach. With a Postgres it
	 * uses pg-boss, whose schedules live in the database — so a deployment
	 * running four replicas fires each job once, which is the thing a timer in
	 * every process gets wrong and does not report. With no database it falls
	 * back to timers and says plainly that it is doing so.
	 */
	private async generateServerCronsFile(
		outputDir: string,
		crons: GeneratedConstruct<Cron<any, any, any, any, any, any>>[],
	): Promise<string> {
		await mkdir(outputDir, { recursive: true });

		const cronsPath = join(outputDir, 'crons.ts');

		// Nothing to schedule, so nothing to import — the entry imports this file
		// whatever the app declares, and a project with no events must not have
		// to resolve `@geekmidas/events`.
		if (crons.length === 0) {
			await writeFile(
				cronsPath,
				`/**
 * Generated cron setup — this app declares none.
 */
import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';

export async function setupCrons(
  _envParser: EnvironmentParser<any>,
  _logger: Logger,
): Promise<void> {}

export function cronsStatus(): { failed: string[]; connections: unknown[] } {
  return { failed: [], connections: [] };
}

export async function stopCrons(): Promise<void> {}
`,
			);
			return cronsPath;
		}

		const importsByFile = new Map<string, string[]>();
		for (const { path, key } of crons) {
			const relativePath = relative(dirname(cronsPath), path.relative);
			const importPath = relativePath.replace(/\.ts$/, '.js');

			if (!importsByFile.has(importPath)) importsByFile.set(importPath, []);
			importsByFile.get(importPath)?.push(key);
		}

		const imports = Array.from(importsByFile.entries())
			.map(
				([importPath, exports]) =>
					`import { ${exports.join(', ')} } from '${importPath}';`,
			)
			.join('\n');

		const entries = crons
			.map(({ key }) => `  { name: '${key}', cron: ${key} }`)
			.join(',\n');

		const content = `/**
 * Generated cron setup.
 *
 * Schedules every cron this app declares, in the process that serves it.
 *
 * The schedule lives in Postgres, through pg-boss, in the database the worker
 * named with \`.database(db)\`. That is what makes running several replicas
 * safe: each job fires once, where a timer in every process fires it once per
 * replica and reports nothing.
 *
 * No connection string appears here. The construct that owns the database is
 * the only thing that knows its key, and it is resolved through service
 * discovery like any other dependency.
 */
import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { runCron, scheduleInProcess, toCronExpression } from '@geekmidas/constructs/crons';
import { ServiceDiscovery } from '@geekmidas/services';
${imports}

const crons = [
${entries}
];

type Stoppable = { stop: () => Promise<void> | void };
const running: Stoppable[] = [];
// What a worker's health check reads: the crons that cannot be scheduled, and
// the broker connection the schedule is kept through.
const failed: string[] = [];
const connections: import('@geekmidas/events').EventConnection[] = [];

export async function setupCrons(
  envParser: EnvironmentParser<any>,
  logger: Logger,
): Promise<void> {
  if (crons.length === 0) {
    return;
  }

  const serviceDiscovery = ServiceDiscovery.getInstance(envParser);

  // Resolved once per cron rather than per firing: registering services on
  // every tick would reconnect a database every minute.
  const prepared = [];
  for (const { name, cron } of crons) {
    try {
      const schedule = toCronExpression(cron.schedule);
      const services = cron.services.length > 0
        ? await serviceDiscovery.register(cron.services)
        : {};

      prepared.push({ name, cron, schedule, services });
    } catch (error) {
      // An unrepresentable schedule is a build-time mistake, and failing the
      // process for it would take the HTTP server down with it.
      logger.error({ err: error, cron: name }, 'Cron has no runnable schedule, skipping');
      failed.push(name);
    }
  }

  const run = async (entry: (typeof prepared)[number]) => {
    try {
      // The cron's own function, the way its Lambda would run it — services,
      // the worker's database as \`db\`, its events. It used to call a
      // \`handler\` a Cron does not have, so every firing logged a failure.
      await runCron(entry.cron, serviceDiscovery);
    } catch (error) {
      logger.error({ err: error, cron: entry.name }, 'Cron failed');
    }
  };

  // The app's one pg-boss: the events broker's, as the broker's role, in the
  // broker's schema. A server fires its own crons, and a process scheduling in
  // memory fires each job once per replica — so the schedule lives in
  // Postgres. It used to be a second pg-boss on the worker's database, as the
  // runtime role, which can neither create a schema nor use the broker's.
  const { url, devPid } = envParser
    .create((get) => ({
      url: get('EVENT_PUBLISHER_CONNECTION_STRING').string().optional(),
      // Set by \`gkm dev\` on the server it starts, and by nothing deployed.
      devPid: get('GKM_DEV_PID').string().optional(),
    }))
    .parse();

  if (!url?.startsWith('pgboss://')) {
    // \`gkm dev\` on a target whose crons are infrastructure once deployed —
    // EventBridge rules on AWS — has no broker to keep a schedule in. It is one
    // process, so a timer fires each job once, which is all pg-boss is for
    // here. Only there: a deployed server firing by timer fires once per
    // replica, so outside dev this stays the error below.
    if (devPid) {
      for (const entry of prepared) {
        running.push(scheduleInProcess(entry.schedule, () => run(entry)));
        logger.info({ cron: entry.name, schedule: entry.schedule }, 'Cron scheduled in this process');
      }
      return;
    }

    logger.error(
      { crons: prepared.map(({ name }) => name) },
      'These crons have nowhere to keep their schedule. On a server they are ' +
        'scheduled through the pg-boss events broker ' +
        '(EVENT_PUBLISHER_CONNECTION_STRING), and ' +
        (url ? 'the broker configured is not pg-boss.' : 'none is configured.'),
    );
    failed.push(...prepared.map(({ name }) => name));
    return;
  }

  // Through the registered pg-boss driver, which the entry registers for a
  // server whose broker is pg-boss. Naming \`@geekmidas/events/pgboss\` here
  // made every bundle with a cron resolve pg-boss, whatever its broker.
  const { EventConnectionFactory } = await import('@geekmidas/events');
  const connection = (await EventConnectionFactory.fromConnectionString(
    url,
  )) as import('@geekmidas/events').EventConnection & { instance?: any };
  const boss = connection.instance!;

  // What this app declares now. Anything else under the prefix belonged to a
  // cron since renamed or deleted, and would keep firing at a handler that has
  // gone.
  //
  // The prefix is \`cron.\` rather than \`cron:\`: pg-boss accepts
  // alphanumerics, underscores, hyphens, periods and slashes in a queue name,
  // and rejects a colon outright.
  const declared = new Set(prepared.map(({ name }) => \`cron.\${name}\`));
  for (const existing of await boss.getSchedules()) {
    if (existing.name.startsWith('cron.') && !declared.has(existing.name)) {
      await boss.unschedule(existing.name);
      logger.info({ cron: existing.name }, 'Removed a schedule nothing declares');
    }
  }

  for (const entry of prepared) {
    const queue = \`cron.\${entry.name}\`;
    await boss.createQueue(queue);
    // UTC, so this agrees with the schedule a deploy target would have made.
    await boss.schedule(queue, entry.schedule, undefined, { tz: 'UTC' });
    await boss.work(queue, () => run(entry));

    logger.info({ cron: entry.name, schedule: entry.schedule }, 'Cron scheduled');
  }

  running.push({ stop: () => connection.close() });
  connections.push(connection);
  logger.info({ count: prepared.length }, 'Crons scheduled');
}

/** The crons that cannot be scheduled, and the connection that schedules the rest. */
export function cronsStatus(): {
  failed: string[];
  connections: import('@geekmidas/events').EventConnection[];
} {
  return { failed: [...failed], connections: [...connections] };
}

/**
 * Stop scheduling, let a firing in flight finish, and close the broker
 * connection — pg-boss's graceful stop does all three. The caller bounds it.
 */
export async function stopCrons(): Promise<void> {
  const open = [...running];
  running.length = 0;
  connections.length = 0;
  await Promise.all(open.map((r) => r.stop()));
}
`;

		await writeFile(cronsPath, content);

		return cronsPath;
	}

	private async generateCronHandler(
		outputDir: string,
		sourceFile: string,
		exportName: string,
		context: BuildContext,
		/** The construct that owns this — its worker, or its surface. */
		owner: string | undefined,
	): Promise<string> {
		const handlerFileName = `${exportName}.ts`;
		const handlerPath = join(outputDir, handlerFileName);

		const relativePath = relative(dirname(handlerPath), sourceFile);
		const importPath = relativePath.replace(/\.ts$/, '.js');

		// Imports the construct that owns this, and binds `envParser` and
		// `logger` off it — the objects it was declared with, rather than a
		// module path printed in from config.
		const runtime = runtimeFor(context, dirname(handlerPath), owner);

		const content = `import { AWSScheduledFunction } from '@geekmidas/constructs/aws';
import { ${exportName} } from '${importPath}';
${runtime.imports}
${context.storageDrivers?.imports ?? ''}
${runtime.bindings}
${context.storageDrivers?.setup ? `\n// The handler registers the drivers its target needs.\n${context.storageDrivers.setup}\n` : ''}
const adapter = new AWSScheduledFunction(envParser, ${exportName});

export const handler = adapter.handler;
`;

		await writeFile(handlerPath, content);
		return handlerPath;
	}
}
