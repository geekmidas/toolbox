import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'path';
import type {
  CronInfo,
  FunctionInfo,
  RouteInfo,
  SubscriberInfo,
} from '../types';

const logger = console;

export type ManifestProvider = 'aws' | 'server';

export interface ServerAppInfo {
  handler: string;
  endpoints: string;
}

export async function generateAwsManifest(
  outputDir: string,
  routes: RouteInfo[],
  functions: FunctionInfo[],
  crons: CronInfo[],
  subscribers: SubscriberInfo[],
): Promise<void> {
  const manifestDir = join(outputDir, 'manifest');
  await mkdir(manifestDir, { recursive: true });

  // Filter out 'ALL' method routes (server-specific)
  const awsRoutes = routes.filter((r) => r.method !== 'ALL');

  const content = `export const manifest = {
  routes: ${JSON.stringify(awsRoutes, null, 2)},
  functions: ${JSON.stringify(functions, null, 2)},
  crons: ${JSON.stringify(crons, null, 2)},
  subscribers: ${JSON.stringify(subscribers, null, 2)},
} as const;

// Derived types
export type Route = (typeof manifest.routes)[number];
export type Function = (typeof manifest.functions)[number];
export type Cron = (typeof manifest.crons)[number];
export type Subscriber = (typeof manifest.subscribers)[number];

// Useful union types
export type Authorizer = Route['authorizer'];
export type HttpMethod = Route['method'];
export type RoutePath = Route['path'];
`;

  const manifestPath = join(manifestDir, 'aws.ts');
  await writeFile(manifestPath, content);

  logger.log(
    `Generated AWS manifest with ${awsRoutes.length} routes, ${functions.length} functions, ${crons.length} crons, ${subscribers.length} subscribers`,
  );
  logger.log(`Manifest: ${relative(process.cwd(), manifestPath)}`);
}

export async function generateServerManifest(
  outputDir: string,
  appInfo: ServerAppInfo,
  routes: RouteInfo[],
  subscribers: SubscriberInfo[],
): Promise<void> {
  const manifestDir = join(outputDir, 'manifest');
  await mkdir(manifestDir, { recursive: true });

  // For server, extract route metadata (path, method, authorizer)
  const serverRoutes = routes
    .filter((r) => r.method !== 'ALL')
    .map((r) => ({
      path: r.path,
      method: r.method,
      authorizer: r.authorizer,
    }));

  // Server subscribers only need name and events
  const serverSubscribers = subscribers.map((s) => ({
    name: s.name,
    subscribedEvents: s.subscribedEvents,
  }));

  const content = `export const manifest = {
  app: ${JSON.stringify(appInfo, null, 2)},
  routes: ${JSON.stringify(serverRoutes, null, 2)},
  subscribers: ${JSON.stringify(serverSubscribers, null, 2)},
} as const;

// Derived types
export type Route = (typeof manifest.routes)[number];
export type Subscriber = (typeof manifest.subscribers)[number];

// Useful union types
export type Authorizer = Route['authorizer'];
export type HttpMethod = Route['method'];
export type RoutePath = Route['path'];
`;

  const manifestPath = join(manifestDir, 'server.ts');
  await writeFile(manifestPath, content);

  logger.log(
    `Generated server manifest with ${serverRoutes.length} routes, ${serverSubscribers.length} subscribers`,
  );
  logger.log(`Manifest: ${relative(process.cwd(), manifestPath)}`);
}
