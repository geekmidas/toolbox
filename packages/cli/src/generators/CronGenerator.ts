import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { Cron } from '@geekmidas/constructs/crons';
import type { BuildContext } from '../build/types';
import type { CronInfo } from '../types';
import {
	ConstructGenerator,
	type GeneratedConstruct,
	type GeneratorOptions,
} from './Generator';

export class CronGenerator extends ConstructGenerator<
	Cron<any, any, any, any, any, any, any, any>,
	CronInfo[]
> {
	async build(
		context: BuildContext,
		constructs: GeneratedConstruct<
			Cron<any, any, any, any, any, any, any, any>
		>[],
		outputDir: string,
		options?: GeneratorOptions,
	): Promise<CronInfo[]> {
		const provider = options?.provider || 'aws-lambda';
		const logger = console;
		const cronInfos: CronInfo[] = [];

		if (provider === 'server') {
			// A server runs its crons itself, the way it already runs its
			// subscribers: one file, wired into the generated entry. Written even
			// when there are none, so the entry can import it unconditionally.
			await this.generateServerCronsFile(outputDir, constructs);

			logger.log(`Generated server crons file with ${constructs.length} crons`);

			// A server cron has no individual handler to point infra at — the
			// process schedules it.
			return cronInfos;
		}

		if (constructs.length === 0 || provider !== 'aws-lambda') {
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
			);

			cronInfos.push({
				name: key,
				handler: relative(process.cwd(), handlerFile).replace(
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

	isConstruct(
		value: any,
	): value is Cron<any, any, any, any, any, any, any, any> {
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
		crons: GeneratedConstruct<Cron<any, any, any, any, any, any, any, any>>[],
	): Promise<string> {
		await mkdir(outputDir, { recursive: true });

		const cronsPath = join(outputDir, 'crons.ts');

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
import { toCronExpression } from '@geekmidas/constructs/crons';
import { ServiceDiscovery } from '@geekmidas/services';
${imports}

const crons = [
${entries}
];

type Stoppable = { stop: () => Promise<void> | void };
const running: Stoppable[] = [];

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
      logger.error({ error, cron: name }, 'Cron has no runnable schedule, skipping');
    }
  }

  const run = async (entry: (typeof prepared)[number]) => {
    try {
      await entry.cron.handler({
        input: undefined,
        services: entry.services,
        logger: entry.cron.logger,
      });
    } catch (error) {
      logger.error({ error, cron: entry.name }, 'Cron failed');
    }
  };

  // Declared once on the worker, carried onto every cron it built — so this
  // reads it from any of them rather than from config or the environment.
  const scheduleStore = prepared.find(({ cron }) => cron.scheduleStore)?.cron
    .scheduleStore;

  if (!scheduleStore) {
    // Declared, not discovered. A worker says where its schedules live with
    // \`.database(db)\`; inferring one from whatever database happened to be
    // around would move the schedules the day an app declared a second.
    logger.error(
      { crons: prepared.map(({ name }) => name) },
      'These crons have nowhere to keep their schedule. A server fires its own ' +
        'crons, and a process scheduling in memory fires each job once per ' +
        'replica — so the schedule lives in Postgres. Say where with ' +
        '\`new Worker(…).database(db)\`.',
    );
    return;
  }

  const [store] = await serviceDiscovery
    .register([scheduleStore])
    .then((s) => Object.values(s));

  const { PgBoss } = await import('pg-boss');
  // The pool the construct already opened — no connection string is read here,
  // and none is named anywhere outside the construct that owns it.
  const boss = new PgBoss({ db: store as never });
  await boss.start();

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

  running.push({ stop: () => boss.stop() });
  logger.info({ count: prepared.length }, 'Crons scheduled');
}

export async function stopCrons(): Promise<void> {
  await Promise.all(running.map((r) => r.stop()));
  running.length = 0;
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
	): Promise<string> {
		const handlerFileName = `${exportName}.ts`;
		const handlerPath = join(outputDir, handlerFileName);

		const relativePath = relative(dirname(handlerPath), sourceFile);
		const importPath = relativePath.replace(/\.ts$/, '.js');

		const relativeEnvParserPath = relative(
			dirname(handlerPath),
			context.envParserPath,
		);
		const relativeLoggerPath = relative(
			dirname(handlerPath),
			context.loggerPath,
		);

		const content = `import { AWSScheduledFunction } from '@geekmidas/constructs/aws';
import { ${exportName} } from '${importPath}';
import ${context.envParserImportPattern} from '${relativeEnvParserPath}';
import ${context.loggerImportPattern} from '${relativeLoggerPath}';

const adapter = new AWSScheduledFunction(envParser, ${exportName});

export const handler = adapter.handler;
`;

		await writeFile(handlerPath, content);
		return handlerPath;
	}
}
