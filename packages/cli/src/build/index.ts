import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { Cron } from '@geekmidas/constructs/crons';
import type { Endpoint } from '@geekmidas/constructs/endpoints';
import type { Function } from '@geekmidas/constructs/functions';
import type { Queue } from '@geekmidas/constructs/queue';
import type { Subscriber } from '@geekmidas/constructs/subscribers';
import type { Topic } from '@geekmidas/constructs/topic';
import type { ConstructManifest } from '@geekmidas/manifest';
import { loadAppConfig, loadConfig, loadWorkspaceConfig } from '../config';
import {
	normalizeHooksConfig,
	normalizeProductionConfig,
	normalizeStudioConfig,
	normalizeTelescopeConfig,
} from '../dev';
import {
	CronGenerator,
	cacheBackendsIn,
	driversFor,
	EndpointGenerator,
	FunctionGenerator,
	type GeneratedConstruct,
	QueueGenerator,
	SubscriberGenerator,
	TopicGenerator,
} from '../generators';
import { telemetryFor } from '../generators/telemetry';
import { generateOpenApi } from '../openapi.js';
import { type ConstructSource, discover } from '../reconcile/discover.js';
import {
	type Backends,
	manifestModule,
	withCompute,
	withRoutes,
} from '../reconcile/emit.js';
import type {
	BuildOptions,
	BuildResult,
	CacheBackend,
	CronInfo,
	FunctionInfo,
	GkmConfig,
	MainProvider,
	QueueInfo,
	RouteInfo,
	Routes,
	SubscriberInfo,
} from '../types';
import { DEFAULT_EMAIL } from '../types.js';
import { cacheBackendFor, providerOf } from '../workspace/backends.js';
import {
	allConstructGlobs,
	getAppBuildOrder,
	getAppGkmConfig,
	type NormalizedAppConfig,
	type NormalizedWorkspace,
} from '../workspace/index.js';
import { ownersContext, servedBy } from './owners';
import { selfServingSurface, writeSurfaceEntry } from './surfaceEntry';
import type {
	BuildContext,
	NormalizedHooksConfig,
	NormalizedProductionConfig,
	NormalizedStudioConfig,
	NormalizedTelescopeConfig,
} from './types';

const logger = console;

/**
 * What a build run at the workspace root reads.
 *
 * One backend app there, and it is that app's config, so its own `openapi`
 * and `telescope` settings still apply. Otherwise it is the workspace's: every
 * construct glob, and the backends they resolve to.
 */
function rootGkmConfig(workspace: NormalizedWorkspace): GkmConfig {
	const backends = Object.entries(workspace.apps).filter(
		([, app]) => app.type === 'backend',
	);
	const only = backends.length === 1 ? backends[0] : undefined;
	const own = only ? getAppGkmConfig(workspace, only[0]) : undefined;

	return (
		own ?? {
			stages: workspace.stages,
			...(workspace.deploy ? { deploy: workspace.deploy } : {}),
			constructs: allConstructGlobs(workspace),
		}
	);
}

/** Directories under `.gkm/` that the removed per-provider builds wrote. */
const SUPERSEDED_OUTPUT = [
	'aws-apigatewayv1',
	'aws-apigatewayv2',
	'aws-lambda',
];

/** Whether `--provider` named something a build can target. */
export function isMainProvider(value: string): value is MainProvider {
	return value === 'aws' || value === 'server';
}

