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
import type { RouteInfo } from '../types';
import type { StorageDrivers } from './drivers';
import {
	ConstructGenerator,
	type GeneratedConstruct,
	type GeneratorOptions,
} from './Generator';
import { generateTelemetryModule } from './telemetry';

/**
 * How a generated entry gets its logger and environment parser.
 *
 * From the surface it serves, when there is one: the surface holds both as
 * *objects*, and discovery already recorded which module declares it, so the
 * entry imports that module and reads them off it.
 *
 * The alternative — the shape this replaces — was naming both in config as
 * module paths, `envParser: './config/env#envParser'`, and printing an import
 * for each. Two strings per app, checked by nothing, describing files the
 * surface was already holding the contents of.
 *
 * Falls back to the configured paths for an app that declares no surface.
 */
export function runtimeFor(
	context: BuildContext,
	fromDir: string,
	/**
	 * The construct that owns the thing being generated.
	 *
	 * An endpoint's surface, or the worker that handed out the cron factory.
	 * Omitted for the app entry itself, which belongs to the primary surface.
	 */
	owner?: string,
): { imports: string; bindings: string } {
	const module = owner
		? (context.owners?.[owner] ?? context.surface?.module)
		: context.surface?.module;

	if (module) {
		const specifier = importSpecifier(fromDir, module.specifier);

		// Bound to the same names the rest of the entry already uses, so what
		// changes is where they come from and nothing else.
		return {
			imports: `import { ${module.exportName} as __surface } from '${specifier}';`,
			bindings: [
				'// What this construct was declared with. Objects, not module paths:',
				'// the entry imports the owner, so there is nothing to print.',
				'const envParser = __surface.envParser;',
				'const logger = __surface.logger;',
			].join('\n'),
		};
	}

	// No fallback. Every runnable comes from a factory a `RestApi` or a `Worker`
	// handed out, and that construct holds the objects — so there is no longer a
	// case where the only thing we know about a logger is a module path somebody
	// typed into config.
	throw new Error(
		`No owner to take a logger and an environment parser from${
			owner ? ` for "${owner}"` : ''
		}. Build it from a \`RestApi\` or a \`Worker\`.`,
	);
}

/** A relative specifier ESM will accept: always prefixed, never bare. */
function importSpecifier(fromDir: string, target: string): string {
	const rel = relative(fromDir, target).replace(/\.ts$/, '.js');

	return rel.startsWith('.') ? rel : `./${rel}`;
}

/**
 * CORS for a surface, derived rather than hand-written.
 *
 * Who may call a surface is already in the graph — every construct that
 * declared an edge to it — and reaches the process as one comma-separated
 * value. An application that maintained this by hand maintained a list that was
 * wrong in two directions at once: it trusted origins nothing was serving, and
 * it could not name hosts a deploy had not chosen yet.
 *
 * Only the parts a graph cannot answer are configurable, and every one has a
 * default: a surface that says nothing about CORS still gets it.
 */
export function corsFor(surface: BuildContext['surface']): {
	imports: string;
	setup: string;
} {
	if (!surface) return { imports: '', setup: '' };

	const cors = surface.cors ?? {};
	const allowHeaders = [
		'content-type',
		'authorization',
		...(cors.allowHeaders ?? []),
	];

	return {
		imports: `import { cors } from 'hono/cors';`,
		setup: `
  // Who may call ${surface.id}, read off the graph rather than listed here.
  {
    const { origins } = envParser
      .create((get) => ({
        origins: get('${surface.trustedOriginsKey}')
          .string()
          .default('')
          .transform((value: string) =>
            value.split(',').map((origin) => origin.trim()).filter(Boolean),
          ),
      }))
      .parse();

    honoApp.use('*', cors({
      origin: origins,
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowHeaders: ${JSON.stringify(allowHeaders)},${
				cors.exposeHeaders
					? `\n      exposeHeaders: ${JSON.stringify(cors.exposeHeaders)},`
					: ''
			}
      credentials: ${cors.credentials ?? true},
      maxAge: ${cors.maxAge ?? 86400},
    }));
  }
`,
	};
}

