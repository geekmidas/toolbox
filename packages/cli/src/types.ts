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
  environment?: string[];
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

export interface BuildManifest {
  routes: RouteInfo[];
  functions: FunctionInfo[];
  crons: CronInfo[];
  subscribers: SubscriberInfo[];
}
