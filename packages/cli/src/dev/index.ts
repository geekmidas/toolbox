import { type ChildProcess, execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import chokidar from 'chokidar';
import { config as dotenvConfig } from 'dotenv';
import fg from 'fast-glob';
import { resolveProviders } from '../build/providerResolver';
import type {
  BuildContext,
  NormalizedHooksConfig,
  NormalizedStudioConfig,
  NormalizedTelescopeConfig,
} from '../build/types';
import { loadConfig, parseModuleConfig } from '../config';
import {
  CronGenerator,
  EndpointGenerator,
  FunctionGenerator,
  SubscriberGenerator,
} from '../generators';
import {
  OPENAPI_OUTPUT_PATH,
  generateOpenApi,
  resolveOpenApiConfig,
} from '../openapi';
import type {
  GkmConfig,
  LegacyProvider,
  Runtime,
  StudioConfig,
  TelescopeConfig,
} from '../types';

const logger = console;

/**
 * Load environment files
 * @internal Exported for testing
 */
export function loadEnvFiles(
  envConfig: string | string[] | undefined,
  cwd: string = process.cwd(),
): { loaded: string[]; missing: string[] } {
  const loaded: string[] = [];
  const missing: string[] = [];

  // Normalize to array
  const envFiles = envConfig
    ? Array.isArray(envConfig)
      ? envConfig
      : [envConfig]
    : ['.env'];

  // Load each env file in order (later files override earlier)
  for (const envFile of envFiles) {
    const envPath = resolve(cwd, envFile);
    if (existsSync(envPath)) {
      dotenvConfig({ path: envPath, override: true, quiet: true });
      loaded.push(envFile);
    } else if (envConfig) {
      // Only report as missing if explicitly configured
      missing.push(envFile);
    }
  }

  return { loaded, missing };
}

/**
 * Check if a port is available
 * @internal Exported for testing
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port);
  });
}

/**
 * Find an available port starting from the preferred port
 * @internal Exported for testing
 */
export async function findAvailablePort(
  preferredPort: number,
  maxAttempts = 10,
): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = preferredPort + i;
    if (await isPortAvailable(port)) {
      return port;
    }
    logger.log(`⚠️  Port ${port} is in use, trying ${port + 1}...`);
  }

  throw new Error(
    `Could not find an available port after trying ${maxAttempts} ports starting from ${preferredPort}`,
  );
}

/**
 * Normalize telescope configuration
 * @internal Exported for testing
 */
export function normalizeTelescopeConfig(
  config: GkmConfig['telescope'],
): NormalizedTelescopeConfig | undefined {
  if (config === false) {
    return undefined;
  }

  // Handle string path (e.g., './src/config/telescope')
  if (typeof config === 'string') {
    const { path: telescopePath, importPattern: telescopeImportPattern } =
      parseModuleConfig(config, 'telescope');

    return {
      enabled: true,
      telescopePath,
      telescopeImportPattern,
      path: '/__telescope',
      ignore: [],
      recordBody: true,
      maxEntries: 1000,
      websocket: true,
    };
  }

  // Default to enabled in development mode
  const isEnabled =
    config === true || config === undefined || config.enabled !== false;

  if (!isEnabled) {
    return undefined;
  }

  const telescopeConfig: TelescopeConfig =
    typeof config === 'object' ? config : {};

  return {
    enabled: true,
    path: telescopeConfig.path ?? '/__telescope',
    ignore: telescopeConfig.ignore ?? [],
    recordBody: telescopeConfig.recordBody ?? true,
    maxEntries: telescopeConfig.maxEntries ?? 1000,
    websocket: telescopeConfig.websocket ?? true,
  };
}

/**
 * Normalize studio configuration
 * @internal Exported for testing
 */
export function normalizeStudioConfig(
  config: GkmConfig['studio'],
): NormalizedStudioConfig | undefined {
  if (config === false) {
    return undefined;
  }

  // Handle string path (e.g., './src/config/studio')
  if (typeof config === 'string') {
    const { path: studioPath, importPattern: studioImportPattern } =
      parseModuleConfig(config, 'studio');

    return {
      enabled: true,
      studioPath,
      studioImportPattern,
      path: '/__studio',
      schema: 'public',
    };
  }

  // Default to enabled in development mode
  const isEnabled =
    config === true || config === undefined || config.enabled !== false;

  if (!isEnabled) {
    return undefined;
  }

  const studioConfig: StudioConfig = typeof config === 'object' ? config : {};

  return {
    enabled: true,
    path: studioConfig.path ?? '/__studio',
    schema: studioConfig.schema ?? 'public',
  };
}

/**
 * Normalize hooks configuration
 * @internal Exported for testing
 */
