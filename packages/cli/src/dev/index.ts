import { type ChildProcess, execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import chokidar from 'chokidar';
import { config as dotenvConfig } from 'dotenv';
import fg from 'fast-glob';
import { parse as parseYaml } from 'yaml';
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
	copyAllClients,
	copyClientToFrontends,
	getBackendOpenApiPath,
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
 * A port mapping extracted from docker-compose.yml.
 * Only entries using env var interpolation (e.g., `${VAR:-default}:container`) are captured.
 */
export interface ComposePortMapping {
	service: string;
	envVar: string;
	defaultPort: number;
	containerPort: number;
}

/** Port state persisted to .gkm/ports.json, keyed by env var name. */
export type PortState = Record<string, number>;

export interface ResolvedServicePorts {
	dockerEnv: Record<string, string>;
	ports: PortState;
	mappings: ComposePortMapping[];
}

const PORT_STATE_PATH = '.gkm/ports.json';

/**
 * Parse docker-compose.yml and extract all port mappings that use env var interpolation.
 * Entries like `'${POSTGRES_HOST_PORT:-5432}:5432'` are captured.
 * Fixed port mappings like `'5050:80'` are skipped.
 * @internal Exported for testing
 */
export function parseComposePortMappings(
	composePath: string,
): ComposePortMapping[] {
	if (!existsSync(composePath)) {
		return [];
	}

	const content = readFileSync(composePath, 'utf-8');
	const compose = parseYaml(content) as {
		services?: Record<string, { ports?: string[] }>;
	};

	if (!compose?.services) {
		return [];
	}

	const results: ComposePortMapping[] = [];

	for (const [serviceName, serviceConfig] of Object.entries(
		compose.services,
	)) {
		for (const portMapping of serviceConfig?.ports ?? []) {
			const match = String(portMapping).match(
				/\$\{(\w+):-(\d+)\}:(\d+)/,
			);
			if (match?.[1] && match[2] && match[3]) {
				results.push({
					service: serviceName,
					envVar: match[1],
					defaultPort: Number(match[2]),
					containerPort: Number(match[3]),
				});
			}
		}
	}

	return results;
}

/**
 * Load saved port state from .gkm/ports.json.
 * @internal Exported for testing
 */
export async function loadPortState(
	workspaceRoot: string,
): Promise<PortState> {
	try {
		const raw = await readFile(join(workspaceRoot, PORT_STATE_PATH), 'utf-8');
		return JSON.parse(raw) as PortState;
	} catch {
		return {};
	}
}

/**
 * Save port state to .gkm/ports.json.
 * @internal Exported for testing
 */
export async function savePortState(
	workspaceRoot: string,
	ports: PortState,
): Promise<void> {
	const dir = join(workspaceRoot, '.gkm');
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(workspaceRoot, PORT_STATE_PATH),
		`${JSON.stringify(ports, null, 2)}\n`,
	);
}

/**
 * Check if a project's own Docker container is running and return its host port.
 * Uses `docker compose port` scoped to the project's compose file.
 * @internal Exported for testing
 */
export function getContainerHostPort(
	workspaceRoot: string,
	service: string,
	containerPort: number,
): number | null {
	try {
		const result = execSync(
			`docker compose port ${service} ${containerPort}`,
			{ cwd: workspaceRoot, stdio: 'pipe' },
		)
			.toString()
			.trim();
		const match = result.match(/:(\d+)$/);
		return match ? Number(match[1]) : null;
	} catch {
		return null;
	}
}

/**
 * Resolve host ports for Docker services by parsing docker-compose.yml.
 * Priority: running container → saved state → find available port.
 * Persists resolved ports to .gkm/ports.json.
 * @internal Exported for testing
 */
