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
  Cron<any, any, any, any>,
  CronInfo[]
> {
  async build(
    context: BuildContext,
    constructs: GeneratedConstruct<Cron<any, any, any, any>>[],
    outputDir: string,
    options?: GeneratorOptions,
  ): Promise<CronInfo[]> {
    const provider = options?.provider || 'aws-lambda';
    const logger = console;
    const cronInfos: CronInfo[] = [];

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
      });

      logger.log(`Generated cron handler: ${key}`);
    }

    return cronInfos;
  }

  isConstruct(value: any): value is Cron<any, any, any, any> {
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