export class EndpointGenerator extends ConstructGenerator<
	Endpoint<any, any, any, any, any, any, any, any, any, any, any, any>,
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
		any
	> {
		return Endpoint.isEndpoint(value);
	}

	async build(
		context: BuildContext,
		constructs: GeneratedConstruct<
			Endpoint<any, any, any, any, any, any, any, any, any, any, any, any>
		>[],
		outputDir: string,
		options?: GeneratorOptions,
	): Promise<RouteInfo[]> {
		const target = options?.target ?? 'aws';
		const root = options?.root ?? process.cwd();
		const enableOpenApi = options?.enableOpenApi || false;
		const logger = console;
		const routes: RouteInfo[] = [];

		if (constructs.length === 0) {
			return routes;
		}

		if (target === 'server') {
			// Generate endpoints.ts and app.ts
			await this.generateEndpointsFile(outputDir, constructs, context);
			const appFile = await this.generateAppFile(outputDir, context);

			routes.push({
				path: '*',
				method: 'ALL',
				handler: relative(root, appFile),
				authorizer: 'none',
			});

			logger.log(
				`Generated server with ${constructs.length} endpoints${enableOpenApi ? ' (OpenAPI enabled)' : ''}`,
			);

			return routes;
		}

		// One Lambda per endpoint, behind an HTTP API.
		const routesDir = join(outputDir, 'routes');
		await mkdir(routesDir, { recursive: true });

		for (const { key, construct, path } of constructs) {
			const handlerFile = await this.generateHandlerFile(
				routesDir,
				path.relative,
				key,
				context,
			);

			const routeInfo: RouteInfo = {
				path: construct._path,
				method: construct.method,
				handler: relative(root, handlerFile).replace(/\.ts$/, '.handler'),
				timeout: construct.timeout,
				memorySize: construct.memorySize,
				environment: await construct.getEnvironment({
					markOptional: context.markOptional,
				}),
				dependencies: construct.constructs,
				authorizer: construct.authorizer?.name ?? 'none',
			};

			routes.push(routeInfo);
			logger.log(`Generated handler for ${routeInfo.method} ${routeInfo.path}`);
		}

		return routes;
	}

	private async generateHandlerFile(
		outputDir: string,
		sourceFile: string,
		exportName: string,
		context: BuildContext,
	): Promise<string> {
		const handlerPath = join(outputDir, `${exportName}.ts`);

		const relativePath = relative(dirname(handlerPath), sourceFile);
		const importPath = relativePath.replace(/\.ts$/, '.js');

		await writeFile(
			handlerPath,
			this.generateAWSApiGatewayV2Handler(
				importPath,
				exportName,
				context.storageDrivers,
			),
		);
		return handlerPath;
	}

	private async generateEndpointsFile(
		outputDir: string,
		endpoints: GeneratedConstruct<
			Endpoint<any, any, any, any, any, any, any, any, any, any, any, any>
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
			importsByFile.get(importPath)?.push(key);
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

export const endpoints: Endpoint<any, any, any, any, any, any, any, any, any, any, any, any>[] = [
  ${allExportNames.join(',\n  ')}
];

export async function setupEndpoints(
  app: Hono,
  envParser: EnvironmentParser<any>,
  logger: Logger,
  enableOpenApi: boolean = true,
): Promise<void> {
  const serviceDiscovery = ServiceDiscovery.getInstance(envParser);

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
			Endpoint<any, any, any, any, any, any, any, any, any, any, any, any>
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

		// The logger and the env parser, from the surface that already holds them.
		const runtime = runtimeFor(context, dirname(appPath));

		// Generate telescope imports and setup if enabled
		const telescopeEnabled = context.telescope?.enabled;
		const telescopeWebSocketEnabled = context.telescope?.websocket;
		const usesExternalTelescope = !!context.telescope?.telescopePath;

		// Generate imports based on whether telescope is external or inline
		const telescopeFromSurface =
			!!context.surface?.module && !usesExternalTelescope;

		let telescopeImports = '';
		if (telescopeEnabled) {
			if (telescopeFromSurface) {
				// The entry already imports the surface, which may or may not have
				// been given a Telescope — an object, so only the running entry can
				// tell. The inline one stands in when it was not.
				telescopeImports = `import { Telescope, InMemoryStorage } from '@geekmidas/telescope';
import { createApi, createMiddleware } from '@geekmidas/telescope/hono';`;
			} else if (usesExternalTelescope) {
				const relativeTelescopePath = relative(
					dirname(appPath),
					context.telescope?.telescopePath!,
				);
				telescopeImports = `import ${context.telescope?.telescopeImportPattern} from '${relativeTelescopePath}';
import { createApi, createMiddleware } from '@geekmidas/telescope/hono';`;
			} else {
				telescopeImports = `import { Telescope, InMemoryStorage } from '@geekmidas/telescope';
import { createApi, createMiddleware } from '@geekmidas/telescope/hono';`;
			}
		}

		// The database's read-only JSON API, from the declared database. The
		// client comes from the construct, so what it reads is by definition what
		// the handlers write to.
		const databaseApi = context.databaseApi;
		const databaseApiImports = databaseApi
			? `import { snifferContext } from '@geekmidas/constructs';
import { createIntrospectionHandler } from '@geekmidas/db/introspect';
import { ${databaseApi.database.exportName} as __introspectedDb } from '${importSpecifier(dirname(appPath), databaseApi.database.specifier)}';`
			: '';

		// Generate imports for server hooks
		const cors = corsFor(context.surface);
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
    honoApp.get('${context.telescope?.path}/ws', upgradeWebSocket(() => ({
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
			if (telescopeFromSurface || usesExternalTelescope) {
				// Use external telescope instance - no need to create one
				telescopeSetup = `
${telescopeWebSocketSetupCode}
  // Add telescope middleware (before endpoints to capture all requests)
  honoApp.use('*', createMiddleware(telescope));

  // Mount Telescope's JSON API
  const telescopeApi = createApi(telescope);
  honoApp.route('${context.telescope?.path}', telescopeApi);
`;
			} else {
				// Create inline telescope instance
				telescopeSetup = `
  // Setup Telescope for debugging/monitoring
  const telescopeStorage = new InMemoryStorage({ maxEntries: ${context.telescope?.maxEntries} });
  const telescope = new Telescope({
    enabled: true,
    path: '${context.telescope?.path}',
    ignorePatterns: ${JSON.stringify(context.telescope?.ignore)},
    recordBody: ${context.telescope?.recordBody},
    storage: telescopeStorage,
  });
${telescopeWebSocketSetupCode}
  // Add telescope middleware (before endpoints to capture all requests)
  honoApp.use('*', createMiddleware(telescope));

  // Mount Telescope's JSON API
  const telescopeApi = createApi(telescope);
  honoApp.route('${context.telescope?.path}', telescopeApi);
`;
			}
		}

		const databaseApiSetup = databaseApi
			? `
  // The database's structure and rows as JSON, read-only, for whatever tool
  // the developer points at it. Dev only: it answers anyone who can reach the
  // port.
  const databaseApi = createIntrospectionHandler({
    db: await __introspectedDb.service.register({ envParser, context: snifferContext }),
    basePath: '${databaseApi.path}',
  });
  honoApp.all('${databaseApi.path}/*', (c) => databaseApi(c.req.raw));
`
			: '';

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
import { setupQueues } from './queues.js';
import { setupCrons } from './crons.js';
${runtime.imports}
${telescopeImports}
${databaseApiImports}
${hooksImports}
${cors.imports}
${context.storageDrivers?.imports ?? ''}

${runtime.bindings}
${
	telescopeEnabled && telescopeFromSurface
		? `// The surface's own Telescope, or the one \`telescope\` config describes.
const telescope =
  __surface.telescope ??
  new Telescope({
    enabled: true,
    path: '${context.telescope?.path}',
    ignorePatterns: ${JSON.stringify(context.telescope?.ignore)},
    recordBody: ${context.telescope?.recordBody},
    storage: new InMemoryStorage({ maxEntries: ${context.telescope?.maxEntries} }),
  });`
		: ''
}

${
	context.storageDrivers?.setup
		? `// Which storage drivers exist is the entry point's decision: the scheme in
// each injected URL picks one, so no construct and no application module names
// a provider.
${context.storageDrivers.setup}
`
		: ''
}
${
	context.surface
		? `// Who this server is to Postgres: application_name on every connection.
process.env.GKM_APP_NAME ??= ${JSON.stringify(context.surface.id)};

`
		: ''
}export interface ServerApp {
  app: HonoType;
  start: (options?: {
    port?: number;
    /** Returns the server, so a shutdown can stop it taking requests. */
    serve: (app: HonoType, port: number) => unknown;
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
${telescopeSetup}${cors.setup}${beforeSetupCall}${databaseApiSetup}
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

      // Mount pushed subscribers' routes and start polled ones. What comes
      // back subscribes the routes, once the server can answer them.
      const subscribeForPush = await setupSubscribers(honoApp, envParser, logger).catch((error) => {
        logger.error({ error }, 'Failed to start subscribers');
        return async (_port: number) => {};
      });

      // Start queue workers in background (non-blocking, local development only)
      await setupQueues(envParser, logger).catch((error) => {
        logger.error({ error }, 'Failed to start queue workers');
      });

      // Schedule this app's crons. Caught like the others: a scheduler that
      // cannot start is not a reason for the HTTP server not to.
      await setupCrons(envParser, logger).catch((error) => {
        logger.error({ error }, 'Failed to schedule crons');
      });

      logger.info({ port }, 'Starting server');

      // Start HTTP server using provided serve function
      await options.serve(honoApp, port);

      logger.info({ port }, 'Server started');

      await subscribeForPush(port);
    }
  };
}

// Default export for convenience
export default createApp;
`;

		await writeFile(appPath, content);

		return appPath;
	}

	/**
	 * One Lambda, one endpoint — and no environment import.
	 *
	 * The endpoint was built from its surface, so it carries the parser the
	 * adaptor needs. This used to read
	 * `import { envParser } from '../../config/env'`, a line the build wrote
	 * because a generator can print a module specifier and cannot print an
	 * object. Nothing has to be printed now, which is also why nothing has to be
	 * named in config.
	 */
	private generateAWSApiGatewayV2Handler(
		importPath: string,
		exportName: string,
		drivers?: StorageDrivers,
	): string {
		return `import { AmazonApiGatewayV2Endpoint } from '@geekmidas/constructs/aws';
import { ${exportName} } from '${importPath}';
${drivers?.imports ?? ''}
${drivers?.setup ? `\n// The handler registers the drivers its target needs.\n${drivers.setup}\n` : ''}
const adapter = new AmazonApiGatewayV2Endpoint(${exportName});

export const handler = adapter.handler;
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

		// The app entry belongs to the primary surface, so no owner is named.
		const runtime = runtimeFor(context, dirname(appPath));

		const production = context.production!;
		const healthCheckPath = production.healthCheck;
		const enableGracefulShutdown = production.gracefulShutdown;
		const enableOpenApi = production.openapi;
		const includeSubscribers = production.subscribers === 'include';

		// Generate imports for server hooks
		const cors = corsFor(context.surface);
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

		// Subscriber + queue setup code (background workers share the same flag)
		const subscriberSetup = includeSubscribers
			? `
      // Mount pushed subscribers' routes and start polled ones. What comes
      // back subscribes the routes, once the server can answer them.
      const subscribeForPush = await setupSubscribers(honoApp, envParser, logger).catch((error) => {
        logger.error({ error }, 'Failed to start subscribers');
        return async (_port: number) => {};
      });

      // Start queue workers in background
      await setupQueues(envParser, logger).catch((error) => {
        logger.error({ error }, 'Failed to start queue workers');
      });

      // Schedule this app's crons. Caught like the others: a scheduler that
      // cannot start is not a reason for the HTTP server not to.
      await setupCrons(envParser, logger).catch((error) => {
        logger.error({ error }, 'Failed to schedule crons');
      });
`
			: '';

		const subscriberImport = includeSubscribers
			? `import { setupSubscribers } from './subscribers.js';
import { setupQueues } from './queues.js';
import { setupCrons } from './crons.js';`
			: '';

		// Graceful shutdown code
		const gracefulShutdownCode = enableGracefulShutdown
			? `
  // Graceful shutdown: stop taking requests, let in-flight ones finish, then
  // close what constructs opened (database pools) — so a rolling deploy does
  // not leave the old task holding connections. Bounded by
  // GKM_SHUTDOWN_TIMEOUT_MS, 8s by default: under Docker's 10s stop timeout,
  // so the process exits on its own terms rather than being killed mid-drain.
  let isShuttingDown = false;

  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    const deadline = Number(process.env.GKM_SHUTDOWN_TIMEOUT_MS) || 8000;
    logger.info({ deadline }, 'Graceful shutdown initiated');
    setTimeout(() => {
      logger.warn({ deadline }, 'Shutdown deadline reached, exiting');
      process.exit(1);
    }, deadline).unref();
    await new Promise<void>((resolve) => {
      const close = (server as { close?: (done: () => void) => void } | undefined)?.close;
      if (typeof close === 'function') close.call(server, () => resolve());
      else resolve();
    });
    await runShutdownHooks((error) => logger.error({ error }, 'Shutdown hook failed'));
    process.exit(0);
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
${enableGracefulShutdown ? "import { runShutdownHooks } from '@geekmidas/constructs';\n" : ''}import { setupEndpoints } from '${endpointsImportPath}';
${subscriberImport}
${runtime.imports}
${runtime.bindings}
${hooksImports}
${cors.imports}
${context.storageDrivers?.imports ?? ''}

${
	context.storageDrivers?.setup
		? `// The entry point registers the drivers its target needs.
${context.storageDrivers.setup}
`
		: ''
}
${
	context.surface
		? `// Who this server is to Postgres: application_name on every connection.
process.env.GKM_APP_NAME ??= ${JSON.stringify(context.surface.id)};

`
		: ''
}export interface ServerApp {
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

  // An HttpError a handler or a session callback throws — a 401, a 404 —
  // answers with its own status, as it does under gkm dev. The optimized
  // handlers do not catch, so without this every one of them was a 500.
  // Anything else is a 500 that says nothing about why, and is logged.
  honoApp.onError((error, c) => {
    const http = error as {
      isHttpError?: boolean;
      statusCode?: number;
      statusMessage?: string;
      code?: string;
      details?: unknown;
    };
    if (http.isHttpError === true && typeof http.statusCode === 'number') {
      return c.json(
        {
          name: error.name,
          message: error.message,
          statusCode: http.statusCode,
          statusMessage: http.statusMessage,
          code: http.code,
          details: http.details,
        },
        http.statusCode as 500,
      );
    }
    logger.error({ error }, 'Unhandled error');
    return c.json({ message: 'Internal Server Error' }, 500);
  });
${cors.setup}${beforeSetupCall}
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
      let server: unknown;
${gracefulShutdownCode}${subscriberSetup}
      logger.info({ port }, 'Starting production server');

      // Start HTTP server using provided serve function
      server = await options.serve(honoApp, port);

      logger.info({ port }, 'Production server started');
${includeSubscribers ? '\n      await subscribeForPush(port);' : ''}
    }
  };
}

// Default export for convenience
export default createApp;
`;

		await writeFile(appPath, content);

		// Also generate the production server entry point
		await this.generateProductionServerEntry(outputDir, context);

		return appPath;
	}

	/**
	 * Generate production server.ts entry point
	 */
	private async generateProductionServerEntry(
		outputDir: string,
		context: BuildContext,
	): Promise<void> {
		const serverPath = join(outputDir, 'server.ts');

		await writeFile(
			join(outputDir, 'telemetry.ts'),
			generateTelemetryModule(context.telemetry),
		);

		const content = `#!/usr/bin/env node
/**
 * Production server entry point
 * Generated by 'gkm build --production'
 */
import { serve } from '@hono/node-server';
import { startTelemetry } from './telemetry.js';

// Before the app is imported, so the libraries it loads are instrumented.
await startTelemetry();

const { createApp } = await import('./app.js');

const port = Number(process.env.PORT) || 3000;

const { start } = await createApp();

await start({
  port,
  serve: (app, port) => serve({ fetch: app.fetch, port }),
});
`;

		await writeFile(serverPath, content);
	}
}