export async function resolveServicePorts(
	workspaceRoot: string,
): Promise<ResolvedServicePorts> {
	const composePath = join(workspaceRoot, 'docker-compose.yml');
	const mappings = parseComposePortMappings(composePath);

	if (mappings.length === 0) {
		return { dockerEnv: {}, ports: {}, mappings: [] };
	}

	const savedState = await loadPortState(workspaceRoot);
	const dockerEnv: Record<string, string> = {};
	const ports: PortState = {};

	logger.log('\n🔌 Resolving service ports...');

	for (const mapping of mappings) {
		// 1. Check if own container is already running
		const containerPort = getContainerHostPort(
			workspaceRoot,
			mapping.service,
			mapping.containerPort,
		);
		if (containerPort !== null) {
			ports[mapping.envVar] = containerPort;
			dockerEnv[mapping.envVar] = String(containerPort);
			logger.log(
				`   🔄 ${mapping.service}:${mapping.containerPort}: reusing existing container on port ${containerPort}`,
			);
			continue;
		}

		// 2. Check saved port state
		const savedPort = savedState[mapping.envVar];
		if (savedPort && (await isPortAvailable(savedPort))) {
			ports[mapping.envVar] = savedPort;
			dockerEnv[mapping.envVar] = String(savedPort);
			logger.log(
				`   💾 ${mapping.service}:${mapping.containerPort}: using saved port ${savedPort}`,
			);
			continue;
		}

		// 3. Find available port
		const resolvedPort = await findAvailablePort(mapping.defaultPort);
		ports[mapping.envVar] = resolvedPort;
		dockerEnv[mapping.envVar] = String(resolvedPort);

		if (resolvedPort !== mapping.defaultPort) {
			logger.log(
				`   ⚡ ${mapping.service}:${mapping.containerPort}: port ${mapping.defaultPort} occupied, using port ${resolvedPort}`,
			);
		} else {
			logger.log(
				`   ✅ ${mapping.service}:${mapping.containerPort}: using default port ${resolvedPort}`,
			);
		}
	}

	await savePortState(workspaceRoot, ports);

	return { dockerEnv, ports, mappings };
}

/**
 * Replace a port in a URL string.
 * Handles both `hostname:port` and `localhost:port` patterns.
 * @internal Exported for testing
 */
export function replacePortInUrl(
	url: string,
	oldPort: number,
	newPort: number,
): string {
	if (oldPort === newPort) return url;
	return url.replace(
		new RegExp(`:${oldPort}(?=/|$)`, 'g'),
		`:${newPort}`,
	);
}

/**
 * Rewrite connection URLs and port vars in secrets with resolved ports.
 * Uses the parsed compose mappings to determine which default ports to replace.
 * Pure transform — does not modify secrets on disk.
 * @internal Exported for testing
 */
export function rewriteUrlsWithPorts(
	secrets: Record<string, string>,
	resolvedPorts: ResolvedServicePorts,
): Record<string, string> {
	const { ports, mappings } = resolvedPorts;
	const result = { ...secrets };

	// Build a map of defaultPort → resolvedPort for all changed ports
	const portReplacements: { defaultPort: number; resolvedPort: number }[] =
		[];
	for (const mapping of mappings) {
		const resolved = ports[mapping.envVar];
		if (resolved !== undefined) {
			portReplacements.push({
				defaultPort: mapping.defaultPort,
				resolvedPort: resolved,
			});
		}
	}

	// Rewrite _PORT env vars whose values match a default port
	for (const [key, value] of Object.entries(result)) {
		if (!key.endsWith('_PORT')) continue;
		for (const { defaultPort, resolvedPort } of portReplacements) {
			if (value === String(defaultPort)) {
				result[key] = String(resolvedPort);
			}
		}
	}

	// Rewrite URLs containing default ports
	for (const [key, value] of Object.entries(result)) {
		if (!key.endsWith('_URL') && key !== 'DATABASE_URL') continue;

		let rewritten = value;
		for (const { defaultPort, resolvedPort } of portReplacements) {
			rewritten = replacePortInUrl(rewritten, defaultPort, resolvedPort);
		}
		result[key] = rewritten;
	}

	return result;
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
	/** Entry file to run (bypasses gkm config) */
	entry?: string;
	/** Watch for file changes (default: true with --entry) */
	watch?: boolean;
}