export class UnknownBuildProvider extends Error {
	constructor(readonly provider: string) {
		super(
			`'${provider}' is not a build target. Pass --provider aws or --provider server, or leave it out to build for where gkm.config.ts deploys.`,
		);
		this.name = 'UnknownBuildProvider';
	}
}

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

		// Turbo only when there is a subdirectory for it to descend into. With
		// every app at the root — or no apps at all — routing through it
		// re-enters this same directory: turbo runs the root package's `build`,
		// which is `gkm build`, which arrives here again.
		const someAppIsElsewhere = Object.values(loadedConfig.workspace.apps).some(
			(app) => resolve(workspaceRoot, app.path) !== workspaceRoot,
		);

		if (isAtWorkspaceRoot && someAppIsElsewhere) {
			logger.log('📦 Detected workspace configuration');
			return workspaceBuildCommand(loadedConfig.workspace, options);
		}
	}

	// At the root there is no app to pick: the build reads every construct the
	// globs find and writes one manifest and a spec per surface. Asking
	// package.json which app this is was a question only a subdirectory has.
	const config =
		loadedConfig.type !== 'workspace'
			? await loadConfig()
			: resolve(process.cwd()) === resolve(loadedConfig.workspace.root)
				? rootGkmConfig(loadedConfig.workspace)
				: (await loadAppConfig()).gkmConfig;

	// Where it deploys decides what it builds: one Lambda per construct for
	// AWS, one process for a server. `--provider` overrides it for a Dockerfile,
	// which builds a server whatever the project deploys to.
	const target = options.provider ?? providerOf(loadedConfig.workspace);
	const workspaceRoot = loadedConfig.workspace.root;
	const appRoot = process.cwd();

	const output = await buildOneApp({
		config,
		options,
		workspace: loadedConfig.workspace,
		appRoot,
		target,
	});

	// Inside an app, its handlers are all there is to write: the manifest is
	// the application's, and only the root has all of it.
	if (resolve(appRoot) === resolve(workspaceRoot)) {
		await writeManifest({
			workspaceRoot,
			target,
			builds: output.built ? [output.built] : [],
			constructs: await declaredIn(config, workspaceRoot),
			backends: backendsOf(loadedConfig.workspace),
		});
	}

	return output;
}

/** What the workspace declares, read through a config's globs. */
async function declaredIn(
	config: GkmConfig,
	cwd: string,
): Promise<ConstructManifest> {
	return discover({ patterns: config.constructs, cwd });
}

/**
 * The backend choices the manifest records — answered by the deploy target,
 * the same place reconcile and the build's drivers read them.
 */
function backendsOf(workspace: { deploy?: { default?: string } }): {
	cache: CacheBackend;
	email: typeof DEFAULT_EMAIL;
} {
	return {
		cache: cacheBackendFor(providerOf(workspace)),
		email: DEFAULT_EMAIL,
	};
}

/** One app's build, from its config and the command's options. */
async function buildOneApp(input: {
	config: GkmConfig;
	options: BuildOptions;
	workspace: NormalizedWorkspace;
	appRoot: string;
	target: MainProvider;
}): Promise<AppBuildOutput> {
	const { config, options, workspace, appRoot, target } = input;

	// One answer for which backends this app uses, read once — from the
	// deploy target, which is the same place reconcile reads it. The build
	// registers drivers for it and records it in the manifest, so a deploy
	// cannot pick differently and hand the running code a URL it has no driver
	// for.
	const cacheBackend = cacheBackendFor(providerOf(workspace));

	const production = normalizeProductionConfig(options.production ?? false);
	if (production) {
		logger.log(`🏭 Building for PRODUCTION`);
	}

	logger.log(`Building for ${target}`);
	logger.log(`Loading constructs from: ${formatRoutes(config.constructs)}`);

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

	const hooks = normalizeHooksConfig(config.hooks, appRoot);
	if (hooks) {
		logger.log(`🪝 Server hooks enabled`);
	}

	return buildApp({
		config,
		workspaceRoot: workspace.root,
		appRoot,
		target,
		enableOpenApi: options.enableOpenApi ?? false,
		cacheBackend,
		production,
		telescope,
		studio,
		hooks,
		markOptional: options.markOptional ?? false,
		skipBundle: options.skipBundle ?? false,
		stage: options.stage,
		workspaceName: workspace.name,
	});
}

