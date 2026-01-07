import path from 'node:path';
import type { Service } from '@geekmidas/services';
import fg from 'fast-glob';
import type { HttpMethod } from '../types';
import { Endpoint } from './Endpoint';

// Re-export utility functions

/**
 * Recursively finds the project root directory by looking for lock files.
 * Traverses up the directory tree until it finds a package manager lock file.
 *
 * @param cwd - The current working directory to start searching from
 * @returns Promise resolving to the absolute path of the project root
 *
 * @example
 * ```typescript
 * const projectRoot = await getProjectRoot(process.cwd());
 * console.log(`Project root: ${projectRoot}`);
 * // Output: Project root: /Users/user/my-project
 * ```
 */
export async function getProjectRoot(cwd: string): Promise<string> {
  if (cwd === '/') {
    return cwd;
  }

  const stream = fg.stream(
    ['yarn.lock', 'pnpm-lock.yaml', 'package-lock.json', 'deno.lock'],
    { dot: true, cwd },
  );

  let isRoot = false;

  for await (const _ of stream) {
    isRoot = true;
    break;
  }

  if (isRoot) {
    return cwd;
  }

  return getProjectRoot(path.resolve(cwd, '..'));
}

/**
 * Discovers and imports all Endpoint instances from the specified route patterns.
 * Uses fast-glob to find files matching the patterns and extracts exported Endpoints.
 *
 * @template TServices - Array of service types used by the endpoints
 * @param routes - Array of glob patterns to match route files (e.g., ['src/routes/*.ts'])
 * @param cwd - The current working directory to resolve paths from
 * @returns Promise resolving to an array of Endpoint instances found in the matched files
 *
 * @example
 * ```typescript
 * // Find all endpoints in the routes directory
 * const endpoints = await getEndpointsFromRoutes(
 *   ['src/routes/**\/*.ts'],
 *   process.cwd()
 * );
 *
 * // Register endpoints with your server
 * for (const endpoint of endpoints) {
 *   server.register(endpoint);
 * }
 * ```
 *
 * @remarks
 * - Only exports that are valid Endpoint instances are included
 * - Files are imported dynamically, so they must be valid ES modules
 * - The function filters out non-Endpoint exports automatically
 */
export async function getEndpointsFromRoutes<TServices extends Service[]>(
  routes: string[],
  cwd: string,
): Promise<Endpoint<string, HttpMethod, any, any, TServices>[]> {
  const stream = fg.stream(routes, { cwd });

  const endpoints: Endpoint<string, HttpMethod, any, any, TServices>[] = [];

  for await (const f of stream) {
    // Resolve the absolute path for the route file
    const routePath = path.resolve(cwd, f.toString());
    // Dynamically import the route module
    const route = await import(routePath);

    // Filter exported values to find only Endpoint instances
    const handlers = Object.values(route).filter((value) => {
      return Endpoint.isEndpoint(value);
    }) as unknown as Endpoint<string, HttpMethod, any, any, TServices>[];

    endpoints.push(...handlers);
  }

  return endpoints;
}
