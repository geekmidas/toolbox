import path from 'node:path';
import fg from 'fast-glob';
import { Endpoint } from './constructs/Endpoint';
import type { HttpMethod } from './constructs/types';
import type { Service } from './services';

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

export async function getEndpointsFromRoutes<TServices extends Service[]>(
  routes: string[],
  cwd: string,
): Promise<Endpoint<string, HttpMethod, any, any, TServices>[]> {
  const stream = fg.stream(routes, { cwd });

  const endpoints: Endpoint<string, HttpMethod, any, any, TServices>[] = [];

  for await (const f of stream) {
    const routePath = path.resolve(cwd, f.toString());
    const route = await import(routePath);

    const handlers = Object.values(route).filter((value) => {
      return Endpoint.isEndpoint(value);
    }) as unknown as Endpoint<string, HttpMethod, any, any, TServices>[];

    endpoints.push(...handlers);
  }

  return endpoints;
}
