import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { Subscriber } from '@geekmidas/api/constructs';
import type { BuildContext } from '../build/types';
import type { SubscriberInfo } from '../types';
import {
  ConstructGenerator,
  type GeneratedConstruct,
  type GeneratorOptions,
} from './Generator';

export class SubscriberGenerator extends ConstructGenerator<
  Subscriber<any, any, any, any, any, any>,
  SubscriberInfo[]
> {
  isConstruct(value: any): value is Subscriber<any, any, any, any, any, any> {
    return Subscriber.isSubscriber(value);
  }

  async build(
    context: BuildContext,
    constructs: GeneratedConstruct<Subscriber<any, any, any, any, any, any>>[],
    outputDir: string,
    options?: GeneratorOptions,
  ): Promise<SubscriberInfo[]> {
    const provider = options?.provider || 'aws-lambda';
    const logger = console;
    const subscriberInfos: SubscriberInfo[] = [];

    if (constructs.length === 0 || provider !== 'aws-lambda') {
      return subscriberInfos;
    }

    // Create subscribers subdirectory
    const subscribersDir = join(outputDir, 'subscribers');
    await mkdir(subscribersDir, { recursive: true });

    // Generate subscriber handlers
    for (const { key, construct, path } of constructs) {
      const handlerFile = await this.generateSubscriberHandler(
        subscribersDir,
        path.relative,
        key,
        construct,
        context,
      );

      subscriberInfos.push({
        name: key,
        handler: relative(process.cwd(), handlerFile).replace(
          /\.ts$/,
          '.handler',
        ),
        subscribedEvents: construct.subscribedEvents || [],
        timeout: construct.timeout,
      });

      logger.log(`Generated subscriber handler: ${key}`);
    }

    return subscriberInfos;
  }

  private async generateSubscriberHandler(
    outputDir: string,
    sourceFile: string,
    exportName: string,
    subscriber: Subscriber<any, any, any, any, any, any>,
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

    const content = `import { AWSLambdaSubscriber } from '@geekmidas/api/adaptors';
import { ${exportName} } from '${importPath}';
import ${context.envParserImportPattern} from '${relativeEnvParserPath}';

const adapter = new AWSLambdaSubscriber(envParser, ${exportName});

export const handler = adapter.handler;
`;

    await writeFile(handlerPath, content);
    return handlerPath;
  }
}
