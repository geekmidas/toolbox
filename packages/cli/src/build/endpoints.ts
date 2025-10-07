import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'path';
import { loadEndpoints } from '../loadEndpoints';
import type { LegacyProvider, RouteInfo } from '../types';
import type { BuildContext, ProcessedEndpoint } from './types';

const logger = console;

export async function buildEndpoints(
  provider: LegacyProvider,
  outputDir: string,
  endpoints: ProcessedEndpoint[],
  context: BuildContext,
  enableOpenApi: boolean,
): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];

  if (endpoints.length === 0) {
    return routes;
  }

  if (provider === 'server') {
    // Generate single server file with all endpoints
    const serverFile = await generateServerFile(
      outputDir,
      endpoints,
      context.envParserPath,
      context.envParserImportPattern,
      context.loggerPath,
      context.loggerImportPattern,
      enableOpenApi,
    );

    routes.push({
      path: '*',
      method: 'ALL',
      handler: relative(process.cwd(), serverFile),
    });

    logger.log(
      `Generated server app with ${endpoints.length} endpoints${enableOpenApi ? ' (OpenAPI enabled)' : ''}`,
    );
  } else if (provider === 'aws-lambda') {
    // For aws-lambda, create routes subdirectory
    const routesDir = join(outputDir, 'routes');
    await mkdir(routesDir, { recursive: true });

    // Generate individual handlers for API Gateway routes
    for (const { file, exportName, routeInfo } of endpoints) {
      const handlerFile = await generateHandlerFile(
        routesDir,
        file,
        exportName,
        'aws-apigatewayv2',
        routeInfo,
        context.envParserPath,
        context.envParserImportPattern,
      );

      routes.push({
        ...routeInfo,
        handler: relative(process.cwd(), handlerFile).replace(
          /\.ts$/,
          '.handler',
        ),
      });

      logger.log(`Generated handler for ${routeInfo.method} ${routeInfo.path}`);
    }
  } else {
    // Generate individual handler files for AWS API Gateway providers
    for (const { file, exportName, routeInfo } of endpoints) {
      const handlerFile = await generateHandlerFile(
        outputDir,
        file,
        exportName,
        provider,
        routeInfo,
        context.envParserPath,
        context.envParserImportPattern,
      );

      routes.push({
        ...routeInfo,
        handler: relative(process.cwd(), handlerFile).replace(
          /\.ts$/,
          '.handler',
        ),
      });

      logger.log(`Generated handler for ${routeInfo.method} ${routeInfo.path}`);
    }
  }

  return routes;
}

export async function processEndpoints(
  routePatterns: string | string[],
): Promise<ProcessedEndpoint[]> {
  const loadedEndpoints = await loadEndpoints(routePatterns);

  return loadedEndpoints.map(({ name, endpoint, file }) => {
    const routeInfo: RouteInfo = {
      path: endpoint._path,
      method: endpoint.method,
      handler: '', // Will be filled in later
    };

    logger.log(
      `Found endpoint: ${name} - ${routeInfo.method} ${routeInfo.path}`,
    );

    return {
      file: relative(process.cwd(), file),
      exportName: name,
      endpoint,
      routeInfo,
    };
  });
}

// Generator functions for endpoints

function generateAWSApiGatewayV1Handler(
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

function generateAWSApiGatewayV2Handler(
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

function generateServerHandler(importPath: string, exportName: string): string {
  return `import { ${exportName} } from '${importPath}';

// Server handler - implement based on your server framework
export const handler = ${exportName};
`;
}

async function generateHandlerFile(
  outputDir: string,
  sourceFile: string,
  exportName: string,
  provider: LegacyProvider,
  _routeInfo: RouteInfo,
  envParserPath: string,
  envParserImportPattern: string,
): Promise<string> {
  const handlerFileName = `${exportName}.ts`;
  const handlerPath = join(outputDir, handlerFileName);

  const relativePath = relative(dirname(handlerPath), sourceFile);
  const importPath = relativePath.replace(/\.ts$/, '.js');

  const relativeEnvParserPath = relative(dirname(handlerPath), envParserPath);

  let content: string;

  switch (provider) {
    case 'aws-apigatewayv1':
      content = generateAWSApiGatewayV1Handler(
        importPath,
        exportName,
        relativeEnvParserPath,
        envParserImportPattern,
      );
      break;
    case 'aws-apigatewayv2':
      content = generateAWSApiGatewayV2Handler(
        importPath,
        exportName,
        relativeEnvParserPath,
        envParserImportPattern,
      );
      break;
    case 'server':
      content = generateServerHandler(importPath, exportName);
      break;
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }

  await writeFile(handlerPath, content);
  return handlerPath;
}

async function generateServerFile(
  outputDir: string,
  endpoints: ProcessedEndpoint[],
  envParserPath: string,
  envParserImportPattern: string,
  loggerPath: string,
  loggerImportPattern: string,
  enableOpenApi: boolean,
): Promise<string> {
  const serverFileName = 'app.ts';
  const serverPath = join(outputDir, serverFileName);

  // Group imports by file
  const importsByFile = new Map<string, string[]>();

  for (const { file, exportName } of endpoints) {
    const relativePath = relative(dirname(serverPath), file);
    const importPath = relativePath.replace(/\.ts$/, '.js');

    if (!importsByFile.has(importPath)) {
      importsByFile.set(importPath, []);
    }
    importsByFile.get(importPath)!.push(exportName);
  }

  const relativeEnvParserPath = relative(dirname(serverPath), envParserPath);
  const relativeLoggerPath = relative(dirname(serverPath), loggerPath);

  // Generate import statements
  const imports = Array.from(importsByFile.entries())
    .map(
      ([importPath, exports]) =>
        `import { ${exports.join(', ')} } from '${importPath}';`,
    )
    .join('\n');

  const allExportNames = endpoints.map(({ exportName }) => exportName);

  const content = `import { HonoEndpoint } from '@geekmidas/api/hono';
import { Endpoint } from '@geekmidas/api/server';
import { ServiceDiscovery } from '@geekmidas/api/services';
import { Hono } from 'hono';
import ${envParserImportPattern} from '${relativeEnvParserPath}';
import ${loggerImportPattern} from '${relativeLoggerPath}';
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
