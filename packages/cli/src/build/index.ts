import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { Cron } from '@geekmidas/constructs/crons';
import type { Endpoint } from '@geekmidas/constructs/endpoints';
import type { Function } from '@geekmidas/constructs/functions';
import type { Subscriber } from '@geekmidas/constructs/subscribers';
import {
	loadAppConfig,
	loadConfig,
	loadWorkspaceConfig,
	parseModuleConfig,
} from '../config';
import {
	getProductionConfigFromGkm,
	normalizeHooksConfig,
	normalizeProductionConfig,
	normalizeStudioConfig,
	normalizeTelescopeConfig,
} from '../dev';
import {
	CronGenerator,
	EndpointGenerator,
	FunctionGenerator,
	type GeneratedConstruct,
	SubscriberGenerator,
} from '../generators';
import {
	type BuildOptions,
	type BuildResult,
	isPartitionedRoutes,
	type LegacyProvider,
	type RouteInfo,
	type Routes,
} from '../types';
import {
	getAppBuildOrder,
	type NormalizedAppConfig,
	type NormalizedWorkspace,
} from '../workspace/index.js';
import {
	generateAwsManifest,
	generateServerManifest,
	type ManifestField,
	type ServerAppInfo,
} from './manifests';
import { groupInfosByPartition, hasPartitions } from './partitions';
import { resolveProviders } from './providerResolver';
import type { BuildContext } from './types';

const logger = console;

