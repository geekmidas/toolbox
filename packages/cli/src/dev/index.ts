import { type ChildProcess, execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import chokidar from 'chokidar';
import fg from 'fast-glob';
import { appPackageName, buildApp, turboFilters } from '../build/index';
import { resolveProviders } from '../build/providerResolver';
import type {
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
	createEntryWrapper,
	findAvailablePort,
	isPortAvailable,
	loadEnvFiles,
	loadSecretsForApp,
	prepareEntryCredentials,
} from '../credentials';
import { OPENAPI_OUTPUT_PATH, resolveOpenApiConfig } from '../openapi';
import { reconcileWorkspace } from '../reconcile/workspace.js';
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
import { cacheBackendFor, providerOf } from '../workspace/backends.js';
import {
	type FrontendFramework,
	getAppBuildOrder,
	type MobileFramework,
	type NormalizedWorkspace,
} from '../workspace/index.js';

// Re-export shared utilities from credentials module so existing imports
// from '../dev' or '../dev/index' continue to work.
export {
	createCredentialsPreload,
	createEntryWrapper,
	type EntryCredentialsResult,
	findAvailablePort,
	findSecretsRoot,
	isPortAvailable,
	loadEnvFiles,
	loadPortState,
	loadSecretsForApp,
	type PortState,
	prepareEntryCredentials,
	savePortState,
} from '../credentials';

// Re-export execCommand from its own module
export { type ExecOptions, execCommand } from '../exec';

const logger = console;

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
	let workspace: NormalizedWorkspace | undefined; // Set if in workspace mode

	if (appName) {
		// Try to load app-specific config from workspace
		try {
			const appConfig = await loadAppConfig();
			config = appConfig.gkmConfig;
			appRoot = appConfig.appRoot;
			secretsRoot = appConfig.workspaceRoot;
			workspaceAppName = appConfig.appName;
			workspaceAppPort = appConfig.app.port;
			workspace = appConfig.workspace;
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
			workspace = loadedConfig.workspace;
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
		// Wrapped as a one-app workspace, which is what reconcile reads. Nothing
		// below depends on an app name, so this only turns on the parts that need
		// a workspace at all.
		workspace = loadedConfig.workspace;
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
	logger.log(`Loading constructs from: ${config.constructs}`);

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

	// The build's own pipeline, for the server target: what dev runs is what
	// `gkm build` would have generated, never a second reading of the same
	// constructs.
	const build = (bustCache = false) =>
		buildApp({
			config,
			// Where a surface's `path` is measured from, so the build can tell
			// which surface this app serves.
			workspaceRoot: workspace?.root ?? secretsRoot,
			appRoot,
			providers: ['server'],
			enableOpenApi,
			cacheBackend: cacheBackendFor(providerOf(workspace ?? config)),
			telescope,
			studio,
			hooks,
			skipBundle: true,
			bustCache,
			serveEmpty: true,
		});

	// Build initial version
	const initial = await build();

	// Determine runtime (default to node)
	const runtime: Runtime = config.runtime ?? 'node';

	// Load secrets for dev mode, resolve every declared address, and write to
	// JSON file
	let secretsJsonPath: string | undefined;
	const appSecrets = await loadSecretsForApp(
		secretsRoot,
		config.stages.local,
		workspaceAppName,
	);

	if (workspace) {
		// The same reconcile `gkm setup` and the workspace dev path run: derive
		// the containers from what the app declares, start them, create what the
		// URLs name, and inject those URLs.
		const reconciled = await reconcileWorkspace(workspace, {
			stage: workspace.stages.local,
		});

		if (reconciled.changed && reconciled.plan.containers.length > 0) {
			logger.log(`🐳 Services: ${reconciled.plan.containers.join(', ')}`);
			for (const [container, address] of Object.entries(reconciled.addresses)) {
				logger.log(`   ${container}: ${address}`);
			}
		}

		// Declared URLs win over anything sniffed or stored — the manifest is the
		// statement of what exists.
		Object.assign(appSecrets, reconciled.env);
	}

	if (Object.keys(appSecrets).length > 0) {
		const secretsDir = join(secretsRoot, '.gkm');
		await mkdir(secretsDir, { recursive: true });
		const secretsFileName = workspaceAppName
			? `dev-secrets-${workspaceAppName}.json`
			: 'dev-secrets.json';
		secretsJsonPath = join(secretsDir, secretsFileName);
		await writeFile(secretsJsonPath, JSON.stringify(appSecrets, null, 2));
		logger.log(`🔐 Loaded ${Object.keys(appSecrets).length} secret(s)`);
	}

	// Start the dev server
	// Priority: explicit --port option > workspace app port > default 3000
	const devServer = new DevServer(
		resolved.providers[0] as LegacyProvider,
		options.port ?? workspaceAppPort ?? 3000,
		// A workspace's port is as fixed as one passed with --port: every other
		// app's URL, CORS list and cookie domain names it. Drifting to the next
		// free port served the app where nothing points — and in a workspace the
		// next free port is usually another app's.
		options.portExplicit ?? workspaceAppPort !== undefined,
		enableOpenApi,
		telescope,
		studio,
		runtime,
		appRoot,
		secretsJsonPath,
		initial.selfServing !== undefined,
	);

	await devServer.start();

	// Watch for file changes
	// Get hooks file path for watching
	const hooksFileParts = config.hooks?.server?.split('#');
	const hooksFile = hooksFileParts?.[0];

	// One glob to watch, the same one the build loads from. The logger and the
	// environment parser are inside it — they are constructs now, not module
	// paths beside the code.
	const watchPatterns = [
		config.constructs,
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
				// Bust the module cache: the edit is what the rebuild is for.
				const rebuilt = await build(true);

				logger.log('✅ Rebuild complete, restarting server...');
				devServer.selfServing = rebuilt.selfServing !== undefined;
				await devServer.restart();
			} catch (error) {
				const err = error as Error;
				logger.error(`❌ Rebuild failed: ${err.message}`);
				if (err.stack) {
					logger.error(err.stack);
				}
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
 * A framework the dev server starts an app with.
 *
 * Expo is a mobile framework, not a frontend one, but it is detected and
 * validated here the same way — so the union is what this table is keyed by.
 * It used to be keyed by `FrontendFramework` alone, with the Expo entry typed
 * as an excess property and the one call site casting around it.
 */
type ClientFramework = FrontendFramework | MobileFramework;

/**
 * Per-framework validation spec for the frameworks the dev server supports.
 */
interface FrontendFrameworkSpec {
	displayName: string;
	configFiles: string[];
	dependency: string;
	installCommand: string;
}

const FRONTEND_FRAMEWORKS: Record<ClientFramework, FrontendFrameworkSpec> = {
	nextjs: {
		displayName: 'Next.js',
		configFiles: [
			'next.config.js',
			'next.config.ts',
			'next.config.mjs',
			'next.config.cjs',
		],
		dependency: 'next',
		installCommand: 'pnpm add next react react-dom',
	},
	remix: {
		displayName: 'Remix',
		configFiles: [
			'remix.config.js',
			'remix.config.mjs',
			'remix.config.ts',
			'vite.config.js',
			'vite.config.ts',
			'vite.config.mjs',
			'vite.config.cjs',
		],
		dependency: '@remix-run/dev',
		installCommand: 'pnpm add -D @remix-run/dev',
	},
	vite: {
		displayName: 'Vite',
		configFiles: [
			'vite.config.js',
			'vite.config.ts',
			'vite.config.mjs',
			'vite.config.cjs',
		],
		dependency: 'vite',
		installCommand: 'pnpm add -D vite',
	},
	'tanstack-start': {
		displayName: 'TanStack Start',
		configFiles: [
			'vite.config.js',
			'vite.config.ts',
			'vite.config.mjs',
			'vite.config.cjs',
		],
		dependency: '@tanstack/react-start',
		installCommand: 'pnpm add @tanstack/react-start @tanstack/react-router',
	},
	expo: {
		displayName: 'Expo',
		configFiles: ['app.config.ts', 'app.config.js', 'app.json'],
		dependency: 'expo',
		installCommand: 'pnpm add expo',
	},
};

/** Whether a configured framework is one this table knows how to start. */
function isClientFramework(
	framework: string | undefined,
): framework is ClientFramework {
	return framework !== undefined && framework in FRONTEND_FRAMEWORKS;
}

/**
 * Auto-detect the frontend framework by scanning package.json deps and config
 * files. Dependency match wins over config file match because deps are more
 * distinctive (a Remix app has both vite.config.ts AND @remix-run/dev).
 */
function detectFrontendFramework(
	fullPath: string,
	deps: Record<string, string>,
): ClientFramework | undefined {
	// tanstack-start before vite/remix so its more specific dep wins; vite last
	// because plain vite is the fallback when neither nextjs/remix/tanstack match.
	// Order matters: more specific deps win over general ones.
	// expo first (own dep), then tanstack-start (uses vite), remix (uses vite),
	// nextjs (own dep), and plain vite last as the fallback.
	const order: ClientFramework[] = [
		'expo',
		'tanstack-start',
		'nextjs',
		'remix',
		'vite',
	];
	for (const name of order) {
		if (deps[FRONTEND_FRAMEWORKS[name].dependency]) {
			return name;
		}
	}
	for (const name of order) {
		const hasConfig = FRONTEND_FRAMEWORKS[name].configFiles.some((file) =>
			existsSync(join(fullPath, file)),
		);
		if (hasConfig) {
			return name;
		}
	}
	return undefined;
}

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
 * Validate a frontend app configuration.
 *
 * If `framework` is provided, validates strictly against that framework's
 * expected config file and dependency. Otherwise auto-detects the framework
 * from package.json and config files. If no recognized framework is found, the
 * app is allowed through with a warning provided it has a `dev` script.
 *
 * @internal Exported for testing
 */
export async function validateFrontendApp(
	appName: string,
	appPath: string,
	workspaceRoot: string,
	framework?: ClientFramework,
): Promise<FrontendValidationResult> {
	const errors: string[] = [];
	const warnings: string[] = [];
	const fullPath = join(workspaceRoot, appPath);

	const packageJsonPath = join(fullPath, 'package.json');
	if (!existsSync(packageJsonPath)) {
		errors.push(
			`package.json not found at ${appPath}. Run: pnpm init in the app directory.`,
		);
		return { appName, valid: false, errors, warnings };
	}

	let pkg: {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
		scripts?: Record<string, string>;
	};
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		pkg = require(packageJsonPath);
	} catch {
		errors.push(`Failed to read package.json at ${packageJsonPath}`);
		return { appName, valid: false, errors, warnings };
	}

	const deps: Record<string, string> = {
		...pkg.dependencies,
		...pkg.devDependencies,
	};

	const resolvedFramework =
		framework ?? detectFrontendFramework(fullPath, deps);

	if (resolvedFramework) {
		const spec = FRONTEND_FRAMEWORKS[resolvedFramework];
		const hasConfig = spec.configFiles.some((file) =>
			existsSync(join(fullPath, file)),
		);
		if (!hasConfig) {
			errors.push(
				`${spec.displayName} config file not found. Expected one of: ${spec.configFiles.join(', ')}`,
			);
		}
		if (!deps[spec.dependency]) {
			errors.push(
				`${spec.displayName} not found in dependencies. Run: ${spec.installCommand}`,
			);
		}
	} else {
		warnings.push(
			'No recognized frontend framework detected (Next.js, Vite, Remix). ' +
				'The app will run via its "dev" script. Set `framework` in your app config to enable strict validation.',
		);
	}

	if (!pkg.scripts?.dev) {
		if (resolvedFramework) {
			warnings.push(
				'No "dev" script found in package.json. Turbo expects a "dev" script to run.',
			);
		} else {
			errors.push(
				'No "dev" script found in package.json. Without a recognized framework or a dev script, there is nothing to run.',
			);
		}
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
		if (app.type === 'web') {
			const result = await validateFrontendApp(
				appName,
				app.path,
				workspace.root,
				isClientFramework(app.framework) ? app.framework : undefined,
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

	const stage = workspace.stages.local;
	if (secretsExist(stage, workspace.root)) {
		const secrets = await readStageSecrets(stage, workspace.root);
		if (secrets) {
			logger.log(`🔐 Loading secrets from stage: ${stage}`);
			return toEmbeddableSecrets(secrets);
		}
	}

	logger.warn(
		`⚠️  Secrets enabled but no "${stage}" secrets found. Run "gkm setup" to initialize the local stage`,
	);
	return {};
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
		([_, app]) => app.type === 'web',
	);
	const mobileApps = Object.entries(workspace.apps).filter(
		([_, app]) => app.type === 'mobile',
	);

	logger.log(`\n🚀 Starting workspace: ${workspace.name}`);
	const counts = [
		`${backendApps.length} backend`,
		`${frontendApps.length} web`,
	];
	if (mobileApps.length > 0) counts.push(`${mobileApps.length} mobile`);
	logger.log(`   ${counts.join(', ')} app(s)`);

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

	// Frontend apps import API clients directly from backend packages
	// (e.g. import { createApi } from '@myapp/api/client')
	// No file copying needed — pnpm workspace resolution handles it.

	const rawSecrets = await loadDevSecrets(workspace);

	// Derive the containers from what the apps declare, start them, create what
	// the URLs name, and inject those URLs. Safe to do on every start because
	// the blast radius is this project's containers and `.gkm/`, and because the
	// converged case costs one hash and one health check.
	const reconciled = await reconcileWorkspace(workspace, {
		stage: workspace.stages.local,
	});

	if (reconciled.changed && reconciled.plan.containers.length > 0) {
		logger.log(`🐳 Services: ${reconciled.plan.containers.join(', ')}`);
		for (const [container, address] of Object.entries(reconciled.addresses)) {
			logger.log(`   ${container}: ${address}`);
		}
	}

	const secretsEnv: Record<string, string> = {
		...rawSecrets,
		...reconciled.env,
	};

	// Where each app answers, behind the edge — the addresses the apps were just
	// given, rather than their ports.
	const appUrls: Record<string, string> = {};
	for (const resource of reconciled.plan.resources) {
		if (resource.kind !== 'rest-api' && resource.kind !== 'site') continue;
		const address = reconciled.env[resource.envKey];
		if (address) appUrls[resource.id] = address;
	}

	if (Object.keys(secretsEnv).length > 0) {
		logger.log(`   Loaded ${Object.keys(secretsEnv).length} secret(s)`);
	}

	if (Object.keys(appUrls).length > 0) {
		logger.log('🔒 App URLs:');
		for (const [id, address] of Object.entries(appUrls)) {
			logger.log(`   ${id}: ${address}`);
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
		turboFilter = [
			'--filter',
			appPackageName(workspace, options.app) ?? options.app,
		];
		logger.log(`\n🎯 Running single app: ${options.app}`);
	} else if (options.filter) {
		// Use custom filter
		turboFilter = ['--filter', options.filter];
		logger.log(`\n🔍 Using filter: ${options.filter}`);
	} else {
		// Every app, by name. Left to infer its own scope at the workspace root,
		// turbo includes the root package — whose `dev` script is `gkm dev`,
		// which arrives here and starts turbo again, and every app twice over.
		// `gkm build` names its apps for the same reason.
		const { filters, unpackaged } = turboFilters(workspace);
		turboFilter = filters.flatMap((name) => ['--filter', name]);
		if (unpackaged.length > 0) {
			logger.warn(
				`⚠️  No package.json with a name for: ${unpackaged.join(', ')} — turbo cannot run ${unpackaged.length === 1 ? 'it' : 'them'}.`,
			);
		}
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
		const icon =
			app.type === 'backend' ? '🔧' : app.type === 'mobile' ? '📱' : '🌐';
		logger.log(`   ${icon} ${appName} → http://localhost:${app.port}${deps}`);
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
		NODE_ENV: 'development',
		// Inject config path so child processes can find the workspace config
		...(configPath ? { GKM_CONFIG_PATH: configPath } : {}),
	};

	// Every app's port, before anything starts. Each app checks its own as it
	// starts too, but by then turbo has launched the rest, and a port held by a
	// server a previous run left behind fails one app while the others run.
	const scoped = options.app
		? [options.app]
		: options.filter
			? []
			: Object.keys(workspace.apps);
	const held: { app: string; port: number; holder: string | undefined }[] = [];
	for (const appName of scoped) {
		const port = workspace.apps[appName]?.port;
		if (port && !(await isPortAvailable(port))) {
			held.push({ app: appName, port, holder: listenerOn(port) });
		}
	}
	if (held.length > 0) throw new WorkspacePortsInUse(held);

	// Spawn turbo run dev
	logger.log('\n🏃 Starting turbo run dev...\n');

	const turboProcess = spawn('pnpm', ['turbo', 'run', 'dev', ...turboFilter], {
		cwd: workspace.root,
		stdio: 'inherit',
		env: turboEnv,
		detached: true,
	});

	// No file watcher needed — frontend apps import API clients directly
	// from backend packages via workspace dependencies.

	// Handle graceful shutdown
	let isShuttingDown = false;
	const shutdown = () => {
		if (isShuttingDown) return;
		isShuttingDown = true;

		logger.log('\n🛑 Shutting down workspace...');

		// Kill turbo process group
		const pid = turboProcess.pid;
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

		// Force kill after timeout if processes are still alive
		setTimeout(() => {
			if (pid) {
				try {
					process.kill(-pid, 'SIGKILL');
				} catch {
					try {
						process.kill(pid, 'SIGKILL');
					} catch {
						// Process already dead
					}
				}
			}
			process.exit(0);
		}, 3000);
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
			if (code !== null && code !== 0) {
				reject(new Error(`Turbo exited with code ${code}`));
			} else {
				resolve();
			}
		});
	});
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
			logger.log('');
			logger.log(
				`  \x1b[32m✓ Ready\x1b[0m at \x1b[36mhttp://localhost:${this.port}\x1b[0m`,
			);
			logger.log('');
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

/**
 * Generate the content of the dev server entry file (server.ts).
 * Uses dynamic import for createApp so Credentials are populated
 * before any app modules evaluate.
 * @internal Exported for testing
 */
export function generateServerEntryContent(options: {
	secretsJsonPath?: string;
	runtime?: Runtime;
	enableOpenApi?: boolean;
	appImportPath?: string;
	/**
	 * `app.ts` is a surface serving itself — it exports the construct's own
	 * `app`, with no `createApp` around it to start.
	 */
	selfServing?: boolean;
}): string {
	const {
		secretsJsonPath,
		runtime = 'node',
		enableOpenApi = false,
		appImportPath = './app.js',
		selfServing = false,
	} = options;

	// Exit with the `gkm dev` that started this server. Dev stops it on a
	// signal, but a dev process killed outright — SIGKILL, a closed terminal, a
	// crashed parent — never gets to, and the server kept its port: the next
	// `gkm dev` found it taken and started somewhere nothing points at.
	const parentWatch = `// Exit when the gkm dev that started this server is gone.
const __gkmDevPid = Number(process.env.GKM_DEV_PID);
if (__gkmDevPid) {
  setInterval(() => {
    try {
      process.kill(__gkmDevPid, 0);
    } catch {
      process.exit(0);
    }
  }, 1000).unref();
}

`;

	const credentialsInjection = secretsJsonPath
		? `import { existsSync, readFileSync } from 'node:fs';

// Inject dev secrets via globalThis (must happen before app import)
const secretsPath = '${secretsJsonPath}';
if (existsSync(secretsPath)) {
  const __secrets = JSON.parse(readFileSync(secretsPath, 'utf-8'));
  globalThis.__gkm_credentials__ = __secrets;
  Object.assign(process.env, __secrets);
}

`
		: '';

	const serveCode =
		runtime === 'bun'
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

	if (selfServing) {
		return `#!/usr/bin/env node
/**
 * Development server entry point for a surface that serves itself
 * This file is auto-generated by 'gkm dev'
 */
${credentialsInjection}${parentWatch}const port = process.argv.includes('--port')
  ? Number.parseInt(process.argv[process.argv.indexOf('--port') + 1])
  : 3000;

// Dynamic import so Credentials are populated before the surface evaluates
const { app } = await import('${appImportPath}');

${serveCode.replace(/^ {4}/gm, '')}
console.log(\`Server started on port \${port}\`);
`;
	}

	return `#!/usr/bin/env node
/**
 * Development server entry point
 * This file is auto-generated by 'gkm dev'
 */
${credentialsInjection}${parentWatch}const port = process.argv.includes('--port')
  ? Number.parseInt(process.argv[process.argv.indexOf('--port') + 1])
  : 3000;

// Dynamic import so Credentials are populated before env.ts evaluates
const { createApp } = await import('${appImportPath}');

// createApp is async to support optional WebSocket setup
const { app, start } = await createApp(undefined, ${enableOpenApi});

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
}

/** A port this app must serve on is held by something else. */
export class DevPortInUse extends Error {
	constructor(
		readonly port: number,
		/** What holds it, when `lsof` could say — `node (pid 123)`. */
		readonly holder: string | undefined,
	) {
		super(
			`Port ${port} is already in use${holder ? ` by ${holder}` : ''}. ` +
				'It is the port this app is provisioned on — the one every other ' +
				'app and its CORS origins point at — so dev will not move off it. ' +
				'Stop what is holding it (often a dev server a previous run left ' +
				'behind), or pass -p/--port to run this app somewhere else.',
		);
		this.name = 'DevPortInUse';
	}
}

/** Apps whose provisioned ports are held before the workspace starts. */
export class WorkspacePortsInUse extends Error {
	constructor(
		readonly held: readonly {
			app: string;
			port: number;
			holder: string | undefined;
		}[],
	) {
		super(
			`Ports this workspace's apps are provisioned on are already in use:\n${held
				.map(
					({ app, port, holder }) =>
						`   ${app}: ${port}${holder ? ` — held by ${holder}` : ''}`,
				)
				.join('\n')}\n` +
				'Stop what is holding them (often dev servers a previous run left ' +
				'behind) and start again. Nothing was started.',
		);
		this.name = 'WorkspacePortsInUse';
	}
}

/** What is listening on a port, as `command (pid N)`, if `lsof` can tell. */
function listenerOn(port: number): string | undefined {
	try {
		const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -Fpc`, {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		const pid = out.match(/^p(\d+)/m)?.[1];
		const command = out.match(/^c(.+)$/m)?.[1];
		return pid ? `${command ?? 'a process'} (pid ${pid})` : undefined;
	} catch {
		return undefined;
	}
}

class DevServer {
	private serverProcess: ChildProcess | null = null;
	private isRunning = false;
	private actualPort: number;
	private startTime = Date.now();

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
		/** Whether `app.ts` is a surface serving itself rather than `createApp`. */
		public selfServing = false,
	) {
		this.actualPort = requestedPort;
	}

	async start(): Promise<void> {
		this.startTime = Date.now();
		if (this.isRunning) {
			await this.stop();
		}

		// Check port availability
		if (this.portExplicit) {
			// Port was explicitly specified - throw if unavailable
			const available = await isPortAvailable(this.requestedPort);
			if (!available) {
				throw new DevPortInUse(
					this.requestedPort,
					listenerOn(this.requestedPort),
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

		logger.log(`\n⏳ Starting server...`);

		// Start the server using tsx (TypeScript execution)
		// Use detached: true so we can kill the entire process tree
		this.serverProcess = spawn(
			'npx',
			['tsx', serverEntryPath, '--port', this.actualPort.toString()],
			{
				stdio: 'inherit',
				env: {
					...process.env,
					NODE_ENV: 'development',
					// So the server can exit with this process — see the entry.
					GKM_DEV_PID: String(process.pid),
				},
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
			const base = `http://localhost:${this.actualPort}`;
			const lines: string[] = [`  Local:     ${base}`];
			if (this.enableOpenApi) {
				lines.push(`  API Docs:  ${base}/__docs`);
			}
			if (this.telescope) {
				lines.push(`  Telescope: ${base}${this.telescope.path}`);
			}
			if (this.studio) {
				lines.push(`  Studio:    ${base}${this.studio.path}`);
			}

			const maxLen = Math.max(...lines.map((l) => l.length));
			const pad = (s: string) => s.padEnd(maxLen);
			const border = '─'.repeat(maxLen + 2);

			logger.log('');
			logger.log(
				`  \x1b[32m✓ Ready\x1b[0m in ${((Date.now() - this.startTime) / 1000).toFixed(1)}s`,
			);
			logger.log('');
			logger.log(`  ┌${border}┐`);
			for (const line of lines) {
				logger.log(`  │ ${pad(line)} │`);
			}
			logger.log(`  └${border}┘`);
			logger.log('');
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
			// Whatever is *listening* on the port — the server this replaces.
			// Without `-sTCP:LISTEN`, lsof also lists every client connected to
			// it, so a restart killed the browser, the web app's server, or the
			// test runner that happened to hold a keep-alive socket.
			execSync(
				`lsof -ti tcp:${port} -sTCP:LISTEN | xargs kill -9 2>/dev/null || true`,
				{ stdio: 'ignore' },
			);
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

		const serverPath = join(this.appRoot, '.gkm', this.provider, 'server.ts');

		const content = generateServerEntryContent({
			secretsJsonPath: this.secretsJsonPath,
			runtime: this.runtime,
			enableOpenApi: this.enableOpenApi,
			selfServing: this.selfServing,
		});

		await fsWriteFile(serverPath, content);
	}
}
