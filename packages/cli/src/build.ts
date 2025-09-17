import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'path';
import { loadConfig } from './config.js';
import { loadEndpoints } from './loadEndpoints.js';
import type {
  BuildOptions,
  Provider,
  RouteInfo,
  RoutesManifest,
} from './types.js';

const logger = console;
export async function buildCommand(options: BuildOptions): Promise<void> {
  logger.log(`Building with providers: ${options.providers.join(', ')}`);

  const config = await loadConfig();
  logger.log(`Loading routes from: ${config.routes}`);
  logger.log(`Using envParser: ${config.envParser}`);

  // Parse envParser configuration
  const [envParserPath, envParserName] = config.envParser.split('#');
  const envParserImportPattern = !envParserName
    ? 'envParser'
    : envParserName === 'envParser'
      ? '{ envParser }'
      : `{ ${envParserName} as envParser }`;

  // Parse logger configuration
  const [loggerPath, loggerName] = config.logger.split('#');
  const loggerImportPattern = !loggerName
    ? 'logger'
    : loggerName === 'logger'
      ? '{ logger }'
      : `{ ${loggerName} as logger }`;

  // Load all endpoints using the refactored function
  const loadedEndpoints = await loadEndpoints(config.routes);

  if (loadedEndpoints.length === 0) {
    logger.log('No endpoints found to process');
    return;
  }

  const allEndpoints = loadedEndpoints.map(({ name, endpoint, file }) => {
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

  // Process each provider
  for (const provider of options.providers) {
    const routes: RouteInfo[] = [];
    const outputDir = join(process.cwd(), '.gkm', provider);

    // Ensure output directory exists
    await mkdir(outputDir, { recursive: true });

    logger.log(`\nGenerating handlers for provider: ${provider}`);

    // Generate handlers based on provider
    if (provider === 'server') {
      // Generate single server file with all endpoints
      const serverFile = await generateServerFile(
        outputDir,
        allEndpoints,
        envParserPath,
        envParserImportPattern,
        loggerPath,
        loggerImportPattern,
        options.enableOpenApi || false,
      );

      routes.push({
        path: '*',
        method: 'ALL',
        handler: relative(process.cwd(), serverFile),
      });

      logger.log(
        `Generated server app with ${allEndpoints.length} endpoints${options.enableOpenApi ? ' (OpenAPI enabled)' : ''}`,
      );
    } else {
      // Generate individual handler files for AWS providers
      for (const { file, exportName, routeInfo } of allEndpoints) {
        const handlerFile = await generateHandlerFile(
          outputDir,
          file,
          exportName,
          provider,
          routeInfo,
          envParserPath,
          envParserImportPattern,
        );

        routes.push({
          ...routeInfo,
          handler: relative(process.cwd(), handlerFile).replace(
            /\.ts$/,
            '.handler',
          ),
        });

        logger.log(
          `Generated handler for ${routeInfo.method} ${routeInfo.path}`,
        );
      }
    }

    // Generate routes.json
    const manifest: RoutesManifest = { routes };
    const manifestPath = join(outputDir, 'routes.json');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    logger.log(
      `Generated ${routes.length} handlers in ${relative(process.cwd(), outputDir)}`,
    );
    logger.log(`Routes manifest: ${relative(process.cwd(), manifestPath)}`);
  }
}

async function generateServerFile(
  outputDir: string,
  endpoints: Array<{
    file: string;
    exportName: string;
    endpoint: any;
    routeInfo: RouteInfo;
  }>,
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

async function generateHandlerFile(
  outputDir: string,
  sourceFile: string,
  exportName: string,
  provider: Provider,
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
