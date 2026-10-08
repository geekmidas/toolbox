import { type ChildProcess, execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import chokidar from 'chokidar';
import fg from 'fast-glob';
import { appPackageName, buildApp, turboFilters } from '../build/index';
import type {
	NormalizedHooksConfig,
	NormalizedProductionConfig,
	NormalizedTelescopeConfig,
} from '../build/types';
import {
	loadAppConfig,
	loadWorkspaceConfig,
	NotABackendApp,
	NotInAnApp,
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
import { resolveOpenApiConfig } from '../openapi';
import { withOwningTsconfigJsx } from '../owningTsconfigJsx.js';
import { describeServices } from '../reconcile/containers.js';
import { FAKE_ENV, reconcileWorkspace } from '../reconcile/workspace.js';
import { toEmbeddableSecrets } from '../secrets/storage.js';
import { FileSecretsStore, secretsStoreFor } from '../secrets/store.js';
import { ensureTrusted } from '../trust/index.js';
import type { GkmConfig, Runtime, TelescopeConfig } from '../types';
import {
	cacheBackendFor,
	eventsBackendFor,
	providerOf,
} from '../workspace/backends.js';
import { appKey } from '../workspace/derive.js';
import {
	type FrontendFramework,
	getAppBuildOrder,
	type MobileFramework,
	type NormalizedWorkspace,
} from '../workspace/index.js';
import {
	APP_TAG_ENV,
	type AppRunning,
	appTag,
	assignAppPorts,
	describeHolder,
	holderOf,
	withAppPorts,
} from './appPorts.js';
import {
	type AppStatus,
	DISCOVERY_QUIET_ENV,
	type DiscoverySession,
	dataApisOf,
	discoveryPort,
	joinDiscovery,
} from './discovery.js';
import { closeFakes, serveFakes } from './fakes.js';

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
 * What a `--production` build is.
 *
 * Background work — queues polled, crons scheduled, subscribers drained — is
 * included here, and `buildApp` takes it back out when the app serves a
 * RestApi: an API's image answers HTTP and nothing else, and that work belongs
 * to a Worker. The build still writes their files on every server build.
 *
 * @internal Exported for testing
 */
export function normalizeProductionConfig(
	cliProduction: boolean,
): NormalizedProductionConfig | undefined {
	if (!cliProduction) {
		return undefined;
	}

	return {
		enabled: true,
		bundle: true,
		minify: true,
		healthCheck: '/health',
		gracefulShutdown: true,
		external: [],
		subscribers: 'include',
		openapi: false,
	};
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
	/** Apply pending migrations before the apps start. */
	migrate?: boolean;
	/** Migrate, then run the seeds, before the apps start. */
	seed?: boolean;
	/**
	 * Call each external API's fake (`test/fakes/<id>.ts`) instead of the
	 * provider. Without it an external API is the real one, at its URL for the
	 * local stage, with the local stage's own credentials.
	 */
	fake?: boolean;
	/**
	 * `false` (`--no-subscribers`) runs no topic subscribers. Every declared
	 * subscriber runs otherwise — fan-out is the default, opting out is this.
	 */
	subscribers?: boolean;
}

/** Read by the generated server: no subscriber is subscribed or polled. */
export const SUBSCRIBERS_ENV = 'GKM_SUBSCRIBERS';

export async function devCommand(options: DevOptions): Promise<void> {
	// Set on this process, so the server it starts — directly or through turbo
	// — inherits it.
	if (options.subscribers === false) process.env[SUBSCRIBERS_ENV] = 'off';

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

	// The app whose configured path holds this directory. Anywhere else, the
	// workspace runs: turbo starts each app's own `gkm dev`, in its folder.
	const appConfig = await loadAppConfig().catch((error: unknown) => {
		if (error instanceof NotInAnApp || error instanceof NotABackendApp) {
			return undefined;
		}
		throw error;
	});

	if (!appConfig) {
		// Discovery imports every construct and route module — the longest
		// silence of a start, before anything else can be said.
		logger.log('🔎 Reading gkm.config.ts and the constructs');
		const { workspace: everything } = await loadWorkspaceConfig();
		return workspaceDevCommand(everything, options);
	}

	const config: GkmConfig = appConfig.gkmConfig;
	const appRoot = appConfig.appRoot;
	const secretsRoot = appConfig.workspaceRoot; // Where .gkm/secrets/ lives
	const workspaceAppName = appConfig.appName;
	// The same rule the workspace start applies, for this app alone — run on
	// its own, it moves off another project's port too. Under the workspace
	// start its port was just checked free, so it stays put.
	const assigned = await assignAppPorts(
		appConfig.workspace,
		[workspaceAppName],
		{
			free: isPortAvailable,
			holder: holderOf,
		},
	);
	if (assigned.running.length > 0) {
		throw new WorkspacePortsInUse(assigned.running);
	}
	for (const { app, from, to, holder } of assigned.moved) {
		logger.log(
			`↪️  ${app}: ${from} is held by ${describeHolder(holder)}, which is not this workspace's — using ${to}`,
		);
	}
	const workspace: NormalizedWorkspace = withAppPorts(
		appConfig.workspace,
		assigned.ports,
	);
	const workspaceAppPort =
		assigned.ports[workspaceAppName] ?? appConfig.app.port;
	// Tagged, so a later start can tell this app's server from another
	// project's on the same port. The server is spawned from this process and
	// inherits it, and so does anything it forks.
	process.env[APP_TAG_ENV] = appTag(appConfig.workspaceRoot, workspaceAppName);

	// An app with an entry point (a non-gkm app like better-auth) runs it.
	if (appConfig.app.entry) {
		logger.log(`📄 Using entry point: ${appConfig.app.entry}`);
		return entryDevCommand({
			...options,
			entry: appConfig.app.entry,
			port: workspaceAppPort,
			portExplicit: true,
		});
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

	// Normalize telescope configuration
	const telescope = normalizeTelescopeConfig(config.telescope);

	// Normalize hooks configuration
	const hooks = normalizeHooksConfig(config.hooks, appRoot);

	// Resolve OpenAPI configuration
	const openApiConfig = resolveOpenApiConfig(config);
	const enableOpenApi = openApiConfig.enabled;

	// The build's own pipeline, for the server target: what dev runs is what
	// `gkm build` would have generated, never a second reading of the same
	// constructs.
	// Quietly: the build's progress — every count, every generated file — is
	// `gkm build`'s output, and repeated on every start and rebuild it buried
	// the one line dev has to say. Warnings and errors still print.
	const build = (bustCache = false) =>
		quietly(() =>
			buildApp({
				config,
				// Where a surface's `path` is measured from, so the build can tell
				// which surface this app serves.
				workspaceRoot: workspace?.root ?? secretsRoot,
				appRoot,
				target: 'server',
				enableOpenApi,
				cacheBackend: cacheBackendFor(providerOf(workspace ?? config)),
				// The local stage's broker: the target's, which the dev stack runs.
				eventsBackend: eventsBackendFor(providerOf(workspace ?? config)),
				telescope,
				databaseApi: true,
				hooks,
				skipBundle: true,
				bustCache,
				serveEmpty: true,
			}),
		);

	// Build initial version
	logger.log(`🔨 Building ${workspaceAppName ?? 'the app'}`);
	const initial = await build();

	// Determine runtime (default to node)
	const runtime: Runtime = config.runtime ?? 'node';

	// Load secrets for dev mode, resolve every declared address, and write to
	// JSON file
	let secretsJsonPath: string | undefined;
	let publicUrl: string | undefined;
	let manifest: ConstructManifest | undefined;
	// The local stage's store, which is always the file.
	const appSecrets = await loadSecretsForApp(
		workspace
			? await secretsStoreFor(workspace, config.stages.local)
			: new FileSecretsStore(secretsRoot),
		config.stages.local,
	);

	if (workspace) {
		// The same reconcile `gkm setup` and the workspace dev path run: derive
		// the containers from what the app declares, start them, create what the
		// URLs name, and inject those URLs.
		const reconciled = await reconcileWorkspace(workspace, {
			stage: workspace.stages.local,
			...(options.fake ? { fake: true } : {}),
			progress: (message) => logger.log(message),
		});

		// Every start, not only the one that changed something: where the inbox
		// is matters on the hundredth `gkm dev` as much as the first.
		if (reconciled.services.length > 0) {
			logger.log('🐳 Services');
			for (const line of describeServices(reconciled.services)) {
				logger.log(line);
			}
		}

		// Declared URLs win over anything sniffed or stored — the manifest is the
		// statement of what exists.
		Object.assign(appSecrets, reconciled.env);

		// This app's own address behind the edge, for the ready line.
		const own = reconciled.plan.resources.find(
			(r) =>
				(r.kind === 'rest-api' || r.kind === 'site') &&
				appKey(r.id) === workspaceAppName,
		);
		publicUrl = own ? reconciled.env[own.envKey] : undefined;
		manifest = reconciled.manifest;
	}

	if (Object.keys(appSecrets).length > 0) {
		const secretsDir = join(secretsRoot, '.gkm');
		await mkdir(secretsDir, { recursive: true });
		const secretsFileName = workspaceAppName
			? `dev-secrets-${workspaceAppName}.json`
			: 'dev-secrets.json';
		secretsJsonPath = join(secretsDir, secretsFileName);
		await writeFile(secretsJsonPath, JSON.stringify(appSecrets, null, 2));
	}

	// Start the dev server
	// Priority: explicit --port option > workspace app port > default 3000
	const devServer = new DevServer(
		options.port ?? workspaceAppPort ?? 3000,
		// A workspace's port is as fixed as one passed with --port: every other
		// app's URL, CORS list and cookie domain names it. Drifting to the next
		// free port served the app where nothing points — and in a workspace the
		// next free port is usually another app's.
		options.portExplicit ?? workspaceAppPort !== undefined,
		enableOpenApi,
		telescope,
		initial.databaseApi,
		runtime,
		appRoot,
		secretsJsonPath,
		initial.selfServing !== undefined,
	);

	devServer.label = workspaceAppName ?? 'server';
	devServer.publicUrl = publicUrl;
	await devServer.start();

	// Said to the machine's discovery endpoint, so a console can find this app
	// and read its data APIs without being told the port.
	const discovery = await joinDiscovery({
		role: 'app',
		port: discoveryPort(workspace.dev),
		workspace: {
			name: workspace.name,
			root: workspace.root,
			stage: workspace.stages.local,
		},
		allowedOrigins: workspace.dev?.allowedOrigins ?? [],
		...(manifest ? { manifest } : {}),
		apps: [
			{
				name: workspaceAppName,
				type: 'backend',
				port: devServer.port,
				...(publicUrl ? { publicUrl } : {}),
				status: 'ready',
				reloads: 0,
				dataApis: dataApisOf({
					selfServing: devServer.selfServing,
					telescopePath: telescope?.path,
					databaseApi: initial.databaseApi,
					openApi: enableOpenApi,
				}),
			},
		],
	});
	// Under a workspace's `gkm dev`, which printed it once for every app.
	if (!process.env[DISCOVERY_QUIET_ENV]) announce(discovery);
	devServer.onStatus = (status) =>
		discovery.updateApp(workspaceAppName, (app) => ({
			...app,
			status,
			port: devServer.port,
			reloads:
				app.status === 'reloading' && status === 'ready'
					? app.reloads + 1
					: app.reloads,
		}));

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

	// Relative to the app, which the watcher runs from: the construct globs
	// arrive absolute from the config, and a relative path is what the change
	// line prints.
	const normalizedPatterns = watchPatterns.map((p) =>
		isAbsolute(p) ? relative(appRoot, p) : p.replace(/^\.\//, ''),
	);

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

	const watcher = chokidar.watch([...resolvedFiles, ...dirsToWatch], {
		ignored: /(^|[/\\])\../, // ignore dotfiles
		persistent: true,
		ignoreInitial: true,
		cwd: appRoot,
	});

	watcher.on('error', (error) => {
		logger.error('❌ Watcher error:', error);
	});

	let rebuildTimeout: NodeJS.Timeout | null = null;

	watcher.on('change', async (path) => {
		logger.log(`🔄 ${path} changed — rebuilding`);

		// Debounce rebuilds
		if (rebuildTimeout) {
			clearTimeout(rebuildTimeout);
		}

		rebuildTimeout = setTimeout(async () => {
			try {
				// Bust the module cache: the edit is what the rebuild is for.
				const rebuilt = await build(true);

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
		Promise.all([watcher.close(), devServer.stop(), discovery.leave()])
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
	const secrets = await (await secretsStoreFor(workspace, stage)).read(stage);
	if (secrets) return toEmbeddableSecrets(secrets);

	// Nothing to warn about: the local stage's own secrets and every address are
	// derived by reconcile. A stored stage only adds what nothing can derive — a
	// third party's key — and a construct missing one says so when it is read.
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
	configured: NormalizedWorkspace,
	options: DevOptions,
): Promise<void> {
	// Each app's local port, before anything reads one: the edge routes, every
	// address an app is handed, and the ready lines all follow it. An app whose
	// port another project holds moves; one this workspace already has running
	// is refused, since moving would start a second copy beside it.
	const scoped = options.app
		? [options.app]
		: options.filter
			? []
			: Object.keys(configured.apps);
	const assigned = await assignAppPorts(configured, scoped, {
		free: isPortAvailable,
		holder: holderOf,
	});
	if (assigned.running.length > 0) {
		throw new WorkspacePortsInUse(assigned.running);
	}
	for (const { app, from, to, holder } of assigned.moved) {
		logger.log(
			`↪️  ${app}: ${from} is held by ${describeHolder(holder)}, which is not this workspace's — using ${to}`,
		);
	}
	const workspace = withAppPorts(configured, assigned.ports);
	const appCount = Object.keys(workspace.apps).length;
	const frontendApps = Object.entries(workspace.apps).filter(
		([_, app]) => app.type === 'web',
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
	}

	// Frontend apps import each API's client from the workspace root's
	// `.gkm/client/` through their tsconfig alias
	// (`import { createApi } from '@myapp/client/api'`) — nothing is copied.

	const rawSecrets = await loadDevSecrets(workspace);

	// Derive the containers from what the apps declare, start them, create what
	// the URLs name, and inject those URLs. Safe to do on every start because
	// the blast radius is this project's containers and `.gkm/`, and because the
	// converged case costs one hash and one health check.
	const reconciled = await reconcileWorkspace(workspace, {
		stage: workspace.stages.local,
		...(options.fake ? { fake: true } : {}),
		progress: (message) => logger.log(message),
	});

	// Every start, not only the one that changed something: where the inbox is
	// matters on the hundredth `gkm dev` as much as the first.
	if (reconciled.services.length > 0) {
		logger.log('🐳 Services');
		for (const line of describeServices(reconciled.services)) {
			logger.log(line);
		}
	}

	const secretsEnv: Record<string, string> = {
		...rawSecrets,
		...reconciled.env,
	};

	// Only with `--fake`, and here rather than in reconcile: every app's own
	// `gkm dev` reconciles too, and only this process — the one that outlives
	// them — may own the ports.
	const fakes = options.fake
		? await serveFakes(reconciled.fakes, reconciled.ports)
		: [];
	for (const { id, port } of fakes) {
		logger.log(`🎭 ${id} fake: http://localhost:${port}`);
	}

	// Asked for, the databases are migrated (and seeded) before anything
	// starts, and a failure stops here. Otherwise pending migrations are only
	// reported, and a failure to check is only a warning: nothing about it
	// should keep the apps from starting.
	logger.log(
		options.migrate || options.seed
			? '🗄️  Migrating the databases'
			: '🗄️  Checking for pending migrations',
	);
	if (options.migrate || options.seed) {
		const { prepareDevDatabases } = await import('../migrate/index.js');
		await prepareDevDatabases(workspace, reconciled.env, {
			seed: !!options.seed,
		});
	} else {
		await import('../migrate/index.js')
			.then(({ reportPendingMigrations }) =>
				reportPendingMigrations(workspace, reconciled.env),
			)
			.catch((error: unknown) => {
				logger.log(
					`⚠️  Could not check for pending migrations: ${error instanceof Error ? error.message : String(error)}`,
				);
			});
	}

	// Where each app answers, behind the edge — the addresses the apps were just
	// given, rather than their ports.
	const appUrls: Record<string, string> = {};
	for (const resource of reconciled.plan.resources) {
		if (resource.kind !== 'rest-api' && resource.kind !== 'site') continue;
		const address = reconciled.env[resource.envKey];
		if (address) appUrls[resource.id] = address;
	}

	// A browser trusts the edge's HTTPS addresses only once its authority is in
	// the system store. Asked here, once, rather than left for the first page
	// load to say "your connection is not private".
	const firstUrl = Object.values(appUrls).find((url) =>
		url.startsWith('https://'),
	);
	if (firstUrl) await ensureTrusted(workspace.root, firstUrl);

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
	} else if (options.filter) {
		// Use custom filter
		turboFilter = ['--filter', options.filter];
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
	}

	// Each app once: the address it is reached at, and the local port the edge
	// forwards it to.
	const buildOrder = getAppBuildOrder(workspace);
	const width = Math.max(...buildOrder.map((name) => name.length));
	logger.log(`\n${workspace.name}: ${appCount} app(s)`);
	for (const appName of buildOrder) {
		const app = workspace.apps[appName];
		if (!app) continue;
		// A mobile app answers on its scheme, and a phone reaches this machine
		// at its LAN address — which is what to check when sign-in fails there.
		if (app.type === 'mobile') {
			const own = reconciled.plan.resources.find(
				(r) => r.kind === 'mobile-app' && appKey(r.id) === appName,
			);
			const scheme = own ? reconciled.env[own.envKey] : undefined;
			const device = Object.entries(reconciled.env).find(([key]) =>
				key.endsWith('_DEVICE_URL'),
			)?.[1];
			logger.log(
				`   ${appName.padEnd(width)}  ${scheme ? `${scheme}://` : 'mobile'}${device ? ` — devices reach ${new URL(device).hostname}` : ''}`,
			);
			continue;
		}
		const local = `http://localhost:${app.port}`;
		const url = Object.entries(appUrls).find(
			([id]) => appKey(id) === appName,
		)?.[1];
		logger.log(
			`   ${appName.padEnd(width)}  ${url ? `${url} -> ${local}` : local}`,
		);
	}
	logger.log('');

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

	// Every app turbo starts, as this workspace lists them. Each backend app's
	// own `gkm dev` registers too, with its status and its data APIs.
	const discovery = await joinDiscovery({
		role: 'workspace',
		port: discoveryPort(workspace.dev),
		workspace: {
			name: workspace.name,
			root: workspace.root,
			stage: workspace.stages.local,
		},
		allowedOrigins: workspace.dev?.allowedOrigins ?? [],
		...(reconciled.manifest ? { manifest: reconciled.manifest } : {}),
		apps: buildOrder.flatMap((name) => {
			const app = workspace.apps[name];
			if (!app) return [];
			const publicUrl = Object.entries(appUrls).find(
				([id]) => appKey(id) === name,
			)?.[1];
			return [
				{
					name,
					type: app.type,
					port: app.port,
					...(publicUrl ? { publicUrl } : {}),
					status: 'starting' as const,
					reloads: 0,
					dataApis: [],
				},
			];
		}),
	});
	announce(discovery);

	// Prepare environment variables
	// Order matters: secrets first, then dependencies (dependencies can override)
	const turboEnv: Record<string, string> = {
		...process.env,
		...secretsEnv,
		NODE_ENV: 'development',
		// Inject config path so child processes can find the workspace config
		...(configPath ? { GKM_CONFIG_PATH: configPath } : {}),
		// Each app reconciles again, and must point at the same fakes.
		...(options.fake ? { [FAKE_ENV]: '1' } : {}),
		// The connect URL was printed above; the apps need not repeat it.
		[DISCOVERY_QUIET_ENV]: '1',
	};

	// Spawn turbo run dev
	logger.log(
		`🚀 Starting ${appCount} app(s) — each builds before it answers, and says so when it is ready`,
	);

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
		closeFakes(fakes);
		void discovery.leave();

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
		const env = {
			...process.env,
			PORT: String(this.port),
			NODE_OPTIONS: withOwningTsconfigJsx(process.env.NODE_OPTIONS),
		};

		this.childProcess = spawn(
			...tsxCommand(dirname(this.wrapperPath), [this.wrapperPath]),
			{
				stdio: 'inherit',
				env,
				detached: true,
			},
		);

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

/**
 * The discovery endpoint's connect URL, Jupyter-style: the token in it is what
 * lets a console read what this machine is running.
 */
function announce(discovery: DiscoverySession): void {
	logger.log(`🧭 Discovery: ${discovery.connectUrl}`);
}

/** Run `fn` with `console.log` muted — warnings and errors still print. */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
	const log = console.log;
	console.log = () => {};
	try {
		return await fn();
	} finally {
		console.log = log;
	}
}

/**
 * How to run a TypeScript entry with the app's own tsx.
 *
 * Straight through node rather than `npx tsx`: npx reads the developer's npm
 * config on every start and warned about each key it did not recognise — nine
 * lines per app, per restart, about nothing gkm does.
 */
function tsxCommand(appRoot: string, args: string[]): [string, string[]] {
	try {
		const cli = createRequire(join(appRoot, 'package.json')).resolve('tsx/cli');
		return [process.execPath, [cli, ...args]];
	} catch {
		return ['npx', ['tsx', ...args]];
	}
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
/**
 * This workspace's own apps are already running — left by a previous start.
 *
 * Only these are refused: a port another project holds is moved off instead
 * (see `assignAppPorts`), but moving off our own would start a second copy.
 */
export class WorkspacePortsInUse extends Error {
	constructor(readonly held: readonly AppRunning[]) {
		super(
			`This workspace's apps are already running:\n${held
				.map(
					({ app, port, holder }) =>
						`   ${app}: ${port} — ${describeHolder(holder)}`,
				)
				.join('\n')}\n` +
				'A previous `gkm dev` left them behind. Stop them (kill the pids above) ' +
				'and start again. Nothing was started.',
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
		private requestedPort: number,
		private portExplicit: boolean,
		private enableOpenApi: boolean,
		private telescope: NormalizedTelescopeConfig | undefined,
		/** Where the database's JSON API is served, when one is declared. */
		private databaseApi: string | undefined,
		private runtime: Runtime = 'node',
		private appRoot: string = process.cwd(),
		private secretsJsonPath?: string,
		/** Whether `app.ts` is a surface serving itself rather than `createApp`. */
		public selfServing = false,
	) {
		this.actualPort = requestedPort;
	}

	/** What the ready line calls this app. */
	label = 'server';

	/** Told when the server is ready, reloading, or exits on its own. */
	onStatus: ((status: AppStatus) => void) | undefined;

	/** The port it is serving on. */
	get port(): number {
		return this.actualPort;
	}

	/**
	 * Where the app is reached — its HTTPS address behind the edge, when it has
	 * one. The local port is only what the edge forwards to.
	 */
	publicUrl: string | undefined;

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

		const serverEntryPath = join(this.appRoot, '.gkm', 'server', 'server.ts');

		// Create server entry file
		await this.createServerEntry();

		// Start the server using tsx (TypeScript execution)
		// Use detached: true so we can kill the entire process tree
		this.serverProcess = spawn(
			...tsxCommand(this.appRoot, [
				serverEntryPath,
				'--port',
				this.actualPort.toString(),
			]),
			{
				stdio: 'inherit',
				env: {
					...process.env,
					NODE_ENV: 'development',
					// So the server can exit with this process — see the entry.
					GKM_DEV_PID: String(process.pid),
					// The app runs from its own directory, and tsx compiles only
					// what that tsconfig includes with its options — so a
					// construct's `.tsx` in the workspace would lose its JSX
					// settings. See `bin/owning-tsconfig-jsx.mjs`.
					NODE_OPTIONS: withOwningTsconfigJsx(process.env.NODE_OPTIONS),
				},
				detached: true,
			},
		);

		this.isRunning = true;

		this.serverProcess.on('error', (error) => {
			logger.error('❌ Server error:', error);
		});

		const child = this.serverProcess;
		child.on('exit', (code, signal) => {
			if (code !== null && code !== 0 && signal !== 'SIGTERM') {
				logger.error(`❌ Server exited with code ${code}`);
			}
			this.isRunning = false;
			// Still the current server, so nothing here stopped it: it exited on
			// its own. `stop()` lets go of the one it kills before it dies.
			if (this.serverProcess === child) this.onStatus?.('stopped');
		});

		// Give the server a moment to start
		await new Promise((resolve) => setTimeout(resolve, 1000));

		if (this.isRunning) {
			const local = `http://localhost:${this.actualPort}`;
			const address = this.publicUrl ? `${this.publicUrl} -> ${local}` : local;
			const seconds = ((Date.now() - this.startTime) / 1000).toFixed(1);
			logger.log(
				`\x1b[32m✓\x1b[0m ${this.label} ready in ${seconds}s  ${address}`,
			);

			// What the generated app mounts. An app that serves itself — an auth
			// server — mounts none of it.
			const tools = this.selfServing
				? []
				: [
						...(this.enableOpenApi ? ['docs /__docs'] : []),
						...(this.telescope ? [`telescope ${this.telescope.path}`] : []),
						...(this.databaseApi ? [`db ${this.databaseApi}`] : []),
					];
			if (tools.length > 0) logger.log(`  ${tools.join(' · ')}`);
			this.onStatus?.('ready');
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
		this.onStatus?.('reloading');
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

		const serverPath = join(this.appRoot, '.gkm', 'server', 'server.ts');

		const content = generateServerEntryContent({
			secretsJsonPath: this.secretsJsonPath,
			runtime: this.runtime,
			enableOpenApi: this.enableOpenApi,
			selfServing: this.selfServing,
		});

		await fsWriteFile(serverPath, content);
	}
}
