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
	NormalizedProductionConfig,
	NormalizedStudioConfig,
	NormalizedTelescopeConfig,
} from '../build/types';
import {
	getAppNameFromCwd,
	loadAppConfig,
	loadWorkspaceConfig,
	parseModuleConfig,
} from '../config';
import {
	CronGenerator,
	EndpointGenerator,
	FunctionGenerator,
	SubscriberGenerator,
} from '../generators';
import {
	generateOpenApi,
	OPENAPI_OUTPUT_PATH,
	resolveOpenApiConfig,
} from '../openapi';
import {
	readStageSecrets,
	secretsExist,
	toEmbeddableSecrets,
} from '../secrets/storage.js';
import type {
	GkmConfig,
	LegacyProvider,
	ProductionConfig,
	Runtime,
	ServerConfig,
	StudioConfig,
	TelescopeConfig,
} from '../types';
import {
	generateAllClients,
	generateClientForFrontend,
	getDependentFrontends,
	normalizeRoutes,
} from '../workspace/client-generator.js';
import {
	getAppBuildOrder,
	getDependencyEnvVars,
	type NormalizedWorkspace,
} from '../workspace/index.js';

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
	cwd: string = process.cwd(),
): NormalizedHooksConfig | undefined {
	if (!config?.server) {
		return undefined;
	}

	// Resolve the path (handle .ts extension)
	const serverPath = config.server.endsWith('.ts')
		? config.server
		: `${config.server}.ts`;

	const resolvedPath = resolve(cwd, serverPath);

	return {
		serverHooksPath: resolvedPath,
	};
}

/**
 * Normalize production configuration
 * @internal Exported for testing
 */
export function normalizeProductionConfig(
	cliProduction: boolean,
	configProduction?: ProductionConfig,
): NormalizedProductionConfig | undefined {
	// Production mode is only enabled if --production CLI flag is passed
	if (!cliProduction) {
		return undefined;
	}

	// Merge CLI flag with config options
	const config = configProduction ?? {};

	return {
		enabled: true,
		bundle: config.bundle ?? true,
		minify: config.minify ?? true,
		healthCheck: config.healthCheck ?? '/health',
		gracefulShutdown: config.gracefulShutdown ?? true,
		external: config.external ?? [],
		subscribers: config.subscribers ?? 'exclude',
		openapi: config.openapi ?? false,
		optimizedHandlers: config.optimizedHandlers ?? true, // Default to optimized handlers in production
	};
}

/**
 * Get production config from GkmConfig
 * @internal
 */
export function getProductionConfigFromGkm(
	config: GkmConfig,
): ProductionConfig | undefined {
	const serverConfig = config.providers?.server;
	if (typeof serverConfig === 'object') {
		return (serverConfig as ServerConfig).production;
	}
	return undefined;
}

export interface DevOptions {
	port?: number;
	portExplicit?: boolean;
	enableOpenApi?: boolean;
	/** Specific app to run in workspace mode (default: all apps) */
	app?: string;
	/** Filter apps by pattern (passed to turbo --filter) */
	filter?: string;
}

