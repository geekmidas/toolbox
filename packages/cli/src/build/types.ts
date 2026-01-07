import type { Cron } from '@geekmidas/constructs/crons';
import type { Endpoint } from '@geekmidas/constructs/endpoints';
import type { Function } from '@geekmidas/constructs/functions';

import type { CronInfo, FunctionInfo, RouteInfo } from '../types';

export interface ProcessedEndpoint {
  file: string;
  exportName: string;
  endpoint: Endpoint<any, any, any, any, any, any>;
  routeInfo: RouteInfo;
}

export interface ProcessedFunction {
  file: string;
  exportName: string;
  fn: Function<any, any, any, any, any>;
}

export interface ProcessedCron {
  file: string;
  exportName: string;
  cron: Cron<any, any, any, any>;
  schedule?: string;
}

export interface NormalizedTelescopeConfig {
  enabled: boolean;
  /** Path to user's telescope module (if provided) */
  telescopePath?: string;
  /** Import pattern for telescope (e.g., '{ telescope }' or 'telescope') */
  telescopeImportPattern?: string;
  /** UI path for telescope dashboard */
  path: string;
  ignore: string[];
  recordBody: boolean;
  maxEntries: number;
  websocket: boolean;
}

export interface NormalizedStudioConfig {
  enabled: boolean;
  /** Path to user's studio module (if provided) */
  studioPath?: string;
  /** Import pattern for studio (e.g., '{ studio }' or 'studio') */
  studioImportPattern?: string;
  /** UI path for studio dashboard */
  path: string;
  /** Database schema to introspect */
  schema: string;
}

export interface NormalizedHooksConfig {
  /** Path to server hooks module */
  serverHooksPath: string;
}

export interface NormalizedProductionConfig {
  enabled: boolean;
  bundle: boolean;
  minify: boolean;
  healthCheck: string;
  gracefulShutdown: boolean;
  external: string[];
  subscribers: 'include' | 'exclude';
  openapi: boolean;
  /**
   * Enable build-time optimized handler generation
   * When true, generates specialized handlers based on endpoint tier:
   * - minimal: Near-raw-Hono performance for simple endpoints
   * - standard: Optimized handlers for auth/services
   * - full: Uses HonoEndpoint.addRoutes for complex endpoints
   */
  optimizedHandlers: boolean;
}

export interface BuildContext {
  envParserPath: string;
  envParserImportPattern: string;
  loggerPath: string;
  loggerImportPattern: string;
  telescope?: NormalizedTelescopeConfig;
  studio?: NormalizedStudioConfig;
  hooks?: NormalizedHooksConfig;
  /** Production build configuration */
  production?: NormalizedProductionConfig;
}

export interface ProviderBuildResult {
  routes: RouteInfo[];
  functions: FunctionInfo[];
  crons: CronInfo[];
}
