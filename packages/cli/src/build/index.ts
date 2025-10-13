import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Cron, Function, Subscriber } from '@geekmidas/constructs';
import type { Endpoint } from '@geekmidas/constructs';
import { loadConfig } from '../config';
import {
  CronGenerator,
  EndpointGenerator,
  FunctionGenerator,
  type GeneratedConstruct,
  SubscriberGenerator,
} from '../generators';
import type {
  BuildOptions,
  CronInfo,
  FunctionInfo,
  LegacyProvider,
  RouteInfo,
  SubscriberInfo,
} from '../types';
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
  if (config.subscribers) {
    logger.log(`Loading subscribers from: ${config.subscribers}`);
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
  const subscriberGenerator = new SubscriberGenerator();

  // Load all constructs in parallel
  const [allEndpoints, allFunctions, allCrons, allSubscribers] =
    await Promise.all([
      endpointGenerator.load(config.routes),
      config.functions ? functionGenerator.load(config.functions) : [],
      config.crons ? cronGenerator.load(config.crons) : [],
      config.subscribers ? subscriberGenerator.load(config.subscribers) : [],
    ]);

  logger.log(`Found ${allEndpoints.length} endpoints`);
  logger.log(`Found ${allFunctions.length} functions`);
  logger.log(`Found ${allCrons.length} crons`);
  logger.log(`Found ${allSubscribers.length} subscribers`);

  if (
    allEndpoints.length === 0 &&
    allFunctions.length === 0 &&
    allCrons.length === 0 &&
    allSubscribers.length === 0
  ) {
    logger.log(
      'No endpoints, functions, crons, or subscribers found to process',
    );
    return;
  }

  // Ensure .gkm directory exists
  const rootOutputDir = join(process.cwd(), '.gkm');
  await mkdir(rootOutputDir, { recursive: true });

  // Collect all build results from each provider
  const allBuildResults = await Promise.all(
    resolved.providers.map((provider) =>
      buildForProvider(
        provider,
        buildContext,
        endpointGenerator,
        functionGenerator,
        cronGenerator,
        subscriberGenerator,
        allEndpoints,
        allFunctions,
        allCrons,
        allSubscribers,
        resolved.enableOpenApi,
      ),
    ),
  );

  // Aggregate all routes, functions, crons, and subscribers from all providers
  const aggregatedRoutes = allBuildResults.flatMap((result) => result.routes);
  const aggregatedFunctions = allBuildResults.flatMap(
    (result) => result.functions,
  );
  const aggregatedCrons = allBuildResults.flatMap((result) => result.crons);
  const aggregatedSubscribers = allBuildResults.flatMap(
    (result) => result.subscribers,
  );

  // Generate single manifest at root .gkm directory
  await generateManifests(
    rootOutputDir,
    aggregatedRoutes,
    aggregatedFunctions,
    aggregatedCrons,
    aggregatedSubscribers,
  );
}

interface BuildResult {
  routes: RouteInfo[];
  functions: FunctionInfo[];
  crons: CronInfo[];
  subscribers: SubscriberInfo[];
}

async function buildForProvider(
  provider: LegacyProvider,
  context: BuildContext,
  endpointGenerator: EndpointGenerator,
  functionGenerator: FunctionGenerator,
  cronGenerator: CronGenerator,
  subscriberGenerator: SubscriberGenerator,
  endpoints: GeneratedConstruct<Endpoint<any, any, any, any, any, any>>[],
  functions: GeneratedConstruct<Function<any, any, any, any>>[],
  crons: GeneratedConstruct<Cron<any, any, any, any>>[],
  subscribers: GeneratedConstruct<Subscriber<any, any, any, any, any, any>>[],
  enableOpenApi: boolean,
): Promise<BuildResult> {
  const outputDir = join(process.cwd(), '.gkm', provider);

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  logger.log(`\nGenerating handlers for provider: ${provider}`);

  // Build all constructs in parallel
  const [routes, functionInfos, cronInfos, subscriberInfos] = await Promise.all(
    [
      endpointGenerator.build(context, endpoints, outputDir, {
        provider,
        enableOpenApi,
      }),
      functionGenerator.build(context, functions, outputDir, { provider }),
      cronGenerator.build(context, crons, outputDir, { provider }),
      subscriberGenerator.build(context, subscribers, outputDir, { provider }),
    ],
  );

  logger.log(
    `Generated ${routes.length} routes, ${functionInfos.length} functions, ${cronInfos.length} crons, ${subscriberInfos.length} subscribers for ${provider}`,
  );

  // Return build results instead of generating manifest here
  return {
    routes,
    functions: functionInfos,
    crons: cronInfos,
    subscribers: subscriberInfos,
  };
}
