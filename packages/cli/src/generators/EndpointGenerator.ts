import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { Endpoint } from '@geekmidas/api/server';
import type { BuildContext } from '../build/types';
import type { LegacyProvider, RouteInfo } from '../types';
import {
  ConstructGenerator,
  type GeneratedConstruct,
  type GeneratorOptions,
} from './Generator';

export class EndpointGenerator extends ConstructGenerator<
  Endpoint<any, any, any, any, any, any>,
  RouteInfo[]
> {
  isConstruct(value: any): value is Endpoint<any, any, any, any, any, any> {
    return Endpoint.isEndpoint(value);
  }

  async build(
    context: BuildContext,
    constructs: GeneratedConstruct<Endpoint<any, any, any, any, any, any>>[],
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
    _endpoint: Endpoint<any, any, any, any, any, any>,
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
    endpoints: GeneratedConstruct<Endpoint<any, any, any, any, any, any>>[],
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

    // Generate import statements
    const imports = Array.from(importsByFile.entries())
      .map(
        ([importPath, exports]) =>
          `import { ${exports.join(', ')} } from '${importPath}';`,
      )
      .join('\n');

    const allExportNames = endpoints.map(({ key }) => key);

    const content = `import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { HonoEndpoint } from '@geekmidas/api/hono';
import { Endpoint } from '@geekmidas/api/server';
import { ServiceDiscovery } from '@geekmidas/api/services';
import type { Hono } from 'hono';
${imports}

const endpoints: Endpoint<any, any, any, any, any, any, any>[] = [
  ${allExportNames.join(',\n  ')}
];

export function setupEndpoints(
  app: Hono,
  envParser: EnvironmentParser<any>,
  logger: Logger,
  enableOpenApi: boolean = true,
): void {
  const serviceDiscovery = ServiceDiscovery.getInstance(
    logger,
    envParser
  );

  // Configure OpenAPI options based on enableOpenApi flag
  const openApiOptions: any = enableOpenApi ? {
    docsPath: '/docs',
    openApiOptions: {
      title: 'API Documentation',
      version: '1.0.0',
      description: 'Generated API documentation'
    }
  } : { docsPath: false };

  HonoEndpoint.addRoutes(endpoints, serviceDiscovery, app, openApiOptions);
}
`;

    await writeFile(endpointsPath, content);

    return endpointsPath;
  }

  private async generateAppFile(
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
 * const { app, start } = createApp();
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
 * const { app, start } = createApp();
 *
 * await start({
 *   port: 3000,
 *   serve: (app, port) => {
 *     serve({ fetch: app.fetch, port });
 *   }
 * });
 */
export function createApp(app?: HonoType, enableOpenApi: boolean = true): ServerApp {
  const honoApp = app || new Hono();

  // Setup HTTP endpoints
  setupEndpoints(honoApp, envParser, logger, enableOpenApi);

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
    return `import { AmazonApiGatewayV1Endpoint } from '@geekmidas/api/aws-apigateway';
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
    return `import { AmazonApiGatewayV2Endpoint } from '@geekmidas/api/aws-apigateway';
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
}
