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

export interface ProductionConfig {
  /** Enable production mode (default: false) */
  enabled?: boolean;
  /** Bundle server into single file (default: true) */
  bundle?: boolean;
  /** Minify bundled output (default: true) */
  minify?: boolean;
  /** Health check endpoint path (default: '/health') */
  healthCheck?: string;
  /** Enable graceful shutdown handling (default: true) */
  gracefulShutdown?: boolean;
  /** Packages to exclude from bundling (default: []) */
  external?: string[];
  /** Include subscribers in production build (default: 'exclude' for serverless) */
  subscribers?: 'include' | 'exclude';
  /** Include OpenAPI spec in production (default: false) */
  openapi?: boolean;
  /**
   * Enable build-time optimized handler generation (default: true)
   * Generates specialized handlers based on endpoint tier:
   * - minimal: Near-raw-Hono performance for simple endpoints
   * - standard: Optimized handlers for auth/services
   * - full: Uses HonoEndpoint.addRoutes for complex endpoints
   */
  optimizedHandlers?: boolean;
}

export interface DockerConfig {
  /** Container registry URL (e.g., 'ghcr.io/myorg') */
  registry?: string;
  /** Docker image name (default: derived from package.json name) */
  imageName?: string;
  /** Base Docker image (default: 'node:22-alpine') */
  baseImage?: string;
  /** Container port (default: 3000) */
  port?: number;
  /** docker-compose services to include */
  compose?: {
    /** Additional services like postgres, redis */
    services?: ('postgres' | 'redis' | 'rabbitmq')[];
  };
}

export interface ServerConfig extends ProviderConfig {
  enableOpenApi?: boolean;
  port?: number;
  /** Production build configuration */
  production?: ProductionConfig;
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

export interface StudioConfig {
  /** Enable/disable studio (default: true in development) */
  enabled?: boolean;
  /** Path prefix for studio UI (default: /__studio) */
  path?: string;
  /** Schema to introspect (default: 'public') */
  schema?: string;
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

export interface HooksConfig {
  /**
   * Path to a module exporting server lifecycle hooks.
   * The module should export `beforeSetup` and/or `afterSetup` functions.
   *
   * @example
   * ```typescript
   * // src/config/hooks.ts
   * import type { Hono } from 'hono';
   * import type { Logger } from '@geekmidas/logger';
   * import type { EnvironmentParser } from '@geekmidas/envkit';
   *
   * // Called BEFORE gkm endpoints are registered
   * export function beforeSetup(app: Hono, ctx: { envParser: EnvironmentParser; logger: Logger }) {
   *   app.use('*', cors());
   *   app.get('/custom/health', (c) => c.json({ status: 'ok' }));
   * }
   *
   * // Called AFTER gkm endpoints are registered
   * export function afterSetup(app: Hono, ctx: { envParser: EnvironmentParser; logger: Logger }) {
   *   app.notFound((c) => c.json({ error: 'Not found' }, 404));
   *   app.onError((err, c) => c.json({ error: err.message }, 500));
   * }
   * ```
   */
  server?: string;
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
   * Server lifecycle hooks for customizing the Hono app.
   * Allows adding custom routes, middleware, error handlers, etc.
   *
   * @example
   * hooks: {
   *   server: './src/config/hooks'
   * }
   */
  hooks?: HooksConfig;
  /**
   * Telescope configuration for debugging/monitoring.
   * Can be:
   * - A string path to a module that exports a Telescope instance (recommended)
   * - A boolean to enable/disable with defaults
   * - A TelescopeConfig object for inline configuration
   */
  telescope?: string | boolean | TelescopeConfig;
  /**
   * Studio configuration for database browsing.
   * Can be:
   * - A string path to a module that exports a Studio instance (recommended)
   * - A boolean to enable/disable with defaults
   * - A StudioConfig object for inline configuration
   *
   * Requires a database connection configured via services.
   */
  studio?: string | boolean | StudioConfig;
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
  /**
   * Docker deployment configuration.
   * Used by `gkm docker` and `gkm prepack` commands.
   *
   * @example
   * docker: {
   *   registry: 'ghcr.io/myorg',
   *   imageName: 'my-api',
   *   compose: {
   *     services: ['postgres', 'redis']
   *   }
   * }
   */
  docker?: DockerConfig;
}

export interface BuildOptions {
  provider?: MainProvider;
  // Legacy support - will be deprecated
  providers?: LegacyProvider[];
  enableOpenApi?: boolean;
  /** Build for production (no dev tools, bundled output) */
  production?: boolean;
  /** Skip bundling step in production build */
  skipBundle?: boolean;
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
