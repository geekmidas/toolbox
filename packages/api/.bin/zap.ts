#!/usr/bin/env -S npx tsx

import * as fs from 'node:fs/promises';
import { console } from 'node:inspector';
import path from 'node:path';
import fg from 'fast-glob';
import merge from 'lodash.merge';
import { z } from 'zod/v4';
import { Handler } from '../src/rest-api/Endpoint';

const configSchema = z.object({
  routes: z.array(z.string()).default(['src/**/routes/*.ts']),
  openapi: z.any(),
});

type WrestConfig = z.infer<typeof configSchema>;

async function getProjectRoot(cwd: string): Promise<string> {
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

(async function main() {
  const root = process.cwd();
  const projectRoot = await getProjectRoot(root);
  const configPath = path.resolve(root, 'wrest.json');
  const stats = await fs.stat(configPath);
  let config: WrestConfig = { routes: [], openapi: {} };
  if (stats.isFile()) {
    const _config = await import(configPath);
    config = await configSchema.parseAsync(_config);
  }

  const { routes } = config;
  const endpoints: Record<string, any> = {};
  const openapi = config.openapi;

  const stream = fg.stream(routes);

  const parent = path.join(root, '.routes');

  await fs.mkdir(parent, { recursive: true });

  for await (const r of stream) {
    const routePath = path.resolve(root, r.toString());
    const route = await import(routePath);

    const handlers = Object.entries(route).filter(([key, value]) => {
      return Handler.isHandler(value);
    });

    console.log(`Processing route ${routePath}`);

    if (handlers.length === 0) {
      console.warn(`No endpoints found in ${routePath}`);
      continue;
    }

    for await (const [key, h] of handlers) {
      const handler = h as Handler<any, any, any, any>;
      console.log(`Found endpoint ${key} in ${routePath}`);
      const filePath = path.join(parent, `${key}.ts`);
      const relativePath = path.relative(parent, routePath);
      const statements = [
        'import { AWSApiGatewayV1EndpointAdaptor } from "@geekmidas/api/aws-lambda";',
        `import { ${key} } from "${relativePath}";`,
        '',
        `export const handler = new AWSApiGatewayV1EndpointAdaptor(${key}).handler;`,
      ];
      console.log(`Generating endpoint ${key} from ${relativePath}`);
      endpoints[handler.route()] = {
        handler: filePath
          .replace('.ts', '.handler')
          .replace(`${projectRoot}/`, ''),
      };

      const spec = await handler.toOpenAPI();
      openapi.paths = merge(openapi.paths, spec);
      await fs.writeFile(filePath, statements.join('\n'));
    }

    const routesFile = path.join(parent, 'routes.json');
    const openapiSpec = path.join(projectRoot, 'openapi.json');
    await fs.writeFile(routesFile, JSON.stringify(endpoints, null, 2));
    await fs.writeFile(openapiSpec, JSON.stringify(openapi, null, 2));
  }
})();
