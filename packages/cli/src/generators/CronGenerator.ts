import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { Cron } from '@geekmidas/constructs/crons';
import {
	type CronField,
	cronPeriod,
	InvalidCronExpressionError,
	toAwsCron,
} from '@geekmidas/manifest';
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
		// Every provider validates, so `gkm dev` fails like `gkm build` does.
		const schedules = resolveSchedules(constructs, logger);

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

			const schedule = schedules.get(key) as string;
			const uptime = construct.getUptime();

			cronInfos.push({
				name: key,
				handler: relative(process.cwd(), handlerFile).replace(
					/\.ts$/,
					'.handler',
				),
				schedule,
				timeout: construct.timeout,
				memorySize: construct.memorySize,
				environment: await construct.getEnvironment({
					markOptional: context.markOptional,
				}),
				...(uptime && { uptime: { ...uptime, period: cronPeriod(schedule) } }),
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

		const content = `import { AWSScheduledFunction } from '@geekmidas/constructs/crons';
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

/** A cron whose schedule failed validation. */
export interface InvalidCronSchedule {
	cron: string;
	schedule: string;
	/** Absent when the schedule isn't `cron(…)` with 5 or 6 fields. */
	field?: CronField;
	token: string;
}

/** One or more crons have an invalid schedule; all of them are listed. */
export class InvalidCronSchedulesError extends Error {
	constructor(readonly crons: InvalidCronSchedule[]) {
		super('Invalid cron schedules', { cause: { crons } });
		this.name = 'InvalidCronSchedulesError';
	}
}

/** Hourly, when a cron sets no schedule. */
const DEFAULT_SCHEDULE = 'cron(0 * * * *)';

/**
 * Each cron's schedule in the AWS form the manifest records, keyed by cron.
 * Every schedule is validated, since a cast or JavaScript caller gets past
 * the types, and all invalid ones are reported together.
 *
 * @throws {InvalidCronSchedulesError}
 */
function resolveSchedules(
	constructs: GeneratedConstruct<
		Cron<any, any, any, any, any, any, any, any>
	>[],
	logger: Pick<Console, 'warn'>,
): Map<string, string> {
	const schedules = new Map<string, string>();
	const invalid: InvalidCronSchedule[] = [];

	for (const { key, construct } of constructs) {
		const schedule = construct.schedule ?? DEFAULT_SCHEDULE;
		try {
			const { expression, warnings } = toAwsCron(schedule);
			for (const warning of warnings) {
				logger.warn('Cron schedule converted to AWS approximately', {
					cron: key,
					schedule,
					expression,
					...warning,
				});
			}
			schedules.set(key, expression);
		} catch (error) {
			if (!(error instanceof InvalidCronExpressionError)) throw error;
			invalid.push({
				cron: key,
				schedule,
				field: error.field,
				token: error.token,
			});
		}
	}

	if (invalid.length > 0) throw new InvalidCronSchedulesError(invalid);
	return schedules;
}