export async function buildCommand(
	options: BuildOptions,
): Promise<BuildResult> {
	// Load config with workspace detection
	const loadedConfig = await loadWorkspaceConfig();

	// Route to workspace build mode for multi-app workspaces
	// BUT only if we're at the workspace root (prevents recursive builds when
	// Turbo runs gkm build in each app subdirectory)
	if (loadedConfig.type === 'workspace') {
		const cwd = resolve(process.cwd());
		const workspaceRoot = resolve(loadedConfig.workspace.root);
		const isAtWorkspaceRoot = cwd === workspaceRoot;

		if (isAtWorkspaceRoot) {
			logger.log('📦 Detected workspace configuration');
			return workspaceBuildCommand(loadedConfig.workspace, options);
		}
		// When running from inside an app directory, use app-specific config
	}

	// Single-app build - use app config if in workspace, otherwise legacy config
	const config =
		loadedConfig.type === 'workspace'
			? (await loadAppConfig()).gkmConfig
			: await loadConfig();

	// Resolve providers from new config format
	const resolved = resolveProviders(config, options);

	// Normalize production configuration
	const productionConfigFromGkm = getProductionConfigFromGkm(config);
	const production = normalizeProductionConfig(
		options.production ?? false,
		productionConfigFromGkm,
	);

	if (production) {
		logger.log(`🏭 Building for PRODUCTION`);
	}

	logger.log(`Building with providers: ${resolved.providers.join(', ')}`);
	logger.log(`Loading routes from: ${formatRoutes(config.routes)}`);
	if (config.functions) {
		logger.log(`Loading functions from: ${formatRoutes(config.functions)}`);
	}
	if (config.crons) {
		logger.log(`Loading crons from: ${formatRoutes(config.crons)}`);
	}
	if (config.subscribers) {
		logger.log(`Loading subscribers from: ${formatRoutes(config.subscribers)}`);
	}
	logger.log(`Using envParser: ${config.envParser}`);

	// Parse envParser and logger configuration
	const { path: envParserPath, importPattern: envParserImportPattern } =
		parseModuleConfig(config.envParser, 'envParser');
	const { path: loggerPath, importPattern: loggerImportPattern } =
		parseModuleConfig(config.logger, 'logger');

	// Normalize telescope configuration (disabled in production)
	const telescope = production
		? undefined
		: normalizeTelescopeConfig(config.telescope);
	if (telescope) {
		logger.log(`🔭 Telescope enabled at ${telescope.path}`);
	}

	// Normalize studio configuration (disabled in production)
	const studio = production ? undefined : normalizeStudioConfig(config.studio);
	if (studio) {
		logger.log(`🗄️  Studio enabled at ${studio.path}`);
	}

	// Normalize hooks configuration
	const hooks = normalizeHooksConfig(config.hooks);
	if (hooks) {
		logger.log(`🪝 Server hooks enabled`);
	}

	// Extract docker compose services for env var auto-population
	const services = config.docker?.compose?.services;
	const dockerServices = services
		? Array.isArray(services)
			? {
					postgres: services.includes('postgres'),
					redis: services.includes('redis'),
					rabbitmq: services.includes('rabbitmq'),
				}
			: {
					postgres: Boolean(services.postgres),
					redis: Boolean(services.redis),
					rabbitmq: Boolean(services.rabbitmq),
				}
		: undefined;

	const buildContext: BuildContext = {
		envParserPath,
		envParserImportPattern,
		loggerPath,
		loggerImportPattern,
		telescope,
		studio,
		hooks,
		production,
		dockerServices,
	};

	// Initialize generators
	const endpointGenerator = new EndpointGenerator();
	const functionGenerator = new FunctionGenerator();
	const cronGenerator = new CronGenerator();
	const subscriberGenerator = new SubscriberGenerator();

	// Load all constructs in parallel
	const [allEndpoints, allFunctions, allCrons, allSubscribers] =
		await Promise.all([
			endpointGenerator.load(config.routes),
			config.functions ? functionGenerator.load(config.functions) : [],
			config.crons ? cronGenerator.load(config.crons) : [],
			config.subscribers ? subscriberGenerator.load(config.subscribers) : [],
		]);

	logger.log(`Found ${allEndpoints.length} endpoints`);
	logger.log(`Found ${allFunctions.length} functions`);
	logger.log(`Found ${allCrons.length} crons`);
	logger.log(`Found ${allSubscribers.length} subscribers`);

	if (
		allEndpoints.length === 0 &&
		allFunctions.length === 0 &&
		allCrons.length === 0 &&
		allSubscribers.length === 0
	) {
		logger.log(
			'No endpoints, functions, crons, or subscribers found to process',
		);
		return {};
	}

	// Ensure .gkm directory exists
	const rootOutputDir = join(process.cwd(), '.gkm');
	await mkdir(rootOutputDir, { recursive: true });

	// When --mark-optional is set, sniff env vars from the envParser to determine
	// which are optional. Optional vars get a `?` suffix in each construct's
	// environment array (e.g. `PORT?` instead of `PORT`).
	let optionalVarSet: Set<string> | undefined;
	if (options.markOptional && config.envParser) {
		try {
			const { _sniffEnvParser } = await import('../deploy/sniffer.js');
			const sniffed = await _sniffEnvParser(
				config.envParser,
				process.cwd(),
				process.cwd(),
			);
			if (sniffed.optionalEnvVars.length > 0) {
				optionalVarSet = new Set(sniffed.optionalEnvVars);
			}
		} catch {
			// Non-fatal — constructs are still built without optional markers
		}
	}

	// Build for each provider and generate per-provider manifests
	let result: BuildResult = {};
	for (const provider of resolved.providers) {
		const providerResult = await buildForProvider(
			provider,
			buildContext,
			rootOutputDir,
			endpointGenerator,
			functionGenerator,
			cronGenerator,
			subscriberGenerator,
			allEndpoints,
			allFunctions,
			allCrons,
			allSubscribers,
			resolved.enableOpenApi,
			options.skipBundle ?? false,
			options.stage,
		);
		// Keep the master key from the server provider
		if (providerResult.masterKey) {
			result = providerResult;
		}
	}
	return result;
}

