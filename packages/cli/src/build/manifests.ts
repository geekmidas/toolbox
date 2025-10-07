import { writeFile } from 'node:fs/promises';
import { join, relative } from 'path';
import type {
  CronInfo,
  CronsManifest,
  FunctionInfo,
  FunctionsManifest,
  LegacyProvider,
  RouteInfo,
  RoutesManifest,
} from '../types';

const logger = console;

export async function generateManifests(
  provider: LegacyProvider,
  outputDir: string,
  routes: RouteInfo[],
  functions: FunctionInfo[],
  crons: CronInfo[],
): Promise<void> {
  if (provider === 'aws-lambda') {
    // Generate separate manifests for each construct type
    if (routes.length > 0) {
      const routesManifest: RoutesManifest = { routes };
      const routesPath = join(outputDir, 'routes.json');
      await writeFile(routesPath, JSON.stringify(routesManifest, null, 2));
      logger.log(`Routes manifest: ${relative(process.cwd(), routesPath)}`);
    }

    if (functions.length > 0) {
      const functionsManifest: FunctionsManifest = { functions };
      const functionsPath = join(outputDir, 'functions.json');
      await writeFile(
        functionsPath,
        JSON.stringify(functionsManifest, null, 2),
      );
      logger.log(
        `Functions manifest: ${relative(process.cwd(), functionsPath)}`,
      );
    }

    if (crons.length > 0) {
      const cronsManifest: CronsManifest = { crons };
      const cronsPath = join(outputDir, 'crons.json');
      await writeFile(cronsPath, JSON.stringify(cronsManifest, null, 2));
      logger.log(`Crons manifest: ${relative(process.cwd(), cronsPath)}`);
    }

    logger.log(
      `Generated ${routes.length} routes, ${functions.length} functions, ${crons.length} crons in ${relative(process.cwd(), outputDir)}`,
    );
  } else {
    // Generate single routes manifest for other providers
    const manifest: RoutesManifest = { routes };
    const manifestPath = join(outputDir, 'routes.json');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    logger.log(
      `Generated ${routes.length} handlers in ${relative(process.cwd(), outputDir)}`,
    );
    logger.log(`Routes manifest: ${relative(process.cwd(), manifestPath)}`);
  }
}
