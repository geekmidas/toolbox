import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import chokidar from 'chokidar';
import { resolveProviders } from '../build/providerResolver';
import type { BuildContext, NormalizedTelescopeConfig } from '../build/types';
import { loadConfig } from '../config';
import {
  CronGenerator,
  EndpointGenerator,
  FunctionGenerator,
  SubscriberGenerator,
} from '../generators';
import type { GkmConfig, LegacyProvider, TelescopeConfig } from '../types';

const logger = console;

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

  // Default to enabled in development mode
  const isEnabled = config === true || config === undefined || config.enabled !== false;

  if (!isEnabled) {
    return undefined;
  }

  const telescopeConfig: TelescopeConfig = typeof config === 'object' ? config : {};

  return {
    enabled: true,
    path: telescopeConfig.path ?? '/__telescope',
    ignore: telescopeConfig.ignore ?? [],
    recordBody: telescopeConfig.recordBody ?? true,
    maxEntries: telescopeConfig.maxEntries ?? 1000,
  };
}

export interface DevOptions {
  port?: number;
  enableOpenApi?: boolean;
}

export async function devCommand(options: DevOptions): Promise<void> {
  const config = await loadConfig();

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

  // Normalize telescope configuration
  const telescope = normalizeTelescopeConfig(config.telescope);
  if (telescope) {
    logger.log(`🔭 Telescope enabled at ${telescope.path}`);
  }

  const buildContext: BuildContext = {
    envParserPath,
    envParserImportPattern,
    loggerPath,
    loggerImportPattern,
    telescope,
  };

  // Build initial version
  await buildServer(
    config,
    buildContext,
    resolved.providers[0] as LegacyProvider,
    resolved.enableOpenApi,
  );

  // Start the dev server
  const devServer = new DevServer(
    resolved.providers[0] as LegacyProvider,
    options.port || 3000,
    resolved.enableOpenApi,
  );

  await devServer.start();

  // Watch for file changes
  const watchPatterns = [
    config.routes,
    ...(config.functions ? [config.functions] : []),
    ...(config.crons ? [config.crons] : []),
    ...(config.subscribers ? [config.subscribers] : []),
    config.envParser.split('#')[0],
    config.logger.split('#')[0],
  ].flat();

  logger.log(`👀 Watching for changes in: ${watchPatterns.join(', ')}`);

  const watcher = chokidar.watch(watchPatterns, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true,
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
          resolved.enableOpenApi,
        );
        logger.log('✅ Rebuild complete, restarting server...');
        await devServer.restart();
      } catch (error) {
        logger.error('❌ Rebuild failed:', (error as Error).message);
      }
    }, 300);
  });

  // Handle graceful shutdown
  const shutdown = async () => {
    logger.log('\n🛑 Shutting down...');
    await watcher.close();
    await devServer.stop();
    process.exit(0);
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
    private enableOpenApi: boolean,
  ) {
    this.actualPort = requestedPort;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      await this.stop();
    }

    // Find an available port
    this.actualPort = await findAvailablePort(this.requestedPort);

    if (this.actualPort !== this.requestedPort) {
      logger.log(
        `ℹ️  Port ${this.requestedPort} was in use, using port ${this.actualPort} instead`,
      );
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
    this.serverProcess = spawn(
      'npx',
      ['tsx', serverEntryPath, '--port', this.actualPort.toString()],
      {
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'development' },
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
          `📚 API Docs available at http://localhost:${this.actualPort}/docs`,
        );
      }
    }
  }

  async stop(): Promise<void> {
    if (this.serverProcess && this.isRunning) {
      this.serverProcess.kill('SIGTERM');

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.serverProcess?.kill('SIGKILL');
          resolve();
        }, 5000);

        this.serverProcess?.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.serverProcess = null;
      this.isRunning = false;
    }
  }

  async restart(): Promise<void> {
    await this.stop();
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

    const content = `#!/usr/bin/env node
/**
 * Development server entry point
 * This file is auto-generated by 'gkm dev'
 */
import { createApp } from './${relativeAppPath.startsWith('.') ? relativeAppPath : './' + relativeAppPath}';

const port = process.argv.includes('--port')
  ? Number.parseInt(process.argv[process.argv.indexOf('--port') + 1])
  : 3000;

const { app, start } = createApp(undefined, ${this.enableOpenApi});

// Start the server
start({
  port,
  serve: async (app, port) => {
    // Detect runtime and use appropriate server
    if (typeof Bun !== 'undefined') {
      // Bun runtime
      Bun.serve({
        port,
        fetch: app.fetch,
      });
    } else {
      // Node.js runtime with @hono/node-server
      const { serve } = await import('@hono/node-server');
      serve({
        fetch: app.fetch,
        port,
      });
    }
  },
}).catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
`;

    await writeFile(serverPath, content);
  }
}