async function buildForProvider(
	provider: LegacyProvider,
	context: BuildContext,
	rootOutputDir: string,
	endpointGenerator: EndpointGenerator,
	functionGenerator: FunctionGenerator,
	cronGenerator: CronGenerator,
	subscriberGenerator: SubscriberGenerator,
	endpoints: GeneratedConstruct<Endpoint<any, any, any, any, any, any>>[],
	functions: GeneratedConstruct<Function<any, any, any, any>>[],
	crons: GeneratedConstruct<Cron<any, any, any, any>>[],
	subscribers: GeneratedConstruct<Subscriber<any, any, any, any, any, any>>[],
	enableOpenApi: boolean,
	skipBundle: boolean,
	stage?: string,
	optionalVarSet?: Set<string>,
): Promise<BuildResult> {
	const outputDir = join(process.cwd(), '.gkm', provider);

	// Ensure output directory exists
	await mkdir(outputDir, { recursive: true });

	logger.log(`\nGenerating handlers for provider: ${provider}`);

	// Build all constructs in parallel
	const [rawRoutes, rawFunctions, rawCrons, rawSubscribers] = await Promise.all(
		[
			endpointGenerator.build(context, endpoints, outputDir, {
				provider,
				enableOpenApi,
			}),
			functionGenerator.build(context, functions, outputDir, { provider }),
			cronGenerator.build(context, crons, outputDir, { provider }),
			subscriberGenerator.build(context, subscribers, outputDir, { provider }),
		],
	);

	// Apply optional marker (`?` suffix) to env vars in each construct's environment
	const markEnv = optionalVarSet
		? (vars: string[] | undefined) =>
				vars?.map((v) => (optionalVarSet.has(v) ? `${v}?` : v))
		: (vars: string[] | undefined) => vars;

	const routes = rawRoutes.map((r) => ({
		...r,
		environment: markEnv(r.environment),
	}));
	const functionInfos = rawFunctions.map((f) => ({
		...f,
		environment: markEnv(f.environment),
	}));
	const cronInfos = rawCrons.map((c) => ({
		...c,
		environment: markEnv(c.environment),
	}));
	const subscriberInfos = rawSubscribers.map((s) => ({
		...s,
		environment: markEnv(s.environment),
	}));

	logger.log(
		`Generated ${routes.length} routes, ${functionInfos.length} functions, ${cronInfos.length} crons, ${subscriberInfos.length} subscribers for ${provider}`,
	);

	// Assemble manifest fields (flat or partitioned per construct type)
	const manifestRoutes = assembleManifestField(routes, endpoints);
	const manifestFunctions = assembleManifestField(functionInfos, functions);
	const manifestCrons = assembleManifestField(cronInfos, crons);
	const manifestSubscribers = assembleManifestField(
		subscriberInfos,
		subscribers,
	);

	// Generate provider-specific manifest
	if (provider === 'server') {
		// For server, collect actual route metadata from endpoint constructs
		const routeMetadata: RouteInfo[] = await Promise.all(
			endpoints.map(async ({ construct }) => ({
				path: construct._path,
				method: construct.method,
				handler: '', // Not needed for server manifest
				authorizer: construct.authorizer?.name ?? 'none',
			})),
		);

		const serverRouteField = assembleManifestField(routeMetadata, endpoints);

		const appInfo: ServerAppInfo = {
			handler: relative(process.cwd(), join(outputDir, 'app.ts')),
			endpoints: relative(process.cwd(), join(outputDir, 'endpoints.ts')),
		};

		await generateServerManifest(
			rootOutputDir,
			appInfo,
			serverRouteField,
			manifestSubscribers,
		);

		// Bundle for production if enabled
		let masterKey: string | undefined;
		if (context.production?.bundle && !skipBundle) {
			logger.log(`\n📦 Bundling production server...`);
			const { bundleServer } = await import('./bundler');

			// Collect all constructs for environment variable validation
			const allConstructs = [
				...endpoints.map((e) => e.construct),
				...functions.map((f) => f.construct),
				...crons.map((c) => c.construct),
				...subscribers.map((s) => s.construct),
			];

			// Get docker compose services for auto-populating env vars
			const dockerServices = context.dockerServices;

			const bundleResult = await bundleServer({
				entryPoint: join(outputDir, 'server.ts'),
				outputDir: join(outputDir, 'dist'),
				minify: context.production.minify,
				sourcemap: false,
				external: context.production.external,
				stage,
				constructs: allConstructs,
				dockerServices,
			});
			masterKey = bundleResult.masterKey;
			logger.log(`✅ Bundle complete: .gkm/server/dist/server.mjs`);

			// Display master key if secrets were injected
			if (masterKey) {
				logger.log(`\n🔐 Secrets encrypted for deployment`);
				logger.log(`   Deploy with: GKM_MASTER_KEY=${masterKey}`);
			}
		}

		return { masterKey };
	} else {
		// For AWS providers, generate AWS manifest
		await generateAwsManifest(
			rootOutputDir,
			manifestRoutes,
			manifestFunctions,
			manifestCrons,
			manifestSubscribers,
		);
	}

	return {};
}

/**
 * Result of building a single app in a workspace.
 */
export interface AppBuildResult {
	appName: string;
	type: 'backend' | 'frontend';
	success: boolean;
	outputPath?: string;
	error?: string;
}

/**
 * Result of workspace build command.
 */
export interface WorkspaceBuildResult extends BuildResult {
	apps: AppBuildResult[];
}

/**
 * Detect available package manager.
 * @internal Exported for testing
 */
export function detectPackageManager(): 'pnpm' | 'npm' | 'yarn' {
	if (existsSync('pnpm-lock.yaml')) return 'pnpm';
	if (existsSync('yarn.lock')) return 'yarn';
	return 'npm';
}

/**
 * Get the turbo command for running builds.
 * @internal Exported for testing
 */
