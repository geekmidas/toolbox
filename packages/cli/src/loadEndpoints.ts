import { Endpoint } from '@geekmidas/api/server';
import fg from 'fast-glob';
import type { Routes } from './types';

export interface LoadedEndpoint {
  name: string;
  endpoint: Endpoint<any, any, any, any, any, any>;
  file: string;
}

export async function loadEndpoints(routes: Routes): Promise<LoadedEndpoint[]> {
  const logger = console;

  // Find all endpoint files
  const files = await fg.stream(routes, {
    cwd: process.cwd(),
    absolute: true,
  });

  // Load endpoints
  const endpoints: LoadedEndpoint[] = [];

  for await (const f of files) {
    try {
      const file = f.toString();
      const module = await import(file);

      // Check all exports for endpoints
      for (const [exportName, exportValue] of Object.entries(module)) {
        if (Endpoint.isEndpoint(exportValue)) {
          exportValue.operationId = exportName;
          endpoints.push({
            name: exportName,
            endpoint: exportValue as Endpoint<any, any, any, any, any, any>,
            file,
          });
        }
      }
    } catch (error) {
      logger.warn(`Failed to load ${f}:`, (error as Error).message);
      throw new Error(
        'Failed to load endpoints. Please check the logs for details.',
      );
    }
  }

  return endpoints;
}
