import { mkdir } from 'node:fs/promises';
import { join } from 'path';
import { loadConfig } from '../config';
import type { BuildOptions, LegacyProvider } from '../types';
import type { BuildContext } from './types';
import { processEndpoints, buildEndpoints } from './endpoints';
import { processFunctions, buildFunctions } from './functions';
import { processCrons, buildCrons } from './crons';
import { generateManifests } from './manifests';
import { resolveProviders } from './providerResolver';

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

  // Process all constructs in parallel
  const [allEndpoints, allFunctions, allCrons] = await Promise.all([
    processEndpoints(config.routes),
    processFunctions(config.functions),
    processCrons(config.crons),
  ]);

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
  endpoints: Awaited<ReturnType<typeof processEndpoints>>,
  functions: Awaited<ReturnType<typeof processFunctions>>,
  crons: Awaited<ReturnType<typeof processCrons>>,
  enableOpenApi: boolean,
): Promise<void> {
  const outputDir = join(process.cwd(), '.gkm', provider);

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  logger.log(`\nGenerating handlers for provider: ${provider}`);

  // Build all constructs in parallel
  const [routes, functionInfos, cronInfos] = await Promise.all([
    buildEndpoints(provider, outputDir, endpoints, context, enableOpenApi),
    buildFunctions(provider, outputDir, functions, context),
    buildCrons(provider, outputDir, crons, context),
  ]);

  // Generate manifests
  await generateManifests(provider, outputDir, routes, functionInfos, cronInfos);
}