import type { Cron, Function } from '@geekmidas/constructs';
import type { Endpoint } from '@geekmidas/constructs';

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

export interface BuildContext {
  envParserPath: string;
  envParserImportPattern: string;
  loggerPath: string;
  loggerImportPattern: string;
}

export interface ProviderBuildResult {
  routes: RouteInfo[];
  functions: FunctionInfo[];
  crons: CronInfo[];
}
