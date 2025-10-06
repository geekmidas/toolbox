import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'path';
import { loadCrons } from '../loadCrons';
import type { LegacyProvider, CronInfo } from '../types';
import type { BuildContext, ProcessedCron } from './types';

const logger = console;

export async function buildCrons(
  provider: LegacyProvider,
  outputDir: string,
  crons: ProcessedCron[],
  context: BuildContext,
): Promise<CronInfo[]> {
  const cronInfos: CronInfo[] = [];

  if (crons.length === 0 || provider !== 'aws-lambda') {
    return cronInfos;
  }

  // Create crons subdirectory
  const cronsDir = join(outputDir, 'crons');
  await mkdir(cronsDir, { recursive: true });

  // Generate cron handlers
  for (const { file, exportName, cron, schedule } of crons) {
    const handlerFile = await generateCronHandler(
      cronsDir,
      file,
      exportName,
      context.envParserPath,
      context.envParserImportPattern,
      context.loggerPath,
      context.loggerImportPattern,
    );

    cronInfos.push({
      name: exportName,
      handler: relative(process.cwd(), handlerFile).replace(
        /\.ts$/,
        '.handler',
      ),
      schedule: schedule || 'rate(1 hour)',
      timeout: cron.timeout,
    });

    logger.log(`Generated cron handler: ${exportName}`);
  }

  return cronInfos;
}

export async function processCrons(
  cronPatterns?: string | string[],
): Promise<ProcessedCron[]> {
  if (!cronPatterns) {
    return [];
  }

  const loadedCrons = await loadCrons(cronPatterns);

  return loadedCrons.map(({ name, cron, file, schedule }) => {
    logger.log(`Found cron: ${name} - ${schedule || 'no schedule'}`);

    return {
      file: relative(process.cwd(), file),
      exportName: name,
      cron,
      schedule,
    };
  });
}

// Generator function for crons

async function generateCronHandler(
  outputDir: string,
  sourceFile: string,
  exportName: string,
  envParserPath: string,
  envParserImportPattern: string,
  loggerPath: string,
  loggerImportPattern: string,
): Promise<string> {
  const handlerFileName = `${exportName}.ts`;
  const handlerPath = join(outputDir, handlerFileName);

  const relativePath = relative(dirname(handlerPath), sourceFile);
  const importPath = relativePath.replace(/\.ts$/, '.js');

  const relativeEnvParserPath = relative(dirname(handlerPath), envParserPath);
  const relativeLoggerPath = relative(dirname(handlerPath), loggerPath);

  const content = `import { AWSScheduledFunction } from '@geekmidas/api/aws-lambda';
import { ${exportName} } from '${importPath}';
import ${envParserImportPattern} from '${relativeEnvParserPath}';
import ${loggerImportPattern} from '${relativeLoggerPath}';

const adapter = new AWSScheduledFunction(envParser, ${exportName});

export const handler = adapter.handler;
`;

  await writeFile(handlerPath, content);
  return handlerPath;
}