export type MainProvider = 'aws' | 'server';
export type LegacyProvider =
  | 'server'
  | 'aws-apigatewayv1'
  | 'aws-apigatewayv2'
  | 'aws-lambda';

export type Routes = string | string[];

export interface ProviderConfig {
  enabled?: boolean;
  outputDir?: string;
}

export interface AWSApiGatewayConfig extends ProviderConfig {
  // Additional AWS API Gateway specific options
}

export interface AWSLambdaConfig extends ProviderConfig {
  // Additional AWS Lambda specific options
}

export interface ServerConfig extends ProviderConfig {
  enableOpenApi?: boolean;
  port?: number;
}

export interface TelescopeConfig {
  /** Enable/disable telescope (default: true in development) */
  enabled?: boolean;
  /** Port for telescope to use (defaults to server port) */
  port?: number;
  /** Path prefix for telescope UI (default: /__telescope) */
  path?: string;
  /** Ignore patterns for telescope (e.g., ['/health', '/metrics']) */
  ignore?: string[];
  /** Record request/response bodies (default: true) */
  recordBody?: boolean;
  /** Maximum entries to keep in memory (default: 1000) */
  maxEntries?: number;
}

export interface ProvidersConfig {
  aws?: {
    apiGateway?: {
      v1?: boolean | AWSApiGatewayConfig;
      v2?: boolean | AWSApiGatewayConfig;
    };
    lambda?: {
      functions?: boolean | AWSLambdaConfig;
      crons?: boolean | AWSLambdaConfig;
    };
  };
  server?: boolean | ServerConfig;
}

export interface GkmConfig {
  routes: Routes;
  functions?: Routes;
  crons?: Routes;
  subscribers?: Routes;
  envParser: string;
  logger: string;
  providers?: ProvidersConfig;
  /** Telescope configuration for debugging/monitoring */
  telescope?: boolean | TelescopeConfig;
}

export interface BuildOptions {
  provider?: MainProvider;
  // Legacy support - will be deprecated
  providers?: LegacyProvider[];
  enableOpenApi?: boolean;
}

export interface RouteInfo {
  path: string;
  method: string;
  handler: string;
  timeout?: number;
  memorySize?: number;
  environment?: string[];
  authorizer: string;
}

export interface FunctionInfo {
  name: string;
  handler: string;
  timeout?: number;
  memorySize?: number;
  environment?: string[];
}

export interface CronInfo {
  name: string;
  handler: string;
  schedule: string;
  timeout?: number;
  memorySize?: number;
  environment?: string[];
}

export interface SubscriberInfo {
  name: string;
  handler: string;
  subscribedEvents: string[];
  timeout?: number;
  memorySize?: number;
  environment?: string[];
}

export interface RoutesManifest {
  routes: RouteInfo[];
}

export interface FunctionsManifest {
  functions: FunctionInfo[];
}

export interface CronsManifest {
  crons: CronInfo[];
}

export interface SubscribersManifest {
  subscribers: SubscriberInfo[];
}
