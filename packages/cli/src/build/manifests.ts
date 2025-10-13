import { writeFile } from 'node:fs/promises';
import { join, relative } from 'path';
import type {
  BuildManifest,
  CronInfo,
  FunctionInfo,
  RouteInfo,
  SubscriberInfo,
} from '../types';

const logger = console;

export async function generateManifests(
  outputDir: string,
  routes: RouteInfo[],
  functions: FunctionInfo[],
  crons: CronInfo[],
  subscribers: SubscriberInfo[],
): Promise<void> {
  // Generate unified manifest for all providers
  const manifest: BuildManifest = {
    routes,
    functions,
    crons,
    subscribers,
  };

  const manifestPath = join(outputDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  logger.log(
    `\nGenerated unified manifest with ${routes.length} routes, ${functions.length} functions, ${crons.length} crons, ${subscribers.length} subscribers`,
  );
  logger.log(`Manifest: ${relative(process.cwd(), manifestPath)}`);
}