export async function devCommand(options: DevOptions): Promise<void> {
	// Handle --entry mode: run any file with secret injection
	if (options.entry) {
		return entryDevCommand(options);
	}

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
	let secretsRoot: string = process.cwd(); // Where .gkm/secrets/ lives
	let workspaceAppName: string | undefined; // Set if in workspace mode
	let workspaceAppPort: number | undefined; // Port from workspace config

	if (appName) {
		// Try to load app-specific config from workspace
		try {
			const appConfig = await loadAppConfig();
			config = appConfig.gkmConfig;
			appRoot = appConfig.appRoot;
			secretsRoot = appConfig.workspaceRoot;
			workspaceAppName = appConfig.appName;
			workspaceAppPort = appConfig.app.port;
			logger.log(
				`📦 Running app: ${appConfig.appName} on port ${workspaceAppPort}`,
			);

			// Check if app has an entry point (non-gkm app like better-auth)
			if (appConfig.app.entry) {
				logger.log(`📄 Using entry point: ${appConfig.app.entry}`);
				return entryDevCommand({
					...options,
					entry: appConfig.app.entry,
					port: workspaceAppPort,
					portExplicit: true,
				});
			}
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

	// Load secrets for dev mode and write to JSON file
	let secretsJsonPath: string | undefined;
	const appSecrets = await loadSecretsForApp(secretsRoot, workspaceAppName);
	if (Object.keys(appSecrets).length > 0) {
		const secretsDir = join(secretsRoot, '.gkm');
		await mkdir(secretsDir, { recursive: true });
		secretsJsonPath = join(secretsDir, 'dev-secrets.json');
		await writeFile(secretsJsonPath, JSON.stringify(appSecrets, null, 2));
		logger.log(`🔐 Loaded ${Object.keys(appSecrets).length} secret(s)`);
	}

	// Start the dev server
	// Priority: explicit --port option > workspace app port > default 3000
	const devServer = new DevServer(
		resolved.providers[0] as LegacyProvider,
		options.port ?? workspaceAppPort ?? 3000,
		options.portExplicit ?? false,
		enableOpenApi,
		telescope,
		studio,
		runtime,
		appRoot,
		secretsJsonPath,
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
 * Load secrets from a path for dev mode.
 * For single app: returns secrets as-is.
 * For workspace app: maps {APP}_DATABASE_URL → DATABASE_URL.
 * @internal Exported for testing
 */
export async function loadSecretsForApp(
	secretsRoot: string,
	appName?: string,
): Promise<Record<string, string>> {
	// Try 'dev' stage first, then 'development'
	const stages = ['dev', 'development'];

	let secrets: Record<string, string> = {};

	for (const stage of stages) {
		if (secretsExist(stage, secretsRoot)) {
			const stageSecrets = await readStageSecrets(stage, secretsRoot);
			if (stageSecrets) {
				logger.log(`🔐 Loading secrets from stage: ${stage}`);
				secrets = toEmbeddableSecrets(stageSecrets);
				break;
			}
		}
	}

	if (Object.keys(secrets).length === 0) {
		return {};
	}

	// Single app mode - no mapping needed
	if (!appName) {
		return secrets;
	}

	// Workspace app mode - map {APP}_* to generic names
	const prefix = appName.toUpperCase();
	const mapped = { ...secrets };

	// Map {APP}_DATABASE_URL → DATABASE_URL
	const appDbUrl = secrets[`${prefix}_DATABASE_URL`];
	if (appDbUrl) {
		mapped.DATABASE_URL = appDbUrl;
	}

	return mapped;
}

/**
 * Start docker-compose services for the workspace.
 * @internal Exported for testing
 */
export async function startWorkspaceServices(
	workspace: NormalizedWorkspace,
	portEnv?: Record<string, string>,
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
			env: { ...process.env, ...portEnv },
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

	// Copy initial clients from backends to frontends
	if (frontendApps.length > 0 && backendApps.length > 0) {
		const clientResults = await copyAllClients(workspace);
		const copiedCount = clientResults.filter((r) => r.success).length;
		if (copiedCount > 0) {
			logger.log(`\n📦 Copied ${copiedCount} API client(s)`);
		}
	}

	// Resolve dynamic service ports from docker-compose.yml
	const resolvedPorts = await resolveServicePorts(workspace.root);

	// Start docker-compose services with resolved ports
	await startWorkspaceServices(workspace, resolvedPorts.dockerEnv);

	// Load secrets if enabled, then rewrite URLs with resolved ports
	const secretsEnv = rewriteUrlsWithPorts(
		await loadDevSecrets(workspace),
		resolvedPorts,
	);
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

	// Set up file watcher for backend .gkm/openapi.ts changes (auto-copy to frontends)
	let openApiWatcher: ReturnType<typeof chokidar.watch> | null = null;

	if (frontendApps.length > 0 && backendApps.length > 0) {
		// Collect all backend openapi.ts file paths to watch
		const openApiPaths: { path: string; appName: string }[] = [];

		for (const [appName] of backendApps) {
			const openApiPath = getBackendOpenApiPath(workspace, appName);
			if (openApiPath) {
				openApiPaths.push({ path: openApiPath, appName });
			}
		}

		if (openApiPaths.length > 0) {
			logger.log(
				`\n👀 Watching ${openApiPaths.length} backend OpenAPI spec(s) for changes`,
			);

			// Create a map for quick lookup of app name from path
			const pathToApp = new Map(openApiPaths.map((p) => [p.path, p.appName]));

			openApiWatcher = chokidar.watch(
				openApiPaths.map((p) => p.path),
				{
					persistent: true,
					ignoreInitial: true,
					// Watch parent directory too since file may not exist yet
					depth: 0,
				},
			);

			let copyTimeout: NodeJS.Timeout | null = null;

			const handleChange = async (changedPath: string) => {
				// Debounce to handle rapid changes
				if (copyTimeout) {
					clearTimeout(copyTimeout);
				}

				copyTimeout = setTimeout(async () => {
					const backendAppName = pathToApp.get(changedPath);
					if (!backendAppName) {
						return;
					}

					logger.log(`\n🔄 OpenAPI spec changed for ${backendAppName}`);

					try {
						const results = await copyClientToFrontends(
							workspace,
							backendAppName,
							{ silent: true },
						);
						for (const result of results) {
							if (result.success) {
								logger.log(
									`   📦 Copied client to ${result.frontendApp} (${result.endpointCount} endpoints)`,
								);
							} else if (result.error) {
								logger.error(
									`   ❌ Failed to copy client to ${result.frontendApp}: ${result.error}`,
								);
							}
						}
					} catch (error) {
						logger.error(
							`   ❌ Failed to copy clients: ${(error as Error).message}`,
						);
					}
				}, 200); // 200ms debounce
			};

			openApiWatcher.on('change', handleChange);
			openApiWatcher.on('add', handleChange);
		}
	}

	// Handle graceful shutdown
	let isShuttingDown = false;
	const shutdown = () => {
		if (isShuttingDown) return;
		isShuttingDown = true;

		logger.log('\n🛑 Shutting down workspace...');

		// Close OpenAPI watcher
		if (openApiWatcher) {
			openApiWatcher.close().catch(() => {});
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
			if (openApiWatcher) {
				openApiWatcher.close().catch(() => {});
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

/**
 * Find the directory containing .gkm/secrets/.
 * Walks up from cwd until it finds one, or returns cwd.
 * @internal Exported for testing
 */
export function findSecretsRoot(startDir: string): string {
	let dir = startDir;
	while (dir !== '/') {
		if (existsSync(join(dir, '.gkm', 'secrets'))) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return startDir;
}

/**
 * Generate the credentials injection code snippet.
 * This is the common logic used by both entry wrapper and exec preload.
 * @internal
 */
function generateCredentialsInjection(secretsJsonPath: string): string {
	return `import { Credentials } from '@geekmidas/envkit/credentials';
import { existsSync, readFileSync } from 'node:fs';

// Inject dev secrets into Credentials and process.env
const secretsPath = '${secretsJsonPath}';
if (existsSync(secretsPath)) {
  const secrets = JSON.parse(readFileSync(secretsPath, 'utf-8'));
  Object.assign(Credentials, secrets);
  Object.assign(process.env, secrets);
  // Debug: uncomment to verify preload is running
  // console.log('[gkm preload] Injected', Object.keys(secrets).length, 'credentials');
}
`;
}

/**
 * Create a preload script that injects secrets into Credentials.
 * Used by `gkm exec` to inject secrets before running any command.
 * @internal Exported for testing
 */
export async function createCredentialsPreload(
	preloadPath: string,
	secretsJsonPath: string,
): Promise<void> {
	const content = `/**
 * Credentials preload generated by 'gkm exec'
 * This file is loaded via NODE_OPTIONS="--import <path>"
 */
${generateCredentialsInjection(secretsJsonPath)}`;

	await writeFile(preloadPath, content);
}

/**
 * Create a wrapper script that injects secrets before importing the entry file.
 * @internal Exported for testing
 */
export async function createEntryWrapper(
	wrapperPath: string,
	entryPath: string,
	secretsJsonPath?: string,
): Promise<void> {
	const credentialsInjection = secretsJsonPath
		? `${generateCredentialsInjection(secretsJsonPath)}
`
		: '';

	// Use dynamic import() to ensure secrets are assigned before the entry file loads
	// Static imports are hoisted, so Object.assign would run after the entry file is loaded
	const content = `#!/usr/bin/env node
/**
 * Entry wrapper generated by 'gkm dev --entry'
 */
${credentialsInjection}// Import and run the user's entry file (dynamic import ensures secrets load first)
await import('${entryPath}');
`;

	await writeFile(wrapperPath, content);
}

/**
 * Result of preparing entry credentials for dev mode.
 */
export interface EntryCredentialsResult {
	/** Credentials to inject (secrets + PORT) */
	credentials: Record<string, string>;
	/** Resolved port (from --port, workspace config, or default 3000) */
	resolvedPort: number;
	/** Path where credentials JSON was written */
	secretsJsonPath: string;
	/** Resolved app name (if in workspace) */
	appName: string | undefined;
	/** Secrets root directory */
	secretsRoot: string;
}

/**
 * Prepare credentials for entry dev mode.
 * Loads workspace config, secrets, and injects PORT.
 * @internal Exported for testing
 */
export async function prepareEntryCredentials(options: {
	explicitPort?: number;
	cwd?: string;
}): Promise<EntryCredentialsResult> {
	const cwd = options.cwd ?? process.cwd();

	// Try to get workspace app config for port and secrets
	let workspaceAppPort: number | undefined;
	let secretsRoot: string = cwd;
	let appName: string | undefined;

	try {
		const appConfig = await loadAppConfig(cwd);
		workspaceAppPort = appConfig.app.port;
		secretsRoot = appConfig.workspaceRoot;
		appName = appConfig.appName;
	} catch (error) {
		// Not in a workspace - use defaults
		logger.log(
			`⚠️  Could not load workspace config: ${(error as Error).message}`,
		);
		secretsRoot = findSecretsRoot(cwd);
		appName = getAppNameFromCwd(cwd) ?? undefined;
	}

	// Determine port: explicit --port > workspace config > default 3000
	const resolvedPort = options.explicitPort ?? workspaceAppPort ?? 3000;

	// Load secrets and inject PORT
	const credentials = await loadSecretsForApp(secretsRoot, appName);

	// Always inject PORT into credentials so apps can read it
	credentials.PORT = String(resolvedPort);

	// Write secrets to temp JSON file (always write since we have PORT)
	// Use app-specific filename to avoid race conditions when running multiple apps via turbo
	const secretsDir = join(secretsRoot, '.gkm');
	await mkdir(secretsDir, { recursive: true });
	const secretsFileName = appName
		? `dev-secrets-${appName}.json`
		: 'dev-secrets.json';
	const secretsJsonPath = join(secretsDir, secretsFileName);
	await writeFile(secretsJsonPath, JSON.stringify(credentials, null, 2));

	return {
		credentials,
		resolvedPort,
		secretsJsonPath,
		appName,
		secretsRoot,
	};
}

/**
 * Run any TypeScript file with secret injection.
 * Does not require gkm.config.ts.
 */
async function entryDevCommand(options: DevOptions): Promise<void> {
	const { entry, watch = true } = options;

	if (!entry) {
		throw new Error('--entry requires a file path');
	}

	const entryPath = resolve(process.cwd(), entry);

	if (!existsSync(entryPath)) {
		throw new Error(`Entry file not found: ${entryPath}`);
	}

	// Load .env files
	const defaultEnv = loadEnvFiles('.env');
	if (defaultEnv.loaded.length > 0) {
		logger.log(`📦 Loaded env: ${defaultEnv.loaded.join(', ')}`);
	}

	// Prepare credentials (loads workspace config, secrets, injects PORT)
	// Only pass explicitPort if --port was actually specified by the user
	const { credentials, resolvedPort, secretsJsonPath, appName } =
		await prepareEntryCredentials({
			explicitPort: options.portExplicit ? options.port : undefined,
		});

	if (appName) {
		logger.log(`📦 App: ${appName} (port ${resolvedPort})`);
	}

	logger.log(`🚀 Starting entry file: ${entry} on port ${resolvedPort}`);

	if (Object.keys(credentials).length > 1) {
		logger.log(
			`🔐 Loaded ${Object.keys(credentials).length - 1} secret(s) + PORT`,
		);
	}

	// Create wrapper entry that injects secrets before importing user's file
	const wrapperDir = join(process.cwd(), '.gkm');
	await mkdir(wrapperDir, { recursive: true });
	const wrapperPath = join(wrapperDir, 'entry-wrapper.ts');
	await createEntryWrapper(wrapperPath, entryPath, secretsJsonPath);

	// Start with tsx
	const runner = new EntryRunner(wrapperPath, entryPath, watch, resolvedPort);
	await runner.start();

	// Handle graceful shutdown
	let isShuttingDown = false;
	const shutdown = () => {
		if (isShuttingDown) return;
		isShuttingDown = true;

		logger.log('\n🛑 Shutting down...');
		runner.stop();
		process.exit(0);
	};

	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);

	// Keep the process alive
	await new Promise(() => {});
}

/**
 * Runs and watches a TypeScript entry file using tsx.
 */
class EntryRunner {
	private childProcess: ChildProcess | null = null;
	private watcher: ReturnType<typeof chokidar.watch> | null = null;
	private isRunning = false;

	constructor(
		private wrapperPath: string,
		private entryPath: string,
		private watch: boolean,
		private port: number,
	) {}

	async start(): Promise<void> {
		await this.runProcess();

		if (this.watch) {
			// Watch the entry file's directory for changes
			const watchDir = dirname(this.entryPath);

			this.watcher = chokidar.watch(watchDir, {
				ignored: /(^|[/\\])\../,
				persistent: true,
				ignoreInitial: true,
			});

			let restartTimeout: NodeJS.Timeout | null = null;

			this.watcher.on('change', (path) => {
				logger.log(`📝 File changed: ${path}`);

				// Debounce restarts
				if (restartTimeout) {
					clearTimeout(restartTimeout);
				}

				restartTimeout = setTimeout(async () => {
					logger.log('🔄 Restarting...');
					await this.restart();
				}, 300);
			});

			logger.log(`👀 Watching for changes in: ${watchDir}`);
		}
	}

	private async runProcess(): Promise<void> {
		// Pass PORT as environment variable
		const env = { ...process.env, PORT: String(this.port) };

		this.childProcess = spawn('npx', ['tsx', this.wrapperPath], {
			stdio: 'inherit',
			env,
			detached: true,
		});

		this.isRunning = true;

		this.childProcess.on('error', (error) => {
			logger.error('❌ Process error:', error);
		});

		this.childProcess.on('exit', (code) => {
			if (code !== null && code !== 0 && code !== 143) {
				// 143 = SIGTERM
				logger.error(`❌ Process exited with code ${code}`);
			}
			this.isRunning = false;
		});

		// Give the process a moment to start
		await new Promise((resolve) => setTimeout(resolve, 500));

		if (this.isRunning) {
			logger.log(`\n🎉 Running at http://localhost:${this.port}`);
		}
	}

	async restart(): Promise<void> {
		this.stopProcess();
		await new Promise((resolve) => setTimeout(resolve, 500));
		await this.runProcess();
	}

	stop(): void {
		this.watcher?.close();
		this.stopProcess();
	}

	private stopProcess(): void {
		if (this.childProcess && this.isRunning) {
			const pid = this.childProcess.pid;
			if (pid) {
				try {
					process.kill(-pid, 'SIGTERM');
				} catch {
					try {
						process.kill(pid, 'SIGTERM');
					} catch {
						// Process already dead
					}
				}
			}
			this.childProcess = null;
			this.isRunning = false;
		}
	}
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
		private secretsJsonPath?: string,
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
		const { writeFile: fsWriteFile } = await import('node:fs/promises');
		const { relative, dirname } = await import('node:path');

		const serverPath = join(this.appRoot, '.gkm', this.provider, 'server.ts');

		const relativeAppPath = relative(
			dirname(serverPath),
			join(dirname(serverPath), 'app.js'),
		);

		// Generate credentials injection code if secrets are available
		const credentialsInjection = this.secretsJsonPath
			? `import { Credentials } from '@geekmidas/envkit/credentials';
import { existsSync, readFileSync } from 'node:fs';

// Inject dev secrets into Credentials (must happen before app import)
const secretsPath = '${this.secretsJsonPath}';
if (existsSync(secretsPath)) {
  Object.assign(Credentials, JSON.parse(readFileSync(secretsPath, 'utf-8')));
}

`
			: '';

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
${credentialsInjection}import { createApp } from './${relativeAppPath.startsWith('.') ? relativeAppPath : `./${relativeAppPath}`}';

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

		await fsWriteFile(serverPath, content);
	}
}

/**
 * Options for the exec command.
 */
export interface ExecOptions {
	/** Working directory */
	cwd?: string;
}

/**
 * Run a command with secrets injected into Credentials.
 * Uses Node's --import flag to preload a script that populates Credentials
 * before the command loads any modules that depend on them.
 *
 * @example
 * ```bash
 * gkm exec -- npx @better-auth/cli migrate
 * gkm exec -- npx prisma migrate dev
 * ```
 */
export async function execCommand(
	commandArgs: string[],
	options: ExecOptions = {},
): Promise<void> {
	const cwd = options.cwd ?? process.cwd();

	if (commandArgs.length === 0) {
		throw new Error('No command specified. Usage: gkm exec -- <command>');
	}

	// Load .env files
	const defaultEnv = loadEnvFiles('.env');
	if (defaultEnv.loaded.length > 0) {
		logger.log(`📦 Loaded env: ${defaultEnv.loaded.join(', ')}`);
	}

	// Prepare credentials (loads workspace config and secrets)
	// Don't inject PORT for exec since we're not running a server
	const { credentials, secretsJsonPath, appName, secretsRoot } =
		await prepareEntryCredentials({ cwd });

	if (appName) {
		logger.log(`📦 App: ${appName}`);
	}

	const secretCount = Object.keys(credentials).filter(
		(k) => k !== 'PORT',
	).length;
	if (secretCount > 0) {
		logger.log(`🔐 Loaded ${secretCount} secret(s)`);
	}

	// Rewrite URLs with resolved Docker ports (from gkm dev)
	const composePath = join(secretsRoot, 'docker-compose.yml');
	const mappings = parseComposePortMappings(composePath);
	if (mappings.length > 0) {
		const ports = await loadPortState(secretsRoot);
		if (Object.keys(ports).length > 0) {
			const rewritten = rewriteUrlsWithPorts(credentials, {
				dockerEnv: {},
				ports,
				mappings,
			});
			Object.assign(credentials, rewritten);
			logger.log(`🔌 Applied ${Object.keys(ports).length} port mapping(s)`);
		}
	}

	// Inject dependency URLs
	try {
		const appConfig = await loadAppConfig(cwd);
		if (appConfig.appName) {
			const depEnv = getDependencyEnvVars(
				appConfig.workspace,
				appConfig.appName,
			);
			Object.assign(credentials, depEnv);
		}
	} catch {
		// Not in a workspace — skip dependency URL injection
	}

	// Create preload script that injects Credentials
	// Create in cwd so package resolution works (finds node_modules in app directory)
	const preloadDir = join(cwd, '.gkm');
	await mkdir(preloadDir, { recursive: true });
	const preloadPath = join(preloadDir, 'credentials-preload.ts');
	await createCredentialsPreload(preloadPath, secretsJsonPath);

	// Build command
	const [cmd, ...rawArgs] = commandArgs;

	if (!cmd) {
		throw new Error('No command specified');
	}

	// Replace template variables in command args (e.g. $PORT -> resolved port)
	const args = rawArgs.map((arg) =>
		arg.replace(/\$PORT\b/g, credentials.PORT ?? '3000'),
	);

	logger.log(`🚀 Running: ${[cmd, ...args].join(' ')}`);

	// Merge NODE_OPTIONS with existing value (if any)
	// Add tsx loader first so our .ts preload can be loaded
	const existingNodeOptions = process.env.NODE_OPTIONS ?? '';
	const tsxImport = '--import=tsx';
	const preloadImport = `--import=${preloadPath}`;

	// Build NODE_OPTIONS: existing + tsx loader + our preload
	const nodeOptions = [existingNodeOptions, tsxImport, preloadImport]
		.filter(Boolean)
		.join(' ');

	// Spawn the command with secrets in both:
	// 1. Environment variables (for tools that read process.env directly)
	// 2. Preload script (for tools that use Credentials object)
	const child = spawn(cmd, args, {
		cwd,
		stdio: 'inherit',
		env: {
			...process.env,
			...credentials, // Inject secrets as env vars
			NODE_OPTIONS: nodeOptions,
		},
	});

	// Wait for the command to complete
	const exitCode = await new Promise<number>((resolve) => {
		child.on('close', (code: number | null) => resolve(code ?? 0));
		child.on('error', (error: Error) => {
			logger.error(`Failed to run command: ${error.message}`);
			resolve(1);
		});
	});

	if (exitCode !== 0) {
		process.exit(exitCode);
	}
}
