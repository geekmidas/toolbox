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

export type Runtime = 'node' | 'bun';

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
  /** Enable WebSocket for real-time updates (default: true, requires @hono/node-ws for Node.js) */
  websocket?: boolean;
}

export interface OpenApiConfig {
  /** Enable OpenAPI generation (default: true) */
  enabled?: boolean;
  /** API title */
  title?: string;
  /** API version */
  version?: string;
  /** API description */
  description?: string;
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
  /**
   * Telescope configuration for debugging/monitoring.
   * Can be:
   * - A string path to a module that exports a Telescope instance (recommended)
   * - A boolean to enable/disable with defaults
   * - A TelescopeConfig object for inline configuration
   */
  telescope?: string | boolean | TelescopeConfig;
  /**
   * OpenAPI generation configuration.
   * Can be:
   * - A boolean to enable/disable with defaults (output: ./src/api/openapi.ts)
   * - An OpenApiConfig object for customization
   *
   * When enabled, OpenAPI spec is generated on startup and regenerated on route changes.
   *
   * @example
   * openapi: true
   *
   * @example
   * openapi: {
   *   output: './src/api/openapi.ts',
   *   title: 'My API',
   *   version: '1.0.0',
   * }
   */
  openapi?: boolean | OpenApiConfig;
  /** Runtime to use for dev server (default: 'node') */
  runtime?: Runtime;
  /**
   * Environment file(s) to load for development.
   * Can be:
   * - A string path to a single env file (e.g., '.env.local')
   * - An array of paths to load in order (later files override earlier)
   * - Defaults to '.env' if not specified
   *
   * @example
   * env: '.env.local'
   *
   * @example
   * env: ['.env', '.env.local']
   */
  env?: string | string[];
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
