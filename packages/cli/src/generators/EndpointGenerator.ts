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
      // Generate single server file with all endpoints
      const serverFile = await this.generateServerFile(
        outputDir,
        constructs,
        context,
        enableOpenApi,
      );

      routes.push({
        path: '*',
        method: 'ALL',
        handler: relative(process.cwd(), serverFile),
      });

      logger.log(
        `Generated server app with ${constructs.length} endpoints${enableOpenApi ? ' (OpenAPI enabled)' : ''}`,
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

  private async generateServerFile(
    outputDir: string,
    endpoints: GeneratedConstruct<Endpoint<any, any, any, any, any, any>>[],
    context: BuildContext,
    enableOpenApi: boolean,
  ): Promise<string> {
    const serverFileName = 'app.ts';
    const serverPath = join(outputDir, serverFileName);

    // Group imports by file
    const importsByFile = new Map<string, string[]>();

    for (const { path, key } of endpoints) {
      const relativePath = relative(dirname(serverPath), path.relative);
      const importPath = relativePath.replace(/\.ts$/, '.js');

      if (!importsByFile.has(importPath)) {
        importsByFile.set(importPath, []);
      }
      importsByFile.get(importPath)!.push(key);
    }

    const relativeEnvParserPath = relative(
      dirname(serverPath),
      context.envParserPath,
    );
    const relativeLoggerPath = relative(
      dirname(serverPath),
      context.loggerPath,
    );

    // Generate import statements
    const imports = Array.from(importsByFile.entries())
      .map(
        ([importPath, exports]) =>
          `import { ${exports.join(', ')} } from '${importPath}';`,
      )
      .join('\n');

    const allExportNames = endpoints.map(({ key }) => key);

    const content = `import { HonoEndpoint } from '@geekmidas/api/hono';
import { Endpoint } from '@geekmidas/api/server';
import { ServiceDiscovery } from '@geekmidas/api/services';
import { Hono } from 'hono';
import ${context.envParserImportPattern} from '${relativeEnvParserPath}';
import ${context.loggerImportPattern} from '${relativeLoggerPath}';
${imports}

export function createApp(app?: Hono, enableOpenApi: boolean = ${enableOpenApi}): Hono {
  const honoApp = app || new Hono();
  
  const endpoints: Endpoint<any, any, any, any, any, any, any>[] = [
    ${allExportNames.join(',\n    ')}
  ];

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

  HonoEndpoint.addRoutes(endpoints, serviceDiscovery, honoApp, openApiOptions);

  return honoApp;
}

// Default export for convenience
export default createApp;
`;

    await writeFile(serverPath, content);

    return serverPath;
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