/** What one app's build needs, once its config has been read. */
export interface BuildAppInput {
	config: GkmConfig;
	workspaceRoot: string;
	/** The app being built — the directory a surface's `path` names. */
	appRoot: string;
	/** Where the build deploys: one Lambda per construct, or one process. */
	target: MainProvider;
	enableOpenApi: boolean;
	cacheBackend: CacheBackend;
	production?: NormalizedProductionConfig;
	telescope?: NormalizedTelescopeConfig;
	studio?: NormalizedStudioConfig;
	hooks?: NormalizedHooksConfig;
	markOptional?: boolean;
	skipBundle?: boolean;
	stage?: string;
	/** Re-import changed modules — `gkm dev` rebuilding after an edit. */
	bustCache?: boolean;
	/** The workspace's name — telemetry's `service.namespace`. */
	workspaceName?: string;
	/**
	 * Generate a server even when the globs find nothing.
	 *
	 * A build with nothing in it has nothing to deploy. A dev server with
	 * nothing in it is how a project starts: it runs, and the first endpoint
	 * written appears on the next rebuild.
	 */
	serveEmpty?: boolean;
}

export interface AppBuildOutput extends BuildResult {
	/**
	 * The surface the entry starts, when the app's surface serves itself — its
	 * `app.ts` exports the construct's own `app`, with no `createApp` to call.
	 */
	selfServing?: string;
	/** What it generated, for the application's manifest. */
	built?: AppBuild;
}

/** One app's generated handlers, as the application's manifest records them. */
export interface AppBuild {
	/** The surface its endpoints are served on. */
	surface?: string;
	routes: RouteInfo[];
	functions: FunctionInfo[];
	crons: CronInfo[];
	subscribers: SubscriberInfo[];
	queues: QueueInfo[];
}

/**
 * Write the application's manifest: every declared construct, with what each
 * app generated folded into it.
 *
 * The manifest belongs to the whole application, so only the root writes it —
 * once, after every app has built, from the constructs the workspace declares.
 * An app's own build generates its handlers and nothing else.
 */
export async function writeManifest(input: {
	workspaceRoot: string;
	target: MainProvider;
	builds: readonly AppBuild[];
	constructs: ConstructManifest;
	backends: Backends;
}): Promise<void> {
	const { workspaceRoot, target, builds, constructs, backends } = input;
	const manifestDir = join(workspaceRoot, '.gkm', 'manifest');
	await mkdir(manifestDir, { recursive: true });

	// One manifest, for the target this build is for. The other target's,
	// left by an earlier build, would describe an application that is not
	// being deployed.
	const other = target === 'aws' ? 'server' : 'aws';
	await rm(join(manifestDir, `${other}.ts`), { force: true });

	// Each app's routes go to the surface it serves; then the compute every
	// app generated, which nests in the queue or topic that triggers it.
	const withServed = builds.reduce(
		(manifest, build) =>
			withRoutes(
				manifest,
				build.routes.filter((route) => route.method !== 'ALL'),
				{
					perRoute: true,
					...(build.surface ? { surface: build.surface } : {}),
				},
			),
		constructs,
	);
	const folded = withCompute(withServed, {
		functions: builds.flatMap((build) => build.functions),
		crons: builds.flatMap((build) => build.crons),
		queues: builds.flatMap((build) => build.queues),
		subscribers: builds.flatMap((build) => build.subscribers),
	});

	const path = join(manifestDir, `${target}.ts`);
	await writeFile(path, manifestModule(folded, backends));
	logger.log(`Manifest: ${relative(process.cwd(), path)}`);
}

/**
 * Turn one app's constructs into its generated entry.
 *
 * `gkm build` and `gkm dev` both run this. They used to be two copies of it,
 * and every time the build learned something about constructs — that the
 * entry takes its logger from the surface, that an auth server serves itself —
 * dev did not, and failed on exactly the apps the build had learned to handle.
 */
