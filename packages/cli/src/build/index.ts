import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Cron, Function } from '@geekmidas/api/constructs';
import type { Endpoint } from '@geekmidas/api/server';
import { loadConfig } from '../config';
import {
  CronGenerator,
  EndpointGenerator,
  FunctionGenerator,
  type GeneratedConstruct,
} from '../generators';
import type { BuildOptions, LegacyProvider } from '../types';
import { generateManifests } from './manifests';
import { resolveProviders } from './providerResolver';
import type { BuildContext } from './types';

const logger = console;

export async function buildCommand(options: BuildOptions): Promise<void> {
  const config = await loadConfig();

  // Resolve providers from new config format
  const resolved = resolveProviders(config, options);

  logger.log(`Building with providers: ${resolved.providers.join(', ')}`);
  logger.log(`Loading routes from: ${config.routes}`);
  if (config.functions) {
    logger.log(`Loading functions from: ${config.functions}`);
  }
  if (config.crons) {
    logger.log(`Loading crons from: ${config.crons}`);
  }
  logger.log(`Using envParser: ${config.envParser}`);

  // Parse envParser configuration
  const [envParserPath, envParserName] = config.envParser.split('#');
  const envParserImportPattern = !envParserName
    ? 'envParser'
    : envParserName === 'envParser'
      ? '{ envParser }'
      : `{ ${envParserName} as envParser }`;

  // Parse logger configuration
  const [loggerPath, loggerName] = config.logger.split('#');
  const loggerImportPattern = !loggerName
    ? 'logger'
    : loggerName === 'logger'
      ? '{ logger }'
      : `{ ${loggerName} as logger }`;

  const buildContext: BuildContext = {
    envParserPath,
    envParserImportPattern,
    loggerPath,
    loggerImportPattern,
  };

  // Initialize generators
  const endpointGenerator = new EndpointGenerator();
  const functionGenerator = new FunctionGenerator();
  const cronGenerator = new CronGenerator();

  // Load all constructs in parallel
  const [allEndpoints, allFunctions, allCrons] = await Promise.all([
    endpointGenerator.load(config.routes),
    config.functions ? functionGenerator.load(config.functions) : [],
    config.crons ? cronGenerator.load(config.crons) : [],
  ]);

  logger.log(`Found ${allEndpoints.length} endpoints`);
  logger.log(`Found ${allFunctions.length} functions`);
  logger.log(`Found ${allCrons.length} crons`);

  if (
    allEndpoints.length === 0 &&
    allFunctions.length === 0 &&
    allCrons.length === 0
  ) {
    logger.log('No endpoints, functions, or crons found to process');
    return;
  }

  // Build for each provider in parallel
  await Promise.all(
    resolved.providers.map((provider) =>
      buildForProvider(
        provider,
        buildContext,
        endpointGenerator,
        functionGenerator,
        cronGenerator,
        allEndpoints,
        allFunctions,
        allCrons,
        resolved.enableOpenApi,
      ),
    ),
  );
}

async function buildForProvider(
  provider: LegacyProvider,
  context: BuildContext,
  endpointGenerator: EndpointGenerator,
  functionGenerator: FunctionGenerator,
  cronGenerator: CronGenerator,
  endpoints: GeneratedConstruct<Endpoint<any, any, any, any, any, any>>[],
  functions: GeneratedConstruct<Function<any, any, any, any>>[],
  crons: GeneratedConstruct<Cron<any, any, any, any>>[],
  enableOpenApi: boolean,
): Promise<void> {
  const outputDir = join(process.cwd(), '.gkm', provider);

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  logger.log(`\nGenerating handlers for provider: ${provider}`);

  // Build all constructs in parallel
  const [routes, functionInfos, cronInfos] = await Promise.all([
    endpointGenerator.build(context, endpoints, outputDir, {
      provider,
      enableOpenApi,
    }),
    functionGenerator.build(context, functions, outputDir, { provider }),
    cronGenerator.build(context, crons, outputDir, { provider }),
  ]);

  // Generate manifests
  await generateManifests(
    provider,
    outputDir,
    routes,
    functionInfos,
    cronInfos,
  );
}