export function normalizeHooksConfig(
  config: GkmConfig['hooks'],
): NormalizedHooksConfig | undefined {
  if (!config?.server) {
    return undefined;
  }

  // Resolve the path (handle .ts extension)
  const serverPath = config.server.endsWith('.ts')
    ? config.server
    : `${config.server}.ts`;

  const resolvedPath = resolve(process.cwd(), serverPath);

  return {
    serverHooksPath: resolvedPath,
  };
}

export interface DevOptions {
  port?: number;
  portExplicit?: boolean;
  enableOpenApi?: boolean;
}

export async function devCommand(options: DevOptions): Promise<void> {
  // Load default .env file BEFORE loading config
  // This ensures env vars are available when config and its dependencies are loaded
  const defaultEnv = loadEnvFiles('.env');
  if (defaultEnv.loaded.length > 0) {
    logger.log(`📦 Loaded env: ${defaultEnv.loaded.join(', ')}`);
  }

  const config = await loadConfig();

  // Load any additional env files specified in config
  if (config.env) {
    const { loaded, missing } = loadEnvFiles(config.env);
    if (loaded.length > 0) {
      logger.log(`📦 Loaded env: ${loaded.join(', ')}`);
    }
    if (missing.length > 0) {
      logger.warn(`⚠️  Missing env files: ${missing.join(', ')}`);
    }
  }

  // Force server provider for dev mode
  const resolved = resolveProviders(config, { provider: 'server' });

  logger.log('🚀 Starting development server...');
  logger.log(`Loading routes from: ${config.routes}`);
  if (config.functions) {
    logger.log(`Loading functions from: ${config.functions}`);
  }
  if (config.crons) {
    logger.log(`Loading crons from: ${config.crons}`);
  }
  if (config.subscribers) {
    logger.log(`Loading subscribers from: ${config.subscribers}`);
  }
  logger.log(`Using envParser: ${config.envParser}`);

  // Parse envParser and logger configuration
  const { path: envParserPath, importPattern: envParserImportPattern } =
    parseModuleConfig(config.envParser, 'envParser');
  const { path: loggerPath, importPattern: loggerImportPattern } =
    parseModuleConfig(config.logger, 'logger');

  // Normalize telescope configuration
  const telescope = normalizeTelescopeConfig(config.telescope);
  if (telescope) {
    logger.log(`🔭 Telescope enabled at ${telescope.path}`);
  }

  // Normalize studio configuration
  const studio = normalizeStudioConfig(config.studio);
  if (studio) {
    logger.log(`🗄️  Studio enabled at ${studio.path}`);
  }

  // Normalize hooks configuration
  const hooks = normalizeHooksConfig(config.hooks);
  if (hooks) {
    logger.log(`🪝 Server hooks enabled from ${config.hooks?.server}`);
  }

  // Resolve OpenAPI configuration
  const openApiConfig = resolveOpenApiConfig(config);
  // Enable OpenAPI docs endpoint if either root config or provider config enables it
  const enableOpenApi = openApiConfig.enabled || resolved.enableOpenApi;
  if (enableOpenApi) {
    logger.log(`📄 OpenAPI output: ${OPENAPI_OUTPUT_PATH}`);
  }

  const buildContext: BuildContext = {
    envParserPath,
    envParserImportPattern,
    loggerPath,
    loggerImportPattern,
    telescope,
    studio,
    hooks,
  };

  // Build initial version
  await buildServer(
    config,
    buildContext,
    resolved.providers[0] as LegacyProvider,
    enableOpenApi,
  );

  // Generate OpenAPI spec on startup
  if (enableOpenApi) {
    await generateOpenApi(config);
  }

  // Determine runtime (default to node)
  const runtime: Runtime = config.runtime ?? 'node';

  // Start the dev server
  const devServer = new DevServer(
    resolved.providers[0] as LegacyProvider,
    options.port || 3000,
    options.portExplicit ?? false,
    enableOpenApi,
    telescope,
    studio,
    runtime,
  );

  await devServer.start();

  // Watch for file changes
  const envParserFile = config.envParser.split('#')[0] ?? config.envParser;
  const loggerFile = config.logger.split('#')[0] ?? config.logger;

  // Get hooks file path for watching
  const hooksFileParts = config.hooks?.server?.split('#');
  const hooksFile = hooksFileParts?.[0];

  const watchPatterns = [
    config.routes,
    ...(config.functions ? [config.functions] : []),
    ...(config.crons ? [config.crons] : []),
    ...(config.subscribers ? [config.subscribers] : []),
    // Add .ts extension if not present for config files
    envParserFile.endsWith('.ts') ? envParserFile : `${envParserFile}.ts`,
    loggerFile.endsWith('.ts') ? loggerFile : `${loggerFile}.ts`,
    // Add hooks file to watch list
    ...(hooksFile
      ? [hooksFile.endsWith('.ts') ? hooksFile : `${hooksFile}.ts`]
      : []),
  ]
    .flat()
    .filter((p): p is string => typeof p === 'string');

  // Normalize patterns - remove leading ./ when using cwd option
  const normalizedPatterns = watchPatterns.map((p) =>
    p.startsWith('./') ? p.slice(2) : p,
  );

  logger.log(`👀 Watching for changes in: ${normalizedPatterns.join(', ')}`);

  // Resolve glob patterns to actual files (chokidar 4.x doesn't support globs)
  const resolvedFiles = await fg(normalizedPatterns, {
    cwd: process.cwd(),
    absolute: false,
    onlyFiles: true,
  });

  // Also watch the directories for new files
  const dirsToWatch = [
    ...new Set(
      resolvedFiles.map((f) => {
        const parts = f.split('/');
        return parts.slice(0, -1).join('/');
      }),
    ),
  ];

  logger.log(
    `📁 Found ${resolvedFiles.length} files in ${dirsToWatch.length} directories`,
  );

  const watcher = chokidar.watch([...resolvedFiles, ...dirsToWatch], {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true,
    cwd: process.cwd(),
  });

  watcher.on('ready', () => {
    logger.log('🔍 File watcher ready');
  });

  watcher.on('error', (error) => {
    logger.error('❌ Watcher error:', error);
  });

  let rebuildTimeout: NodeJS.Timeout | null = null;

  watcher.on('change', async (path) => {
    logger.log(`📝 File changed: ${path}`);

    // Debounce rebuilds
    if (rebuildTimeout) {
      clearTimeout(rebuildTimeout);
    }

    rebuildTimeout = setTimeout(async () => {
      try {
        logger.log('🔄 Rebuilding...');
        await buildServer(
          config,
          buildContext,
          resolved.providers[0] as LegacyProvider,
          enableOpenApi,
        );

        // Regenerate OpenAPI if enabled
        if (enableOpenApi) {
          await generateOpenApi(config, { silent: true });
        }

        logger.log('✅ Rebuild complete, restarting server...');
        await devServer.restart();
      } catch (error) {
        logger.error('❌ Rebuild failed:', (error as Error).message);
      }
    }, 300);
  });

  // Handle graceful shutdown
  let isShuttingDown = false;
  const shutdown = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.log('\n🛑 Shutting down...');

    // Use sync-style shutdown to ensure it completes before exit
    Promise.all([watcher.close(), devServer.stop()])
      .catch((err) => {
        logger.error('Error during shutdown:', err);
      })
      .finally(() => {
        process.exit(0);
      });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function buildServer(
  config: any,
  context: BuildContext,
  provider: LegacyProvider,
  enableOpenApi: boolean,
): Promise<void> {
  // Initialize generators
  const endpointGenerator = new EndpointGenerator();
  const functionGenerator = new FunctionGenerator();
  const cronGenerator = new CronGenerator();
  const subscriberGenerator = new SubscriberGenerator();

  // Load all constructs
  const [allEndpoints, allFunctions, allCrons, allSubscribers] =
    await Promise.all([
      endpointGenerator.load(config.routes),
      config.functions ? functionGenerator.load(config.functions) : [],
      config.crons ? cronGenerator.load(config.crons) : [],
      config.subscribers ? subscriberGenerator.load(config.subscribers) : [],
    ]);

  // Ensure .gkm directory exists
  const outputDir = join(process.cwd(), '.gkm', provider);
  await mkdir(outputDir, { recursive: true });

  // Build for server provider
  await Promise.all([
    endpointGenerator.build(context, allEndpoints, outputDir, {
      provider,
      enableOpenApi,
    }),
    functionGenerator.build(context, allFunctions, outputDir, { provider }),
    cronGenerator.build(context, allCrons, outputDir, { provider }),
    subscriberGenerator.build(context, allSubscribers, outputDir, { provider }),
  ]);
}

class DevServer {
  private serverProcess: ChildProcess | null = null;
  private isRunning = false;
  private actualPort: number;

  constructor(
    private provider: LegacyProvider,
    private requestedPort: number,
    private portExplicit: boolean,
    private enableOpenApi: boolean,
    private telescope?: NormalizedTelescopeConfig,
    private studio?: NormalizedStudioConfig,
    private runtime: Runtime = 'node',
  ) {
    this.actualPort = requestedPort;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      await this.stop();
    }

    // Check port availability
    if (this.portExplicit) {
      // Port was explicitly specified - throw if unavailable
      const available = await isPortAvailable(this.requestedPort);
      if (!available) {
        throw new Error(
          `Port ${this.requestedPort} is already in use. ` +
            `Either stop the process using that port or omit -p/--port to auto-select an available port.`,
        );
      }
      this.actualPort = this.requestedPort;
    } else {
      // Find an available port starting from the default
      this.actualPort = await findAvailablePort(this.requestedPort);

      if (this.actualPort !== this.requestedPort) {
        logger.log(
          `ℹ️  Port ${this.requestedPort} was in use, using port ${this.actualPort} instead`,
        );
      }
    }

    const serverEntryPath = join(
      process.cwd(),
      '.gkm',
      this.provider,
      'server.ts',
    );

    // Create server entry file
    await this.createServerEntry();

    logger.log(`\n✨ Starting server on port ${this.actualPort}...`);

    // Start the server using tsx (TypeScript execution)
    // Use detached: true so we can kill the entire process tree
    this.serverProcess = spawn(
      'npx',
      ['tsx', serverEntryPath, '--port', this.actualPort.toString()],
      {
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'development' },
        detached: true,
      },
    );

    this.isRunning = true;

    this.serverProcess.on('error', (error) => {
      logger.error('❌ Server error:', error);
    });

    this.serverProcess.on('exit', (code, signal) => {
      if (code !== null && code !== 0 && signal !== 'SIGTERM') {
        logger.error(`❌ Server exited with code ${code}`);
      }
      this.isRunning = false;
    });

    // Give the server a moment to start
    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (this.isRunning) {
      logger.log(`\n🎉 Server running at http://localhost:${this.actualPort}`);
      if (this.enableOpenApi) {
        logger.log(
          `📚 API Docs available at http://localhost:${this.actualPort}/__docs`,
        );
      }
      if (this.telescope) {
        logger.log(
          `🔭 Telescope available at http://localhost:${this.actualPort}${this.telescope.path}`,
        );
      }
      if (this.studio) {
        logger.log(
          `🗄️  Studio available at http://localhost:${this.actualPort}${this.studio.path}`,
        );
      }
    }
  }

  async stop(): Promise<void> {
    const port = this.actualPort;

    if (this.serverProcess && this.isRunning) {
      const pid = this.serverProcess.pid;

      // Use SIGKILL directly since the server ignores SIGTERM
      if (pid) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Process might already be dead
          }
        }
      }

      this.serverProcess = null;
      this.isRunning = false;
    }

    // Also kill any processes still holding the port
    this.killProcessesOnPort(port);
  }

  private killProcessesOnPort(port: number): void {
    try {
      // Use lsof to find PIDs on the port and kill them with -9
      execSync(`lsof -ti tcp:${port} | xargs kill -9 2>/dev/null || true`, {
        stdio: 'ignore',
      });
    } catch {
      // Ignore errors - port may already be free
    }
  }

  async restart(): Promise<void> {
    const portToReuse = this.actualPort;
    await this.stop();

    // Wait for port to be released (up to 3 seconds)
    let attempts = 0;
    while (attempts < 30) {
      if (await isPortAvailable(portToReuse)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      attempts++;
    }

    // Force reuse the same port
    this.requestedPort = portToReuse;
    await this.start();
  }

  private async createServerEntry(): Promise<void> {
    const { writeFile } = await import('node:fs/promises');
    const { relative, dirname } = await import('node:path');

    const serverPath = join(process.cwd(), '.gkm', this.provider, 'server.ts');

    const relativeAppPath = relative(
      dirname(serverPath),
      join(dirname(serverPath), 'app.js'),
    );

    const serveCode =
      this.runtime === 'bun'
        ? `Bun.serve({
      port,
      fetch: app.fetch,
    });`
        : `const { serve } = await import('@hono/node-server');
    const server = serve({
      fetch: app.fetch,
      port,
    });
    // Inject WebSocket support if available
    const injectWs = (app as any).__injectWebSocket;
    if (injectWs) {
      injectWs(server);
      console.log('🔌 Telescope real-time updates enabled');
    }`;

    const content = `#!/usr/bin/env node
/**
 * Development server entry point
 * This file is auto-generated by 'gkm dev'
 */
import { createApp } from './${relativeAppPath.startsWith('.') ? relativeAppPath : './' + relativeAppPath}';

const port = process.argv.includes('--port')
  ? Number.parseInt(process.argv[process.argv.indexOf('--port') + 1])
  : 3000;

// createApp is async to support optional WebSocket setup
const { app, start } = await createApp(undefined, ${this.enableOpenApi});

// Start the server
start({
  port,
  serve: async (app, port) => {
    ${serveCode}
  },
}).catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
`;

    await writeFile(serverPath, content);
  }
}
