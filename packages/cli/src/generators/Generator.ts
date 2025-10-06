import { join, relative } from 'path';
import fg from 'fast-glob';
import { mkdir } from 'fs/promises';
import kebabcase from 'lodash.kebabcase';
import type { BuildContext } from '../build/types';
import type { LegacyProvider, Routes } from '../types';

export abstract class ConstructGenerator<T> {
  abstract isConstruct(value: any): value is T;

  abstract buildConstruct(provider: LegacyProvider): Promise<string>;
  abstract generateHandlerFile(
    context: BuildContext,
    construct: GeneratedConstruct<T>,
  ): Promise<string>;

  async build(
    context: BuildContext,
    constructs: GeneratedConstruct<T>[],
    outputDir: string,
  ): Promise<void> {
    // For aws-lambda, create routes subdirectory
    const routesDir = join(outputDir, 'routes');
    await mkdir(routesDir, { recursive: true });
  }

  async load(patterns?: Routes): Promise<GeneratedConstruct<T>[]> {
    const logger = console;

    // Normalize patterns to array
    const cronPatterns = Array.isArray(patterns)
      ? patterns
      : patterns
        ? [patterns]
        : [];

    // Find all cron files
    const files = fg.stream(cronPatterns, {
      cwd: process.cwd(),
      absolute: true,
    });

    // Load crons
    const constructs: GeneratedConstruct<T>[] = [];

    for await (const f of files) {
      try {
        const file = f.toString();
        const module = await import(file);

        // Check all exports for crons
        for (const [key, construct] of Object.entries(module)) {
          if (this.isConstruct(construct)) {
            constructs.push({
              key,
              name: kebabcase(key),
              construct,
              path: {
                absolute: file,
                relative: relative(process.cwd(), file),
              },
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

    return constructs;
  }
}

export interface GeneratedConstruct<T> {
  key: string;
  name: string;
  construct: T;
  path: {
    absolute: string;
    relative: string;
  };
}