export async function buildApp(input: BuildAppInput): Promise<AppBuildOutput> {
	const {
		config,
		workspaceRoot,
		appRoot,
		target,
		enableOpenApi,
		cacheBackend,
		production,
		telescope,
		studio,
		hooks,
		bustCache = false,
	} = input;

	const constructGlobs = config.constructs;

	// Discovery imports application code, so it runs once here and everything
	// downstream reads what it wrote — a deploy config calling it would evaluate
	// the whole runtime graph inside its own toolchain. It runs before the build
	// context rather than after the generators because the entry point's drivers
	// are decided from it.
	const constructSources: Record<string, ConstructSource> = {};
	const declared = constructGlobs
		? await discover({
				patterns: constructGlobs,
				cwd: appRoot,
				bustCache,
				sources: constructSources,
			})
		: {};

	// A surface that serves itself is started, not generated for: its routes
	// are the construct's, and the entry only has to call it.
	const selfServing = selfServingSurface({
		declared,
		sources: constructSources,
		workspaceRoot,
		appRoot,
	});

	if (selfServing) {
		await writeSurfaceEntry(
			join(appRoot, '.gkm', 'server'),
			selfServing.source,
		);
		logger.log(
			`Generated a server for ${selfServing.id} from its own declaration`,
		);

		return { selfServing: selfServing.id };
	}

	const derived = ownersContext({
		declared,
		sources: constructSources,
		workspaceRoot,
		appRoot,
		studio,
	});

	const buildContext: BuildContext = {
		...derived,
		telescope,
		hooks,
		production,
		constructGlobs,
		cacheBackend,
		// Mail is SMTP everywhere; the provider is whatever the stage's URL
		// names, so there is no choice to read here.
		emailBackend: DEFAULT_EMAIL,
		// Both halves of "where does the cache live": the declaration for one
		// that named its database, and the deploy target's default for one that
		// named nowhere. Reading only the default registers a driver for a
		// protocol the target never composes.
		storageDrivers: driversFor({
			appRoot,
			cache: cacheBackendsIn(declared, cacheBackend),
		}),
		markOptional: input.markOptional ?? false,
		...(production && {
			telemetry: telemetryFor({
				appRoot,
				surfaceId: derived.surface?.id,
				workspaceName: input.workspaceName,
			}),
		}),
	};

	// Initialize generators
	const endpointGenerator = new EndpointGenerator();
	const functionGenerator = new FunctionGenerator();
	const cronGenerator = new CronGenerator();
	const subscriberGenerator = new SubscriberGenerator();
	const queueGenerator = new QueueGenerator();
	const topicGenerator = new TopicGenerator();

	// One glob, every kind.
	//
	// Six globs was six things to keep in step, and a handler in the wrong
	// directory simply never loaded. It was never necessary: each generator
	// already filters what it loads by a type predicate — `Endpoint.isEndpoint`,
	// `Cron.isCron` — so which *kind* a module exports comes from the value, and
	// the glob only ever had to say where to look. It says it once.
	const code = constructGlobs;

	const [
		loadedEndpoints,
		allFunctions,
		allCrons,
		allSubscribers,
		allQueues,
		allTopics,
	] = await Promise.all([
		endpointGenerator.load(code, appRoot, bustCache),
		functionGenerator.load(code, appRoot, bustCache),
		cronGenerator.load(code, appRoot, bustCache),
		subscriberGenerator.load(code, appRoot, bustCache),
		queueGenerator.load(code, appRoot, bustCache),
		topicGenerator.load(code, appRoot, bustCache),
	]);

	const allEndpoints = servedBy(loadedEndpoints, derived.surface);

	logger.log(`Found ${allEndpoints.length} endpoints`);
	logger.log(`Found ${allFunctions.length} functions`);
	logger.log(`Found ${allCrons.length} crons`);
	logger.log(`Found ${allSubscribers.length} subscribers`);
	logger.log(`Found ${allQueues.length} queues`);
	logger.log(`Found ${allTopics.length} topics`);

	if (
		!input.serveEmpty &&
		allEndpoints.length === 0 &&
		allFunctions.length === 0 &&
		allCrons.length === 0 &&
		allSubscribers.length === 0 &&
		allQueues.length === 0 &&
		allTopics.length === 0
	) {
		logger.log(
			'No endpoints, functions, crons, subscribers, queues, or topics found to process',
		);
		return {};
	}

	const result = await buildForTarget(
		target,
		buildContext,
		appRoot,
		workspaceRoot,
		endpointGenerator,
		functionGenerator,
		cronGenerator,
		subscriberGenerator,
		queueGenerator,
		topicGenerator,
		allEndpoints,
		allFunctions,
		allCrons,
		allSubscribers,
		allQueues,
		allTopics,
		enableOpenApi,
		input.skipBundle ?? false,
		input.stage,
	);

	// One spec per surface, from the endpoints the build already loaded rather
	// than from a second discovery pass over the same files.
	await generateOpenApi(
		allEndpoints.map(({ construct }) => construct),
		{ openapi: config.openapi, root: workspaceRoot },
	);

	return result;
}