export async function devCommand(options: DevOptions): Promise<void> {
	// Load default .env file BEFORE loading config
	// This ensures env vars are available when config and its dependencies are loaded
	const defaultEnv = loadEnvFiles('.env');
	if (defaultEnv.loaded.length > 0) {
		logger.log(`📦 Loaded env: ${defaultEnv.loaded.join(', ')}`);
	}

	// Check if we're in an app subdirectory
	const appName = getAppNameFromCwd();
	let config: GkmConfig;
	let appRoot: string = process.cwd();

	if (appName) {
		// Try to load app-specific config from workspace
		try {
			const appConfig = await loadAppConfig();
			config = appConfig.gkmConfig;
			appRoot = appConfig.appRoot;
			logger.log(`📦 Running app: ${appConfig.appName}`);
		} catch {
			// Not in a workspace or app not found in workspace - fall back to regular loading
			const loadedConfig = await loadWorkspaceConfig();

			// Route to workspace dev mode for multi-app workspaces
			if (loadedConfig.type === 'workspace') {
				logger.log('📦 Detected workspace configuration');
				return workspaceDevCommand(loadedConfig.workspace, options);
			}

			config = loadedConfig.raw as GkmConfig;
		}
	} else {
		// Try to load workspace config
		const loadedConfig = await loadWorkspaceConfig();

		// Route to workspace dev mode for multi-app workspaces
		if (loadedConfig.type === 'workspace') {
			logger.log('📦 Detected workspace configuration');
			return workspaceDevCommand(loadedConfig.workspace, options);
		}

		// Single-app mode - use existing logic
		config = loadedConfig.raw as GkmConfig;
	}

	// Load any additional env files specified in config
	if (config.env) {
		const { loaded, missing } = loadEnvFiles(config.env, appRoot);
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
	const hooks = normalizeHooksConfig(config.hooks, appRoot);
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
		appRoot,
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
		appRoot,
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
		cwd: appRoot,
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
		ignored: /(^|[/\\])\../, // ignore dotfiles
		persistent: true,
		ignoreInitial: true,
		cwd: appRoot,
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
					appRoot,
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

/**
 * Generate all dependency environment variables for all apps.
 * Returns a flat object with all {APP_NAME}_URL variables.
 * @internal Exported for testing
 */
export function generateAllDependencyEnvVars(
	workspace: NormalizedWorkspace,
	urlPrefix = 'http://localhost',
): Record<string, string> {
	const env: Record<string, string> = {};

	for (const appName of Object.keys(workspace.apps)) {
		const appEnv = getDependencyEnvVars(workspace, appName, urlPrefix);
		Object.assign(env, appEnv);
	}

	return env;
}

/**
 * Check for port conflicts across all apps.
 * Returns list of conflicts if any ports are duplicated.
 * @internal Exported for testing
 */
export function checkPortConflicts(
	workspace: NormalizedWorkspace,
): { app1: string; app2: string; port: number }[] {
	const conflicts: { app1: string; app2: string; port: number }[] = [];
	const portToApp = new Map<number, string>();

	for (const [appName, app] of Object.entries(workspace.apps)) {
		const existingApp = portToApp.get(app.port);
		if (existingApp) {
			conflicts.push({ app1: existingApp, app2: appName, port: app.port });
		} else {
			portToApp.set(app.port, appName);
		}
	}

	return conflicts;
}

/**
 * Next.js config file patterns to check.
 */
const NEXTJS_CONFIG_FILES = [
	'next.config.js',
	'next.config.ts',
	'next.config.mjs',
];

/**
 * Validation result for a frontend app.
 */
export interface FrontendValidationResult {
	appName: string;
	valid: boolean;
	errors: string[];
	warnings: string[];
}

/**
 * Validate a frontend (Next.js) app configuration.
 * Checks for Next.js config file and dependency.
 * @internal Exported for testing
 */
export async function validateFrontendApp(
	appName: string,
	appPath: string,
	workspaceRoot: string,
): Promise<FrontendValidationResult> {
	const errors: string[] = [];
	const warnings: string[] = [];
	const fullPath = join(workspaceRoot, appPath);

	// Check for Next.js config file
	const hasConfigFile = NEXTJS_CONFIG_FILES.some((file) =>
		existsSync(join(fullPath, file)),
	);

	if (!hasConfigFile) {
		errors.push(
			`Next.js config file not found. Expected one of: ${NEXTJS_CONFIG_FILES.join(', ')}`,
		);
	}

	// Check for package.json
	const packageJsonPath = join(fullPath, 'package.json');
	if (existsSync(packageJsonPath)) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const pkg = require(packageJsonPath);
			const deps = { ...pkg.dependencies, ...pkg.devDependencies };

			if (!deps.next) {
				errors.push(
					'Next.js not found in dependencies. Run: pnpm add next react react-dom',
				);
			}

			// Check for dev script
			if (!pkg.scripts?.dev) {
				warnings.push(
					'No "dev" script found in package.json. Turbo expects a "dev" script to run.',
				);
			}
		} catch {
			errors.push(`Failed to read package.json at ${packageJsonPath}`);
		}
	} else {
		errors.push(
			`package.json not found at ${appPath}. Run: pnpm init in the app directory.`,
		);
	}

	return {
		appName,
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

/**
 * Validate all frontend apps in the workspace.
 * Returns validation results for each frontend app.
 * @internal Exported for testing
 */
export async function validateFrontendApps(
	workspace: NormalizedWorkspace,
): Promise<FrontendValidationResult[]> {
	const results: FrontendValidationResult[] = [];

	for (const [appName, app] of Object.entries(workspace.apps)) {
		if (app.type === 'frontend') {
			const result = await validateFrontendApp(
				appName,
				app.path,
				workspace.root,
			);
			results.push(result);
		}
	}

	return results;
}

/**
 * Load secrets for development stage.
 * Returns env vars to inject, or empty object if secrets not configured/found.
 * @internal Exported for testing
 */
export async function loadDevSecrets(
	workspace: NormalizedWorkspace,
): Promise<Record<string, string>> {
	// Check if secrets are enabled in workspace config
	if (!workspace.secrets.enabled) {
		return {};
	}

	// Try 'dev' stage first, then 'development'
	const stages = ['dev', 'development'];

	for (const stage of stages) {
		if (secretsExist(stage, workspace.root)) {
			const secrets = await readStageSecrets(stage, workspace.root);
			if (secrets) {
				logger.log(`🔐 Loading secrets from stage: ${stage}`);
				return toEmbeddableSecrets(secrets);
			}
		}
	}

	logger.warn(
		'⚠️  Secrets enabled but no dev/development secrets found. Run "gkm secrets:init --stage dev"',
	);
	return {};
}

/**
 * Start docker-compose services for the workspace.
 * @internal Exported for testing
 */
export async function startWorkspaceServices(
	workspace: NormalizedWorkspace,
): Promise<void> {
	const services = workspace.services;
	if (!services.db && !services.cache && !services.mail) {
		return;
	}

	const servicesToStart: string[] = [];

	if (services.db) {
		servicesToStart.push('postgres');
	}
	if (services.cache) {
		servicesToStart.push('redis');
	}
	if (services.mail) {
		servicesToStart.push('mailpit');
	}

	if (servicesToStart.length === 0) {
		return;
	}

	logger.log(`🐳 Starting services: ${servicesToStart.join(', ')}`);

	try {
		// Check if docker-compose.yml exists
		const composeFile = join(workspace.root, 'docker-compose.yml');
		if (!existsSync(composeFile)) {
			logger.warn(
				'⚠️  No docker-compose.yml found. Services will not be started.',
			);
			return;
		}

		// Start services with docker-compose
		execSync(`docker compose up -d ${servicesToStart.join(' ')}`, {
			cwd: workspace.root,
			stdio: 'inherit',
		});

		logger.log('✅ Services started');
	} catch (error) {
		logger.error('❌ Failed to start services:', (error as Error).message);
		throw error;
	}
}

/**
 * Workspace dev command - orchestrates multi-app development using Turbo.
 *
 * Flow:
 * 1. Check for port conflicts
 * 2. Start docker-compose services (db, cache, mail)
 * 3. Generate dependency URLs ({APP_NAME}_URL)
 * 4. Spawn turbo run dev with injected env vars
 */
async function workspaceDevCommand(
	workspace: NormalizedWorkspace,
	options: DevOptions,
): Promise<void> {
	const appCount = Object.keys(workspace.apps).length;
	const backendApps = Object.entries(workspace.apps).filter(
		([_, app]) => app.type === 'backend',
	);
	const frontendApps = Object.entries(workspace.apps).filter(
		([_, app]) => app.type === 'frontend',
	);

	logger.log(`\n🚀 Starting workspace: ${workspace.name}`);
	logger.log(
		`   ${backendApps.length} backend app(s), ${frontendApps.length} frontend app(s)`,
	);

	// Check for port conflicts
	const conflicts = checkPortConflicts(workspace);
	if (conflicts.length > 0) {
		for (const conflict of conflicts) {
			logger.error(
				`❌ Port conflict: Apps "${conflict.app1}" and "${conflict.app2}" both use port ${conflict.port}`,
			);
		}
		throw new Error(
			'Port conflicts detected. Please assign unique ports to each app.',
		);
	}

	// Validate frontend apps (Next.js setup)
	if (frontendApps.length > 0) {
		logger.log('\n🔍 Validating frontend apps...');
		const validationResults = await validateFrontendApps(workspace);

		let hasErrors = false;
		for (const result of validationResults) {
			if (!result.valid) {
				hasErrors = true;
				logger.error(
					`\n❌ Frontend app "${result.appName}" validation failed:`,
				);
				for (const error of result.errors) {
					logger.error(`   • ${error}`);
				}
			}
			for (const warning of result.warnings) {
				logger.warn(`   ⚠️  ${result.appName}: ${warning}`);
			}
		}

		if (hasErrors) {
			throw new Error(
				'Frontend app validation failed. Fix the issues above and try again.',
			);
		}
		logger.log('✅ Frontend apps validated');
	}

	// Generate initial clients for frontends with backend dependencies
	if (frontendApps.length > 0) {
		const clientResults = await generateAllClients(workspace, { force: true });
		const generatedCount = clientResults.filter((r) => r.generated).length;
		if (generatedCount > 0) {
			logger.log(`\n📦 Generated ${generatedCount} API client(s)`);
		}
	}

	// Start docker-compose services
	await startWorkspaceServices(workspace);

	// Load secrets if enabled
	const secretsEnv = await loadDevSecrets(workspace);
	if (Object.keys(secretsEnv).length > 0) {
		logger.log(`   Loaded ${Object.keys(secretsEnv).length} secret(s)`);
	}

	// Generate dependency URLs
	const dependencyEnv = generateAllDependencyEnvVars(workspace);
	if (Object.keys(dependencyEnv).length > 0) {
		logger.log('📡 Dependency URLs:');
		for (const [key, value] of Object.entries(dependencyEnv)) {
			logger.log(`   ${key}=${value}`);
		}
	}

	// Build turbo filter
	let turboFilter: string[] = [];
	if (options.app) {
		// Run specific app
		if (!workspace.apps[options.app]) {
			const appNames = Object.keys(workspace.apps).join(', ');
			throw new Error(
				`App "${options.app}" not found. Available apps: ${appNames}`,
			);
		}
		turboFilter = ['--filter', options.app];
		logger.log(`\n🎯 Running single app: ${options.app}`);
	} else if (options.filter) {
		// Use custom filter
		turboFilter = ['--filter', options.filter];
		logger.log(`\n🔍 Using filter: ${options.filter}`);
	} else {
		// Run all apps
		logger.log(`\n🎯 Running all ${appCount} apps`);
	}

	// List apps and their ports
	const buildOrder = getAppBuildOrder(workspace);
	logger.log('\n📋 Apps (in dependency order):');
	for (const appName of buildOrder) {
		const app = workspace.apps[appName];
		if (!app) continue;
		const deps =
			app.dependencies.length > 0
				? ` (depends on: ${app.dependencies.join(', ')})`
				: '';
		logger.log(
			`   ${app.type === 'backend' ? '🔧' : '🌐'} ${appName} → http://localhost:${app.port}${deps}`,
		);
	}

	// Find the config file path for GKM_CONFIG_PATH
	const configFiles = ['gkm.config.ts', 'gkm.config.js', 'gkm.config.json'];
	let configPath = '';
	for (const file of configFiles) {
		const fullPath = join(workspace.root, file);
		if (existsSync(fullPath)) {
			configPath = fullPath;
			break;
		}
	}

	// Prepare environment variables
	// Order matters: secrets first, then dependencies (dependencies can override)
	const turboEnv: Record<string, string> = {
		...process.env,
		...secretsEnv,
		...dependencyEnv,
		NODE_ENV: 'development',
		// Inject config path so child processes can find the workspace config
		...(configPath ? { GKM_CONFIG_PATH: configPath } : {}),
	};

	// Spawn turbo run dev
	logger.log('\n🏃 Starting turbo run dev...\n');

	const turboProcess = spawn('pnpm', ['turbo', 'run', 'dev', ...turboFilter], {
		cwd: workspace.root,
		stdio: 'inherit',
		env: turboEnv,
	});

	// Set up file watcher for backend endpoint changes (smart client regeneration)
	let endpointWatcher: ReturnType<typeof chokidar.watch> | null = null;

	if (frontendApps.length > 0 && backendApps.length > 0) {
		// Collect all backend route patterns to watch
		const watchPatterns: string[] = [];
		const backendRouteMap = new Map<string, string[]>(); // routes pattern -> backend app names

		for (const [appName, app] of backendApps) {
			const routePatterns = normalizeRoutes(app.routes);
			for (const routePattern of routePatterns) {
				const fullPattern = join(workspace.root, app.path, routePattern);
				watchPatterns.push(fullPattern);

				// Map pattern to app name for change detection
				const patternKey = join(app.path, routePattern);
				const existing = backendRouteMap.get(patternKey) || [];
				backendRouteMap.set(patternKey, [...existing, appName]);
			}
		}

		if (watchPatterns.length > 0) {
			// Resolve glob patterns to files
			const resolvedFiles = await fg(watchPatterns, {
				cwd: workspace.root,
				absolute: true,
				onlyFiles: true,
			});

			if (resolvedFiles.length > 0) {
				logger.log(
					`\n👀 Watching ${resolvedFiles.length} endpoint file(s) for schema changes`,
				);

				endpointWatcher = chokidar.watch(resolvedFiles, {
					ignored: /(^|[/\\])\../,
					persistent: true,
					ignoreInitial: true,
				});

				let regenerateTimeout: NodeJS.Timeout | null = null;

				endpointWatcher.on('change', async (changedPath) => {
					// Debounce regeneration
					if (regenerateTimeout) {
						clearTimeout(regenerateTimeout);
					}

					regenerateTimeout = setTimeout(async () => {
						// Find which backend app this file belongs to
						const changedBackends: string[] = [];

						for (const [appName, app] of backendApps) {
							const routePatterns = normalizeRoutes(app.routes);
							for (const routePattern of routePatterns) {
								const routesDir = join(
									workspace.root,
									app.path,
									routePattern.split('*')[0] || '',
								);
								if (changedPath.startsWith(routesDir.replace(/\/$/, ''))) {
									changedBackends.push(appName);
									break; // Found a match, no need to check other patterns
								}
							}
						}

						if (changedBackends.length === 0) {
							return;
						}

						// Find frontends that depend on changed backends
						const affectedFrontends = new Set<string>();
						for (const backend of changedBackends) {
							const dependents = getDependentFrontends(workspace, backend);
							for (const frontend of dependents) {
								affectedFrontends.add(frontend);
							}
						}

						if (affectedFrontends.size === 0) {
							return;
						}

						// Regenerate clients for affected frontends
						logger.log(
							`\n🔄 Detected schema change in ${changedBackends.join(', ')}`,
						);

						for (const frontend of affectedFrontends) {
							try {
								const results = await generateClientForFrontend(
									workspace,
									frontend,
								);
								for (const result of results) {
									if (result.generated) {
										logger.log(
											`   📦 Regenerated client for ${result.frontendApp} (${result.endpointCount} endpoints)`,
										);
									}
								}
							} catch (error) {
								logger.error(
									`   ❌ Failed to regenerate client for ${frontend}: ${(error as Error).message}`,
								);
							}
						}
					}, 500); // 500ms debounce
				});
			}
		}
	}

	// Handle graceful shutdown
	let isShuttingDown = false;
	const shutdown = () => {
		if (isShuttingDown) return;
		isShuttingDown = true;

		logger.log('\n🛑 Shutting down workspace...');

		// Close endpoint watcher
		if (endpointWatcher) {
			endpointWatcher.close().catch(() => {});
		}

		// Kill turbo process
		if (turboProcess.pid) {
			try {
				// Try to kill the process group
				process.kill(-turboProcess.pid, 'SIGTERM');
			} catch {
				// Fall back to killing just the process
				turboProcess.kill('SIGTERM');
			}
		}

		// Give processes time to clean up
		setTimeout(() => {
			process.exit(0);
		}, 2000);
	};

	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);

	// Wait for turbo to exit
	return new Promise((resolve, reject) => {
		turboProcess.on('error', (error) => {
			logger.error('❌ Turbo error:', error);
			reject(error);
		});

		turboProcess.on('exit', (code) => {
			// Close watcher on exit
			if (endpointWatcher) {
				endpointWatcher.close().catch(() => {});
			}

			if (code !== null && code !== 0) {
				reject(new Error(`Turbo exited with code ${code}`));
			} else {
				resolve();
			}
		});
	});
}

async function buildServer(
	config: any,
	context: BuildContext,
	provider: LegacyProvider,
	enableOpenApi: boolean,
	appRoot: string = process.cwd(),
): Promise<void> {
	// Initialize generators
	const endpointGenerator = new EndpointGenerator();
	const functionGenerator = new FunctionGenerator();
	const cronGenerator = new CronGenerator();
	const subscriberGenerator = new SubscriberGenerator();

	// Load all constructs (resolve paths relative to appRoot)
	const [allEndpoints, allFunctions, allCrons, allSubscribers] =
		await Promise.all([
			endpointGenerator.load(config.routes, appRoot),
			config.functions ? functionGenerator.load(config.functions, appRoot) : [],
			config.crons ? cronGenerator.load(config.crons, appRoot) : [],
			config.subscribers
				? subscriberGenerator.load(config.subscribers, appRoot)
				: [],
		]);

	// Ensure .gkm directory exists in app root
	const outputDir = join(appRoot, '.gkm', provider);
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
		private telescope: NormalizedTelescopeConfig | undefined,
		private studio: NormalizedStudioConfig | undefined,
		private runtime: Runtime = 'node',
		private appRoot: string = process.cwd(),
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
			this.appRoot,
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

		const serverPath = join(this.appRoot, '.gkm', this.provider, 'server.ts');

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
import { createApp } from './${relativeAppPath.startsWith('.') ? relativeAppPath : `./${relativeAppPath}`}';

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
