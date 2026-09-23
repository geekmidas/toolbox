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
 * With a \`DATABASE_URL\` the schedule lives in Postgres through pg-boss, so
 * running several replicas fires each job once. Without one it falls back to
 * timers in this process, which is correct for a single replica and wrong for
 * more than one — so it says so rather than letting you find out from a job
 * that ran four times.
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

  const { databaseUrl } = envParser
    .create((get) => ({
      databaseUrl: get('DATABASE_URL').string().optional(),
    }))
    .parse();

  const serviceDiscovery = ServiceDiscovery.getInstance(envParser);

  // Resolved once per cron, not per firing: registering services on every tick
  // would reconnect a database every minute.
  const prepared = [];
  for (const { name, cron } of crons) {
    try {
      const schedule = toCronExpression(cron.schedule);
      const services = cron.services.length > 0
        ? await serviceDiscovery.register(cron.services)
        : {};

      prepared.push({ name, cron, schedule, services });
    } catch (error) {
      // A schedule that cannot be represented is a build-time mistake, and
      // failing the whole process for it would take the HTTP server down too.
      logger.error({ error, cron: name }, 'Cron has no runnable schedule, skipping');
    }
  }

  const run = async ({ name, cron, services }: (typeof prepared)[number]) => {
    try {
      await cron.handler({
        input: undefined,
        services,
        logger: cron.logger,
      });
    } catch (error) {
      logger.error({ error, cron: name }, 'Cron failed');
    }
  };

  if (!databaseUrl) {
    // The alternative was a timer in every process, which fires each job once
    // per replica and never says so — a wrong schedule that looks like a
    // working one. Refusing is the same call the schedule translator makes
    // about a rate it cannot represent exactly.
    logger.error(
      { crons: prepared.map(({ name }) => name) },
      'Crons need a DATABASE_URL on a server target: the schedule lives in ' +
        'Postgres so that running more than one replica still fires each job ' +
        'once. Declare a database, or deploy these crons to a target that ' +
        'schedules them itself.',
    );
    return;
  }

  const { PgBoss } = await import('pg-boss');
  const boss = new PgBoss({ connectionString: databaseUrl });
  await boss.start();

  // What this app declares now. Anything else under this prefix belonged to a
  // cron since renamed or deleted, and would otherwise keep firing against a
  // handler that is no longer there.
  const declared = new Set(prepared.map(({ name }) => \`cron:\${name}\`));
  for (const existing of await boss.getSchedules()) {
    if (existing.name.startsWith('cron:') && !declared.has(existing.name)) {
      await boss.unschedule(existing.name);
      logger.info({ cron: existing.name }, 'Removed a schedule nothing declares');
    }
  }

  for (const entry of prepared) {
    const queue = \`cron:\${entry.name}\`;
    await boss.createQueue(queue);
    // UTC, so this agrees with the schedule a deploy target would have created.
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
