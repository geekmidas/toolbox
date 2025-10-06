import { Cron } from '@geekmidas/api/constructs';
import fg from 'fast-glob';
import type { Routes } from './types';

export interface LoadedCron {
  name: string;
  cron: Cron<any, any, any, any>;
  file: string;
}

export async function loadCrons(patterns?: Routes): Promise<LoadedCron[]> {
  if (!patterns) {
    return [];
  }

  const logger = console;

  // Normalize patterns to array
  const cronPatterns = Array.isArray(patterns) ? patterns : [patterns];

  // Find all cron files
  const files = await fg.stream(cronPatterns, {
    cwd: process.cwd(),
    absolute: true,
  });

  // Load crons
  const crons: LoadedCron[] = [];

  for await (const f of files) {
    try {
      const file = f.toString();
      const module = await import(file);

      // Check all exports for crons
      for (const [exportName, exportValue] of Object.entries(module)) {
        if (Cron.isCron(exportValue)) {
          const cronInstance = exportValue as Cron<any, any, any, any>;
          crons.push({
            name: exportName,
            cron: cronInstance,
            file,
          });
        }
      }
    } catch (error) {
      logger.warn(`Failed to load ${f}:`, (error as Error).message);
      throw new Error(
        'Failed to load crons. Please check the logs for details.',
      );
    }
  }

  return crons;
}
