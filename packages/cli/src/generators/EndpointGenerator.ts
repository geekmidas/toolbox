import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { Endpoint } from '@geekmidas/constructs/endpoints';
import {
  analyzeEndpoint,
  type EndpointAnalysis,
  summarizeAnalysis,
} from '../build/endpoint-analyzer';
import {
  type EndpointImportInfo,
  generateEndpointFilesNested,
} from '../build/handler-templates';
import type { BuildContext } from '../build/types';
import type { LegacyProvider, RouteInfo } from '../types';
import {
  ConstructGenerator,
  type GeneratedConstruct,
  type GeneratorOptions,
} from './Generator';

export class EndpointGenerator extends ConstructGenerator<
  Endpoint<
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any
  >,
  RouteInfo[]
> {
  isConstruct(
    value: any,
  ): value is Endpoint<
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any
  > {
    return Endpoint.isEndpoint(value);
  }

  async build(
    context: BuildContext,
    constructs: GeneratedConstruct<
      Endpoint<
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any
      >
    >[],
    outputDir: string,
    options?: GeneratorOptions,
  ): Promise<RouteInfo[]> {
    const provider = options?.provider || 'aws-apigatewayv2';
    const enableOpenApi = options?.enableOpenApi || false;
    const logger = console;
    const routes: RouteInfo[] = [];

    if (constructs.length === 0) {
      return routes;
    }

    if (provider === 'server') {
      // Generate endpoints.ts and app.ts
      await this.generateEndpointsFile(outputDir, constructs, context);
      const appFile = await this.generateAppFile(outputDir, context);

      routes.push({
        path: '*',
        method: 'ALL',
        handler: relative(process.cwd(), appFile),
        authorizer: 'none',
      });

      logger.log(
        `Generated server with ${constructs.length} endpoints${enableOpenApi ? ' (OpenAPI enabled)' : ''}`,
      );
    } else if (provider === 'aws-lambda') {
      // For aws-lambda, create routes subdirectory
      const routesDir = join(outputDir, 'routes');
      await mkdir(routesDir, { recursive: true });

      // Generate individual handlers for API Gateway routes
      for (const { key, construct, path } of constructs) {
        const handlerFile = await this.generateHandlerFile(
          routesDir,
          path.relative,
          key,
          'aws-apigatewayv2',
          construct,
          context,
        );

        const routeInfo: RouteInfo = {
          path: construct._path,
          method: construct.method,
          handler: relative(process.cwd(), handlerFile).replace(
            /\.ts$/,
            '.handler',
          ),
          timeout: construct.timeout,
          memorySize: construct.memorySize,
          environment: await construct.getEnvironment(),
          authorizer: construct.authorizer?.name ?? 'none',
        };

        routes.push(routeInfo);
        logger.log(
          `Generated handler for ${routeInfo.method} ${routeInfo.path}`,
        );
      }
    } else {
      // Generate individual handler files for AWS API Gateway providers
      for (const { key, construct, path } of constructs) {
        const handlerFile = await this.generateHandlerFile(
          outputDir,
          path.relative,
          key,
          provider,
          construct,
          context,
        );

        const routeInfo: RouteInfo = {
          path: construct._path,
          method: construct.method,
          handler: relative(process.cwd(), handlerFile).replace(
            /\.ts$/,
            '.handler',
          ),
          timeout: construct.timeout,
          memorySize: construct.memorySize,
          environment: await construct.getEnvironment(),
          authorizer: construct.authorizer?.name ?? 'none',
        };

        routes.push(routeInfo);
        logger.log(
          `Generated handler for ${routeInfo.method} ${routeInfo.path}`,
        );
      }
    }

    return routes;
  }

  private async generateHandlerFile(
    outputDir: string,
    sourceFile: string,
    exportName: string,
    provider: LegacyProvider,
    _endpoint: Endpoint<
      any,
      any,
      any,
      any,
      any,
      any,
      any,
      any,
      any,
      any,
      any,
      any,
      any,
      any
    >,
    context: BuildContext,
  ): Promise<string> {
    const handlerFileName = `${exportName}.ts`;
    const handlerPath = join(outputDir, handlerFileName);

    const relativePath = relative(dirname(handlerPath), sourceFile);
    const importPath = relativePath.replace(/\.ts$/, '.js');

    const relativeEnvParserPath = relative(
      dirname(handlerPath),
      context.envParserPath,
    );

    let content: string;

    switch (provider) {
      case 'aws-apigatewayv1':
        content = this.generateAWSApiGatewayV1Handler(
          importPath,
          exportName,
          relativeEnvParserPath,
          context.envParserImportPattern,
        );
        break;
      case 'aws-apigatewayv2':
        content = this.generateAWSApiGatewayV2Handler(
          importPath,
          exportName,
          relativeEnvParserPath,
          context.envParserImportPattern,
        );
        break;
      case 'server':
        content = this.generateServerHandler(importPath, exportName);
        break;
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }

    await writeFile(handlerPath, content);
    return handlerPath;
  }

  private async generateEndpointsFile(
    outputDir: string,
    endpoints: GeneratedConstruct<
      Endpoint<
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any
      >
    >[],
    context: BuildContext,
  ): Promise<string> {
    const endpointsFileName = 'endpoints.ts';
    const endpointsPath = join(outputDir, endpointsFileName);

    // Group imports by file
    const importsByFile = new Map<string, string[]>();

    for (const { path, key } of endpoints) {
      const relativePath = relative(dirname(endpointsPath), path.relative);
      const importPath = relativePath.replace(/\.ts$/, '.js');

      if (!importsByFile.has(importPath)) {
        importsByFile.set(importPath, []);
      }
      importsByFile.get(importPath)!.push(key);
    }

    // Generate import statements for endpoints
    const endpointImports = Array.from(importsByFile.entries())
      .map(
        ([importPath, exports]) =>
          `import { ${exports.join(', ')} } from '${importPath}';`,
      )
      .join('\n');

    const allExportNames = endpoints.map(({ key }) => key);

    // Check if we should use optimized handler generation
    if (context.production?.enabled && context.production.optimizedHandlers) {
      return this.generateOptimizedEndpointsFile(
        endpointsPath,
        endpoints,
        endpointImports,
        allExportNames,
      );
    }

    // Standard generation (development or optimizedHandlers: false)
    const content = `import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { HonoEndpoint } from '@geekmidas/constructs/hono';
import { Endpoint } from '@geekmidas/constructs/endpoints';
import { ServiceDiscovery } from '@geekmidas/services';
import type { Hono } from 'hono';
${endpointImports}

const endpoints: Endpoint<any, any, any, any, any, any, any, any, any, any, any, any, any, any>[] = [
  ${allExportNames.join(',\n  ')}
];

export async function setupEndpoints(
  app: Hono,
  envParser: EnvironmentParser<any>,
  logger: Logger,
  enableOpenApi: boolean = true,
): Promise<void> {
  const serviceDiscovery = ServiceDiscovery.getInstance(
    logger,
    envParser
  );

  // Configure OpenAPI options based on enableOpenApi flag
  const openApiOptions: any = enableOpenApi ? {
    docsPath: '/__docs',
    openApiOptions: {
      title: 'API Documentation',
      version: '1.0.0',
      description: 'Generated API documentation'
    }
  } : { docsPath: false };

  HonoEndpoint.addRoutes(endpoints, serviceDiscovery, app, openApiOptions);

  // Add Swagger UI if OpenAPI is enabled
  if (enableOpenApi) {
    try {
      const { swaggerUI } = await import('@hono/swagger-ui');
      app.get('/__docs/ui', swaggerUI({ url: '/__docs' }));
    } catch {
      // @hono/swagger-ui not installed, skip Swagger UI
    }
  }
}
`;

    await writeFile(endpointsPath, content);

    return endpointsPath;
  }

  /**
   * Generate optimized endpoints files with nested folder structure (per-endpoint files)
   */
  private async generateOptimizedEndpointsFile(
    endpointsPath: string,
    endpoints: GeneratedConstruct<
      Endpoint<
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any
      >
    >[],
    _endpointImports: string,
    _allExportNames: string[],
  ): Promise<string> {
    const logger = console;
    const outputDir = dirname(endpointsPath);

    // Create endpoints subdirectory with tier folders
    const endpointsDir = join(outputDir, 'endpoints');
    await mkdir(join(endpointsDir, 'minimal'), { recursive: true });
    await mkdir(join(endpointsDir, 'standard'), { recursive: true });
    await mkdir(join(endpointsDir, 'full'), { recursive: true });

    // Analyze each endpoint
    const analyses: EndpointAnalysis[] = endpoints.map(({ key, construct }) =>
      analyzeEndpoint(construct, key),
    );

    // Build endpoint import info with correct relative paths from each tier folder
    // Use paths relative to the tier folder (e.g., endpoints/standard/)
    const endpointImports: EndpointImportInfo[] = endpoints.map(
      ({ key, path }) => {
        // Calculate relative path from tier folder (one level deeper than endpointsDir)
        const tierDir = join(endpointsDir, 'standard'); // Use any tier as reference - same depth
        const relativePath = relative(tierDir, path.relative);
        const importPath = relativePath.replace(/\.ts$/, '.js');
        return { exportName: key, importPath };
      },
    );

    // Log analysis summary
    const summary = summarizeAnalysis(analyses);
    logger.log(`\n📊 Endpoint Analysis:`);
    logger.log(`   Total: ${summary.total} endpoints`);
    logger.log(
      `   - Minimal (near-raw-Hono): ${summary.byTier.minimal} endpoints`,
    );
    logger.log(
      `   - Standard (auth/services): ${summary.byTier.standard} endpoints`,
    );
    logger.log(
      `   - Full (audits/rls/rate-limit): ${summary.byTier.full} endpoints`,
    );

    // Generate files with nested structure (per-endpoint files)
    const files = generateEndpointFilesNested(analyses, endpointImports);

    // Write each file, creating directories as needed
    for (const [filename, content] of Object.entries(files)) {
      const filePath = join(endpointsDir, filename);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }

    // Count files by type
    const endpointFiles = Object.keys(files).filter(
      (f) => !f.endsWith('index.ts') && !f.endsWith('validators.ts'),
    ).length;
    const indexFiles = Object.keys(files).filter((f) =>
      f.endsWith('index.ts'),
    ).length;

    logger.log(
      `   Generated ${endpointFiles} endpoint files + ${indexFiles} index files + validators.ts`,
    );

    // Return path to index file
    return join(endpointsDir, 'index.ts');
  }

  private async generateAppFile(
    outputDir: string,
    context: BuildContext,
  ): Promise<string> {
    // Use production generator if in production mode
    if (context.production?.enabled) {
      return this.generateProductionAppFile(outputDir, context);
    }

    const appFileName = 'app.ts';
    const appPath = join(outputDir, appFileName);

    const relativeLoggerPath = relative(dirname(appPath), context.loggerPath);

    const relativeEnvParserPath = relative(
      dirname(appPath),
      context.envParserPath,
    );

    // Generate telescope imports and setup if enabled
    const telescopeEnabled = context.telescope?.enabled;
    const telescopeWebSocketEnabled = context.telescope?.websocket;
    const usesExternalTelescope = !!context.telescope?.telescopePath;

    // Generate studio imports and setup if enabled
    const studioEnabled = context.studio?.enabled;
    const usesExternalStudio = !!context.studio?.studioPath;

    // Generate imports based on whether telescope is external or inline
    let telescopeImports = '';
    if (telescopeEnabled) {
      if (usesExternalTelescope) {
        const relativeTelescopePath = relative(
          dirname(appPath),
          context.telescope!.telescopePath!,
        );
        telescopeImports = `import ${context.telescope!.telescopeImportPattern} from '${relativeTelescopePath}';
import { createMiddleware, createUI } from '@geekmidas/telescope/hono';`;
      } else {
        telescopeImports = `import { Telescope, InMemoryStorage } from '@geekmidas/telescope';
import { createMiddleware, createUI } from '@geekmidas/telescope/hono';`;
      }
    }

    // Generate imports for studio
    let studioImports = '';
    if (studioEnabled) {
      if (usesExternalStudio) {
        const relativeStudioPath = relative(
          dirname(appPath),
          context.studio!.studioPath!,
        );
        studioImports = `import ${context.studio!.studioImportPattern} from '${relativeStudioPath}';
import { createStudioApp } from '@geekmidas/studio/server/hono';`;
      } else {
        studioImports = `// Studio requires a configured instance - use studio config path
// import { createStudioApp } from '@geekmidas/studio/server/hono';`;
      }
    }

    // Generate imports for server hooks
    let hooksImports = '';
    let beforeSetupCall = '';
    let afterSetupCall = '';
    if (context.hooks?.serverHooksPath) {
      const relativeHooksPath = relative(
        dirname(appPath),
        context.hooks.serverHooksPath,
      );
      hooksImports = `import * as serverHooks from '${relativeHooksPath}';`;
      beforeSetupCall = `
  // Call beforeSetup hook if defined
  if (typeof serverHooks.beforeSetup === 'function') {
    await serverHooks.beforeSetup(honoApp, { envParser, logger });
  }
`;
      afterSetupCall = `
  // Call afterSetup hook if defined
  if (typeof serverHooks.afterSetup === 'function') {
    await serverHooks.afterSetup(honoApp, { envParser, logger });
  }
`;
    }

    const telescopeWebSocketSetupCode = telescopeWebSocketEnabled
      ? `
  // Setup WebSocket for real-time telescope updates
  try {
    const { createNodeWebSocket } = await import('@hono/node-ws');
    const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app: honoApp });
    // Add WebSocket route directly to main app (sub-app routes don't support WS upgrade)
    honoApp.get('${context.telescope!.path}/ws', upgradeWebSocket(() => ({
      onOpen: (_event: Event, ws: any) => {
        telescope.addWsClient(ws);
      },
      onClose: (_event: Event, ws: any) => {
        telescope.removeWsClient(ws);
      },
      onMessage: (event: MessageEvent, ws: any) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        } catch {
          // Ignore invalid messages
        }
      },
    })));
    // Store injectWebSocket for server entry to call after serve()
    (honoApp as any).__injectWebSocket = injectWebSocket;
    logger.info('Telescope WebSocket enabled');
  } catch (e) {
    logger.warn({ error: e }, 'WebSocket support not available - install @hono/node-ws for real-time updates');
  }
`
      : '';

    // Generate telescope setup - either use external instance or create inline
    let telescopeSetup = '';
    if (telescopeEnabled) {
      if (usesExternalTelescope) {
        // Use external telescope instance - no need to create one
        telescopeSetup = `
${telescopeWebSocketSetupCode}
  // Add telescope middleware (before endpoints to capture all requests)
  honoApp.use('*', createMiddleware(telescope));

  // Mount telescope UI
  const telescopeUI = createUI(telescope);
  honoApp.route('${context.telescope!.path}', telescopeUI);
`;
      } else {
        // Create inline telescope instance
        telescopeSetup = `
  // Setup Telescope for debugging/monitoring
  const telescopeStorage = new InMemoryStorage({ maxEntries: ${context.telescope!.maxEntries} });
  const telescope = new Telescope({
    enabled: true,
    path: '${context.telescope!.path}',
    ignorePatterns: ${JSON.stringify(context.telescope!.ignore)},
    recordBody: ${context.telescope!.recordBody},
    storage: telescopeStorage,
  });
${telescopeWebSocketSetupCode}
  // Add telescope middleware (before endpoints to capture all requests)
  honoApp.use('*', createMiddleware(telescope));

  // Mount telescope UI
  const telescopeUI = createUI(telescope);
  honoApp.route('${context.telescope!.path}', telescopeUI);
`;
      }
    }

    // Generate studio setup - requires external instance
    let studioSetup = '';
    if (studioEnabled && usesExternalStudio) {
      studioSetup = `
  // Mount Studio data browser UI
  const studioApp = createStudioApp(studio);
  honoApp.route('${context.studio!.path}', studioApp);
`;
    }

    const content = `/**
 * Generated server application
 *
 * ⚠️  WARNING: This is for LOCAL DEVELOPMENT ONLY
 * The subscriber polling mechanism is not production-ready.
 * For production, use AWS Lambda with SQS/SNS event sources.
 */
import { Hono } from 'hono';
import type { Hono as HonoType } from 'hono';
import { setupEndpoints } from './endpoints.js';
import { setupSubscribers } from './subscribers.js';
import ${context.envParserImportPattern} from '${relativeEnvParserPath}';
import ${context.loggerImportPattern} from '${relativeLoggerPath}';
${telescopeImports}
${studioImports}
${hooksImports}

export interface ServerApp {
  app: HonoType;
  start: (options?: {
    port?: number;
    serve: (app: HonoType, port: number) => void | Promise<void>;
  }) => Promise<void>;
}

/**
 * Create and configure the Hono application
 *
 * @param app - Optional Hono app instance to configure (creates new one if not provided)
 * @param enableOpenApi - Enable OpenAPI documentation (default: true)
 * @returns Server app with configured Hono app and start function
 *
 * @example
 * // With Bun
 * import { createApp } from './.gkm/server/app.js';
 *
 * const { app, start } = await createApp();
 *
 * await start({
 *   port: 3000,
 *   serve: (app, port) => {
 *     Bun.serve({ port, fetch: app.fetch });
 *   }
 * });
 *
 * @example
 * // With Node.js (using @hono/node-server)
 * import { serve } from '@hono/node-server';
 * import { createApp } from './.gkm/server/app.js';
 *
 * const { app, start } = await createApp();
 *
 * await start({
 *   port: 3000,
 *   serve: (app, port) => {
 *     serve({ fetch: app.fetch, port });
 *   }
 * });
 */
export async function createApp(app?: HonoType, enableOpenApi: boolean = true): Promise<ServerApp> {
  const honoApp = app || new Hono();
${telescopeSetup}${beforeSetupCall}${studioSetup}
  // Setup HTTP endpoints
  await setupEndpoints(honoApp, envParser, logger, enableOpenApi);
${afterSetupCall}

  return {
    app: honoApp,
    async start(options) {
      if (!options?.serve) {
        throw new Error(
          'serve function is required. Pass a serve function for your runtime:\\n' +
          '  - Bun: (app, port) => Bun.serve({ port, fetch: app.fetch })\\n' +
          '  - Node: (app, port) => serve({ fetch: app.fetch, port })'
        );
      }

      const port = options.port ?? 3000;

      // Start subscribers in background (non-blocking, local development only)
      await setupSubscribers(envParser, logger).catch((error) => {
        logger.error({ error }, 'Failed to start subscribers');
      });

      logger.info({ port }, 'Starting server');

      // Start HTTP server using provided serve function
      await options.serve(honoApp, port);

      logger.info({ port }, 'Server started');
    }
  };
}

// Default export for convenience
export default createApp;
`;

    await writeFile(appPath, content);

    return appPath;
  }

  private generateAWSApiGatewayV1Handler(
    importPath: string,
    exportName: string,
    envParserPath: string,
    envParserImportPattern: string,
  ): string {
    return `import { AmazonApiGatewayV1Endpoint } from '@geekmidas/constructs/aws';
import { ${exportName} } from '${importPath}';
import ${envParserImportPattern} from '${envParserPath}';

const adapter = new AmazonApiGatewayV1Endpoint(envParser, ${exportName});

export const handler = adapter.handler;
`;
  }

  private generateAWSApiGatewayV2Handler(
    importPath: string,
    exportName: string,
    envParserPath: string,
    envParserImportPattern: string,
  ): string {
    return `import { AmazonApiGatewayV2Endpoint } from '@geekmidas/constructs/aws';
import { ${exportName} } from '${importPath}';
import ${envParserImportPattern} from '${envParserPath}';

const adapter = new AmazonApiGatewayV2Endpoint(envParser, ${exportName});

export const handler = adapter.handler;
`;
  }

  private generateServerHandler(
    importPath: string,
    exportName: string,
  ): string {
    return `import { ${exportName} } from '${importPath}';

// Server handler - implement based on your server framework
export const handler = ${exportName};
`;
  }

  /**
   * Generate a production-optimized app.ts file
   * No dev tools (Telescope, Studio, WebSocket), includes health checks and graceful shutdown
   */
  private async generateProductionAppFile(
    outputDir: string,
    context: BuildContext,
  ): Promise<string> {
    const appFileName = 'app.ts';
    const appPath = join(outputDir, appFileName);

    const relativeLoggerPath = relative(dirname(appPath), context.loggerPath);
    const relativeEnvParserPath = relative(
      dirname(appPath),
      context.envParserPath,
    );

    const production = context.production!;
    const healthCheckPath = production.healthCheck;
    const enableGracefulShutdown = production.gracefulShutdown;
    const enableOpenApi = production.openapi;
    const includeSubscribers = production.subscribers === 'include';

    // Generate imports for server hooks
    let hooksImports = '';
    let beforeSetupCall = '';
    let afterSetupCall = '';
    if (context.hooks?.serverHooksPath) {
      const relativeHooksPath = relative(
        dirname(appPath),
        context.hooks.serverHooksPath,
      );
      hooksImports = `import * as serverHooks from '${relativeHooksPath}';`;
      beforeSetupCall = `
  // Call beforeSetup hook if defined
  if (typeof serverHooks.beforeSetup === 'function') {
    await serverHooks.beforeSetup(honoApp, { envParser, logger });
  }
`;
      afterSetupCall = `
  // Call afterSetup hook if defined
  if (typeof serverHooks.afterSetup === 'function') {
    await serverHooks.afterSetup(honoApp, { envParser, logger });
  }
`;
    }

    // Subscriber setup code
    const subscriberSetup = includeSubscribers
      ? `
      // Start subscribers in background
      await setupSubscribers(envParser, logger).catch((error) => {
        logger.error({ error }, 'Failed to start subscribers');
      });
`
      : '';

    const subscriberImport = includeSubscribers
      ? `import { setupSubscribers } from './subscribers.js';`
      : '';

    // Graceful shutdown code
    const gracefulShutdownCode = enableGracefulShutdown
      ? `
  // Graceful shutdown handling
  let isShuttingDown = false;

  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info('Graceful shutdown initiated');
    // Allow in-flight requests to complete (30s timeout)
    setTimeout(() => process.exit(0), 30000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
`
      : '';

    // Use endpoints/index.js for optimized builds, endpoints.js otherwise
    const endpointsImportPath = production.optimizedHandlers
      ? './endpoints/index.js'
      : './endpoints.js';

    const content = `/**
 * Generated production server application
 *
 * This is a production-optimized build without dev tools.
 * - No Telescope debugging dashboard
 * - No Studio database browser
 * - No WebSocket updates
 * - Includes health checks and graceful shutdown
 */
import { Hono } from 'hono';
import type { Hono as HonoType } from 'hono';
import { setupEndpoints } from '${endpointsImportPath}';
${subscriberImport}
import ${context.envParserImportPattern} from '${relativeEnvParserPath}';
import ${context.loggerImportPattern} from '${relativeLoggerPath}';
${hooksImports}

export interface ServerApp {
  app: HonoType;
  start: (options?: {
    port?: number;
    serve: (app: HonoType, port: number) => void | Promise<void>;
  }) => Promise<void>;
}

/**
 * Create and configure the production Hono application
 */
export async function createApp(app?: HonoType): Promise<ServerApp> {
  const honoApp = app || new Hono();

  // Health check endpoint (always first)
  honoApp.get('${healthCheckPath}', (c) => c.json({ status: 'ok', timestamp: Date.now() }));
  honoApp.get('/ready', (c) => c.json({ ready: true }));
${beforeSetupCall}
  // Setup HTTP endpoints (OpenAPI: ${enableOpenApi})
  await setupEndpoints(honoApp, envParser, logger, ${enableOpenApi});
${afterSetupCall}
  return {
    app: honoApp,
    async start(options) {
      if (!options?.serve) {
        throw new Error(
          'serve function is required. Pass a serve function for your runtime:\\n' +
          '  - Bun: (app, port) => Bun.serve({ port, fetch: app.fetch })\\n' +
          '  - Node: (app, port) => serve({ fetch: app.fetch, port })'
        );
      }

      const port = options.port ?? Number(process.env.PORT) ?? 3000;
${gracefulShutdownCode}${subscriberSetup}
      logger.info({ port }, 'Starting production server');

      // Start HTTP server using provided serve function
      await options.serve(honoApp, port);

      logger.info({ port }, 'Production server started');
    }
  };
}

// Default export for convenience
export default createApp;
`;

    await writeFile(appPath, content);

    // Also generate the production server entry point
    await this.generateProductionServerEntry(outputDir);

    return appPath;
  }

  /**
   * Generate production server.ts entry point
   */
  private async generateProductionServerEntry(
    outputDir: string,
  ): Promise<void> {
    const serverPath = join(outputDir, 'server.ts');

    const content = `#!/usr/bin/env node
/**
 * Production server entry point
 * Generated by 'gkm build --provider server --production'
 */
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;

const { app, start } = await createApp();

await start({
  port,
  serve: (app, port) => serve({ fetch: app.fetch, port }),
});
`;

    await writeFile(serverPath, content);
  }
}