async function buildForTarget(
	target: MainProvider,
	context: BuildContext,
	appRoot: string,
	workspaceRoot: string,
	endpointGenerator: EndpointGenerator,
	functionGenerator: FunctionGenerator,
	cronGenerator: CronGenerator,
	subscriberGenerator: SubscriberGenerator,
	queueGenerator: QueueGenerator,
	topicGenerator: TopicGenerator,
	endpoints: GeneratedConstruct<Endpoint<any, any, any, any, any, any>>[],
	functions: GeneratedConstruct<Function<any, any, any, any>>[],
	crons: GeneratedConstruct<Cron<any, any, any, any>>[],
	subscribers: GeneratedConstruct<
		Subscriber<any, any, any, any, any, any, any>
	>[],
	queues: GeneratedConstruct<Queue<any, any, any, any, any, any>>[],
	topics: GeneratedConstruct<Topic<any, any>>[],
	enableOpenApi: boolean,
	skipBundle: boolean,
	stage?: string,
): Promise<AppBuildOutput> {
	// The handlers live beside the app they import. What they are goes into
	// the application's manifest, which the root writes, so every path is
	// measured from there.
	const outputDir = join(appRoot, '.gkm', target);

	// What an older build wrote and nothing writes now — the per-provider trees
	// and an app-level manifest — would otherwise sit beside the real output
	// forever, read by whoever opens `.gkm/` first.
	await Promise.all(
		[
			...SUPERSEDED_OUTPUT.map((dir) => join(appRoot, '.gkm', dir)),
			...(appRoot === workspaceRoot ? [] : [join(appRoot, '.gkm', 'manifest')]),
		].map((dir) => rm(dir, { recursive: true, force: true })),
	);

	// A fresh tree for AWS, so a deleted endpoint's handler goes with it. Not
	// for the server: `gkm dev` rebuilds into it while its process runs.
	if (target === 'aws') await rm(outputDir, { recursive: true, force: true });
	await mkdir(outputDir, { recursive: true });

	logger.log(`\nGenerating handlers for ${target}`);
	const options = { target, root: workspaceRoot };

	// Build all constructs in parallel.
	// context.markOptional is forwarded to each generator so that
	// getEnvironment({ markOptional }) produces `VARNAME?` for optional vars.
	const [
		routes,
		functionInfos,
		cronInfos,
		subscriberInfos,
		queueInfos,
		topicInfos,
	] = await Promise.all([
		endpointGenerator.build(context, endpoints, outputDir, {
			...options,
			enableOpenApi,
		}),
		functionGenerator.build(context, functions, outputDir, options),
		cronGenerator.build(context, crons, outputDir, options),
		subscriberGenerator.build(context, subscribers, outputDir, options),
		queueGenerator.build(context, queues, outputDir, options),
		topicGenerator.build(context, topics, outputDir, options),
	]);

	logger.log(
		`Generated ${routes.length} routes, ${functionInfos.length} functions, ${cronInfos.length} crons, ${subscriberInfos.length} subscribers, ${queueInfos.length} queues, ${topicInfos.length} topics for ${target}`,
	);

	// What the manifest folds into the declarations they belong to.
	const fields = {
		...(context.surface ? { surface: context.surface.id } : {}),
		functions: functionInfos,
		crons: cronInfos,
		queues: queueInfos,
		subscribers: subscriberInfos,
	};

	if (target === 'server') {
		// Every endpoint, as on AWS — its method, path, edges and authorizer —
		// served by the one process: the app's entry is each one's handler.
		const handler = relative(workspaceRoot, join(outputDir, 'app.ts'));
		const built: AppBuild = {
			...fields,
			routes: await Promise.all(
				endpoints.map(async ({ construct }) => ({
					path: construct._path,
					method: construct.method,
					handler,
					environment: await construct.getEnvironment({
						markOptional: context.markOptional,
					}),
					dependencies: construct.constructs,
					authorizer: construct.authorizer?.name ?? 'none',
				})),
			),
		};

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
				...queues.map((q) => q.construct),
			];

			const bundleResult = await bundleServer({
				entryPoint: join(outputDir, 'server.ts'),
				outputDir: join(outputDir, 'dist'),
				minify: context.production.minify,
				sourcemap: false,
				external: context.production.external,
				stage,
				constructs: allConstructs,
			});
			masterKey = bundleResult.masterKey;
			logger.log(`✅ Bundle complete: .gkm/server/dist/server.mjs`);

			// Display master key if secrets were injected
			if (masterKey) {
				logger.log(`\n🔐 Secrets encrypted for deployment`);
				logger.log(`   Deploy with: GKM_MASTER_KEY=${masterKey}`);
			}
		}

		return { masterKey, built };
	}

	return {
		built: { ...fields, routes },
	};
}

