import { Function } from '@geekmidas/api/constructs';
import fg from 'fast-glob';
import type { Routes } from './types';

export interface LoadedFunction {
  name: string;
  fn: Function<any, any, any, any, any>;
  file: string;
}

export async function loadFunctions(
  patterns?: Routes,
): Promise<LoadedFunction[]> {
  if (!patterns) {
    return [];
  }

  const logger = console;

  // Normalize patterns to array
  const functionPatterns = Array.isArray(patterns) ? patterns : [patterns];

  // Find all function files
  const files = await fg.stream(functionPatterns, {
    cwd: process.cwd(),
    absolute: true,
  });

  // Load functions
  const functions: LoadedFunction[] = [];

  for await (const f of files) {
    try {
      const file = f.toString();
      const module = await import(file);

      // Check all exports for functions
      for (const [exportName, exportValue] of Object.entries(module)) {
        if (Function.isFunction(exportValue)) {
          functions.push({
            name: exportName,
            fn: exportValue as Function<any, any, any, any, any>,
            file,
          });
        }
      }
    } catch (error) {
      logger.warn(`Failed to load ${f}:`, (error as Error).message);
      throw new Error(
        'Failed to load functions. Please check the logs for details.',
      );
    }
  }

  return functions;
}