export function getTurboCommand(
	pm: 'pnpm' | 'npm' | 'yarn',
	filter?: string,
): string {
	const filterArg = filter ? ` --filter=${filter}` : '';
	switch (pm) {
		case 'pnpm':
			return `pnpm exec turbo run build${filterArg}`;
		case 'yarn':
			return `yarn turbo run build${filterArg}`;
		case 'npm':
			return `npx turbo run build${filterArg}`;
	}
}

/**
 * Build all apps in a workspace using Turbo for dependency-ordered parallel builds.
 * @internal Exported for testing
 */
export async function workspaceBuildCommand(
	workspace: NormalizedWorkspace,
	options: BuildOptions,
): Promise<WorkspaceBuildResult> {
	const results: AppBuildResult[] = [];
	const apps = Object.entries(workspace.apps);
	const backendApps = apps.filter(([, app]) => app.type === 'backend');
	const frontendApps = apps.filter(([, app]) => app.type === 'frontend');

	logger.log(`\n🏗️  Building workspace: ${workspace.name}`);
	logger.log(
		`   Backend apps: ${backendApps.map(([name]) => name).join(', ') || 'none'}`,
	);
	logger.log(
		`   Frontend apps: ${frontendApps.map(([name]) => name).join(', ') || 'none'}`,
	);

	if (options.production) {
		logger.log(`   🏭 Production mode enabled`);
	}

	// Get build order (topologically sorted by dependencies)
	const buildOrder = getAppBuildOrder(workspace);
	logger.log(`   Build order: ${buildOrder.join(' → ')}`);

	// Use Turbo for parallel builds with dependency awareness
	const pm = detectPackageManager();
	logger.log(`\n📦 Using ${pm} with Turbo for parallel builds...\n`);

	try {
		// Run turbo build which handles dependency ordering and parallelization
		const turboCommand = getTurboCommand(pm);
		logger.log(`Running: ${turboCommand}`);

		await new Promise<void>((resolve, reject) => {
			const child = spawn(turboCommand, {
				shell: true,
				cwd: workspace.root,
				stdio: 'inherit',
				env: {
					...process.env,
					// Pass production flag to builds
					NODE_ENV: options.production ? 'production' : 'development',
				},
			});

			child.on('close', (code) => {
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`Turbo build failed with exit code ${code}`));
				}
			});

			child.on('error', (err) => {
				reject(err);
			});
		});

		// Mark all apps as successful
		for (const [appName, app] of apps) {
			const outputPath = getAppOutputPath(workspace, appName, app);
			results.push({
				appName,
				type: app.type,
				success: true,
				outputPath,
			});
		}

		logger.log(`\n✅ Workspace build complete!`);

		// Summary
		logger.log(`\n📋 Build Summary:`);
		for (const result of results) {
			const icon = result.type === 'backend' ? '⚙️' : '🌐';
			logger.log(
				`   ${icon} ${result.appName}: ${result.outputPath || 'built'}`,
			);
		}
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : 'Build failed';
		logger.log(`\n❌ Build failed: ${errorMessage}`);

		// Mark all apps as failed
		for (const [appName, app] of apps) {
			results.push({
				appName,
				type: app.type,
				success: false,
				error: errorMessage,
			});
		}

		throw error;
	}

	return { apps: results };
}

/**
 * Get the output path for a built app.
 */
function getAppOutputPath(
	workspace: NormalizedWorkspace,
	_appName: string,
	app: NormalizedAppConfig,
): string {
	const appPath = join(workspace.root, app.path);

	if (app.type === 'frontend') {
		// Next.js standalone output
		return join(appPath, '.next');
	} else {
		// Backend .gkm output
		return join(appPath, '.gkm');
	}
}

/**
 * Format routes for logging, handling PartitionedRoutes.
 */
function formatRoutes(routes: Routes): string {
	if (isPartitionedRoutes(routes)) {
		const paths = Array.isArray(routes.paths)
			? routes.paths.join(', ')
			: routes.paths;
		return `${paths} (partitioned)`;
	}
	return Array.isArray(routes) ? routes.join(', ') : routes;
}

/**
 * Assemble a ManifestField from build infos and constructs.
 * If any construct has a partition, returns a Record<string, T[]>.
 * Otherwise, returns a flat T[].
 */
function assembleManifestField<T>(
	infos: T[],
	constructs: GeneratedConstruct<any>[],
): ManifestField<T> {
	if (!hasPartitions(constructs)) {
		return infos;
	}
	return groupInfosByPartition(infos, constructs);
}