/**
 * Result of building a single app in a workspace.
 */
export interface AppBuildResult {
	appName: string;
	type: 'backend' | 'web' | 'mobile';
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
 *
 * `filters` names the packages to build. Passing none lets turbo infer its own
 * scope from the working directory, which for a workspace root means the
 * workspace package itself — and since that package's `build` script is
 * `gkm build`, inferring is how you get a build that runs itself forever.
 * `workspaceBuildCommand` always names the apps.
 *
 * @internal Exported for testing
 */
export function getTurboCommand(
	pm: 'pnpm' | 'npm' | 'yarn',
	filters: string | readonly string[] = [],
	/** Build only the named packages, not what they depend on. */
	{ only = false }: { only?: boolean } = {},
): string {
	const list = typeof filters === 'string' ? [filters] : filters;
	const filterArgs =
		list.map((f) => ` --filter=${f}`).join('') + (only ? ' --only' : '');
	switch (pm) {
		case 'pnpm':
			return `pnpm exec turbo run build${filterArgs}`;
		case 'yarn':
			return `yarn turbo run build${filterArgs}`;
		case 'npm':
			return `npx turbo run build${filterArgs}`;
	}
}

/**
 * The package names turbo should build: one per app in the workspace.
 *
 * Read from each app's own `package.json`, because that is the name turbo
 * knows it by — and the name `loadAppConfig` reads back when turbo runs
 * `gkm build` inside the app, which is what routes that invocation to the
 * single-app path instead of back here.
 *
 * An app without a `package.json` is not a package turbo can run, so it is
 * reported rather than silently skipped.
 *
 * @internal Exported for testing
 */
export function turboFilters(
	workspace: NormalizedWorkspace,
	{ exclude }: { exclude?: NormalizedAppConfig['type'] } = {},
): {
	filters: string[];
	unpackaged: string[];
} {
	const filters: string[] = [];
	const unpackaged: string[] = [];

	for (const [appName, app] of Object.entries(workspace.apps)) {
		if (app.type === exclude) continue;
		const name = appPackageName(workspace, appName);
		if (name) filters.push(name);
		else unpackaged.push(appName);
	}

	return { filters, unpackaged };
}

/**
 * The package name turbo knows an app by, from its own `package.json`.
 *
 * Not the app's key: `api` in the workspace is `@shop/api` to turbo, and a
 * filter naming the key matches nothing.
 */
export function appPackageName(
	workspace: NormalizedWorkspace,
	appName: string,
): string | undefined {
	const app = workspace.apps[appName];
	if (!app) return undefined;

	const pkgPath = join(workspace.root, app.path, 'package.json');
	if (!existsSync(pkgPath)) return undefined;

	const name = JSON.parse(readFileSync(pkgPath, 'utf8')).name;
	return typeof name === 'string' && name.length > 0 ? name : undefined;
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
	const frontendApps = apps.filter(([, app]) => app.type === 'web');

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

	try {
		// The backends here, in this process, because the manifest is the
		// application's: the root builds each one, then writes it once from
		// everything they generated and everything the workspace declares.
		const target = options.provider ?? providerOf(workspace);
		const builds: AppBuild[] = [];
		for (const appName of buildOrder) {
			const app = workspace.apps[appName];
			const config = getAppGkmConfig(workspace, appName);
			if (!app || app.type !== 'backend' || !config) continue;

			logger.log(`\n⚙️  ${appName}`);
			const output = await buildOneApp({
				config,
				options,
				workspace,
				appRoot: join(workspace.root, app.path),
				target,
			});
			if (output.built) builds.push(output.built);
		}

		await writeManifest({
			workspaceRoot: workspace.root,
			target,
			builds,
			constructs: await discover({
				patterns: allConstructGlobs(workspace),
				cwd: workspace.root,
			}),
			backends: backendsOf(workspace),
		});

		// Everything else is its own toolchain's — Vite, Next — through turbo.
		const { filters, unpackaged } = turboFilters(workspace, {
			exclude: 'backend',
		});
		if (unpackaged.length > 0) {
			throw new Error(
				`No package.json for workspace app(s): ${unpackaged.join(', ')}. ` +
					`Each app needs one — turbo builds packages, and gkm reads the ` +
					`name back to know which app it is building.`,
			);
		}
		const pm = detectPackageManager();
		const turboCommand = getTurboCommand(pm, filters, { only: true });

		if (filters.length > 0) {
			logger.log(`\n📦 Using ${pm} with Turbo for the other apps...\n`);
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
		}

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

		// No OpenAPI pass here. Each backend's build above wrote its surfaces'
		// clients to the root's `.gkm/client/<surface>.ts` before turbo built
		// the sites that import them as `@<name>/client/<surface>`.

		// Summary
		logger.log(`\n📋 Build Summary:`);
		for (const result of results) {
			const icon =
				result.type === 'backend'
					? '⚙️'
					: result.type === 'mobile'
						? '📱'
						: '🌐';
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

	if (app.type === 'mobile') {
		// Mobile builds are produced by the framework's own toolchain
		// (e.g. EAS Build) — no local output path.
		return '';
	}
	if (app.type === 'web') {
		switch (app.framework) {
			case 'vite':
			case 'tanstack-start':
				return join(appPath, 'dist');
			case 'remix':
				return join(appPath, 'build');
			default:
				return join(appPath, '.next');
		}
	}
	// Backend .gkm output
	return join(appPath, '.gkm');
}

/** Format routes for logging. */
function formatRoutes(routes: Routes): string {
	return Array.isArray(routes) ? routes.join(', ') : routes;
}
