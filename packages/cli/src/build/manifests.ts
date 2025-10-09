import { writeFile } from 'node:fs/promises';
import { join, relative } from 'path';
import type {
  BuildManifest,
  CronInfo,
  FunctionInfo,
  RouteInfo,
} from '../types';

const logger = console;

export async function generateManifests(
  outputDir: string,
  routes: RouteInfo[],
  functions: FunctionInfo[],
  crons: CronInfo[],
): Promise<void> {
  // Generate unified manifest for all providers
  const manifest: BuildManifest = {
    routes,
    functions,
    crons,
  };

  const manifestPath = join(outputDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  logger.log(
    `Generated ${routes.length} routes, ${functions.length} functions, ${crons.length} crons in ${relative(process.cwd(), outputDir)}`,
  );
  logger.log(`Manifest: ${relative(process.cwd(), manifestPath)}`);
}
