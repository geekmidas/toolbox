import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, parse, resolve, sep } from 'node:path';
import { z } from 'zod';
import { GkmError } from './errors';
import { output } from './output.js';
import { discover } from './reconcile/discover.js';
import { activeSandbox, type Sandbox } from './sandbox/sandbox.js';
import { runWorker } from './sandbox/worker.js';
import type { GkmConfig } from './types.js';
import { derivedApps } from './workspace/derive.js';
import {
	allConstructGlobs,
	getAppGkmConfig,
	isWorkspaceConfig,
	type LoadedConfig,
	type NormalizedAppConfig,
	type NormalizedWorkspace,
	processConfig,
	type WorkspaceConfig,
} from './workspace/index.js';

// What `gkm dev`'s discovery endpoint answers, for the tools that read it.
export type {
	AppStatus,
	DataApiKind,
	DiscoveredApp,
	DiscoveredDataApi,
	DiscoveredWorkspace,
	DiscoveryEvent,
	DiscoveryResponse,
} from './dev/discovery.js';
export type { GkmConfig } from './types.js';
export type { LoadedConfig, WorkspaceConfig } from './workspace/index.js';
export { defineWorkspace } from './workspace/index.js';
export type { DevConfig } from './workspace/types.js';
/**
 * Define GKM configuration with full TypeScript support.
 * This is an identity function that provides type safety and autocomplete.
 *
 * @example
 * ```ts
 * // gkm.config.ts
 * import { defineConfig } from '@geekmidas/cli/config';
 *
 * export default defineConfig({
 *   routes: './src/endpoints/**\/*.ts',
 *   envParser: './src/config/env',
 *   logger: './src/config/logger',
 *   telescope: true,
 * });
 * ```
 */
export function defineConfig(config: GkmConfig): GkmConfig {
	return config;
}

export interface ParsedModuleConfig {
	path: string;
	importPattern: string;
}

/**
 * Parse a module config string into path and import pattern.
 *
 * @param configString - Config string in format "./path/to/module" or "./path/to/module#exportName"
 * @param defaultAlias - The default alias name to use if no export name specified
 * @returns Object with path and import pattern
 *
 * @example
 * parseModuleConfig('./src/config/env', 'envParser')
 * // { path: './src/config/env', importPattern: 'envParser' }
 *
 * parseModuleConfig('./src/config/env#envParser', 'envParser')
 * // { path: './src/config/env', importPattern: '{ envParser }' }
 *
 * parseModuleConfig('./src/config/env#myEnv', 'envParser')
 * // { path: './src/config/env', importPattern: '{ myEnv as envParser }' }
 */
export function parseModuleConfig(
	configString: string,
	defaultAlias: string,
): ParsedModuleConfig {
	const parts = configString.split('#');
	const path = parts[0] ?? configString;
	const exportName = parts[1];
	const importPattern = !exportName
		? defaultAlias
		: exportName === defaultAlias
			? `{ ${defaultAlias} }`
			: `{ ${exportName} as ${defaultAlias} }`;

	return { path, importPattern };
}

export interface ConfigDiscoveryResult {
	configPath: string;
	workspaceRoot: string;
}

/**
 * Find and return the path to the config file.
 *
 * Resolution order:
 * 1. GKM_CONFIG_PATH env var (set by workspace dev command)
 * 2. Walk up directory tree from cwd
 */
function findConfigPath(cwd: string): ConfigDiscoveryResult {
	const files = ['gkm.config.json', 'gkm.config.ts', 'gkm.config.js'];

	// Check GKM_CONFIG_PATH env var first (set by workspace dev command)
	const envConfigPath = process.env.GKM_CONFIG_PATH;
	if (envConfigPath && existsSync(envConfigPath)) {
		return {
			configPath: envConfigPath,
			workspaceRoot: dirname(envConfigPath),
		};
	}

	// Walk up directory tree to find config
	let currentDir = cwd;
	const { root } = parse(currentDir);

	while (currentDir !== root) {
		for (const file of files) {
			const configPath = join(currentDir, file);
			if (existsSync(configPath)) {
				return {
					configPath,
					workspaceRoot: currentDir,
				};
			}
		}
		currentDir = dirname(currentDir);
	}

	throw new ConfigNotFound(cwd);
}

/**
 * The directory holding the gkm config that `cwd` belongs to — the project a
 * sandbox for it is confined to.
 *
 * @throws {ConfigNotFound} when neither `cwd` nor any parent has one.
 */
export function findWorkspaceRoot(cwd: string): string {
	return findConfigPath(cwd).workspaceRoot;
}

/** No gkm config in a directory or any of its parents. */
export class ConfigNotFound extends GkmError {
	constructor(readonly cwd: string) {
		super(
			'Configuration file not found. Please create gkm.config.json, gkm.config.ts, or gkm.config.js in the project root.',
		);
		this.name = 'ConfigNotFound';
	}
}

interface RawConfigResult {
	config: GkmConfig | WorkspaceConfig;
	workspaceRoot: string;
}

export interface LoadConfigOptions {
	/**
	 * Load the config — and discover the constructs it names — in this
	 * sandbox rather than in this process. The config then arrives as data;
	 * see {@link Sandbox.isolating} for what happens to one holding live
	 * objects. Defaults to the run's own (`withSandbox`); with neither, the
	 * config is imported here, as `gkm` always has.
	 */
	sandbox?: Sandbox;
	/**
	 * How long the sandboxed config load may run. Defaults to
	 * {@link CONFIG_LOAD_TIMEOUT_MS}.
	 */
	timeoutMs?: number;
}

/**
 * How long loading a config, or discovering its constructs, may take in a
 * sandbox: room for tsx to compile a large project cold, and not a deploy
 * held open by a config that never finishes importing.
 */
export const CONFIG_LOAD_TIMEOUT_MS = 60_000;

/** The config failed to import, or threw while it ran. */
export class ConfigLoadFailed extends Error {
	constructor(
		readonly configPath: string,
		readonly detail: string,
	) {
		super(`Failed to load config: ${detail}`);
		this.name = 'ConfigLoadFailed';
	}
}

/**
 * The config holds something that is not data — a custom state store, an
 * inline deploy target, a function — and the sandbox it was loaded in hands
 * the deploy nothing but data.
 */
export class ConfigObjectNotSerializable extends Error {
	constructor(
		readonly configPath: string,
		readonly paths: readonly string[],
	) {
		super(
			`${configPath} holds values that are not plain data at: ` +
				`${paths.join(', ')}. It was loaded in an isolating sandbox, which ` +
				'hands the deploy the config as JSON, so a live object — a custom ' +
				'store, an inline target, a function — cannot reach it. Configure ' +
				'these with plain values instead, or deploy this project with a ' +
				'sandbox that is not isolating (the default) if the host trusts it.',
		);
		this.name = 'ConfigObjectNotSerializable';
	}
}

/** What the config worker answers. Checked: the worker ran project code. */
const ConfigAnswer = z.discriminatedUnion('reason', [
	z.object({
		reason: z.literal('loaded'),
		config: z.record(z.string(), z.unknown()),
	}),
	z.object({ reason: z.literal('live'), paths: z.array(z.string()) }),
	z.object({
		reason: z.literal('failed'),
		error: z.object({ name: z.string(), message: z.string() }),
	}),
]);

/** Import the config in this process — live objects and all. */
async function importConfig(
	configPath: string,
): Promise<GkmConfig | WorkspaceConfig> {
	try {
		const config = await import(configPath);
		return config.default;
	} catch (error) {
		throw new ConfigLoadFailed(configPath, (error as Error).message);
	}
}

/**
 * The config, loaded in `sandbox` and handed back as JSON.
 *
 * A config holding live objects cannot come back that way. An isolating
 * sandbox refuses it with {@link ConfigObjectNotSerializable}; any other
 * imports it here as well, as before, since the host already runs this
 * project's code as its own.
 */
async function loadConfigInSandbox(
	sandbox: Sandbox,
	configPath: string,
	workspaceRoot: string,
	timeoutMs = CONFIG_LOAD_TIMEOUT_MS,
): Promise<GkmConfig | WorkspaceConfig> {
	const { value } = await runWorker(sandbox, 'config load', {
		name: 'config-worker',
		args: [configPath],
		cwd: workspaceRoot,
		timeoutMs,
		schema: ConfigAnswer,
	});

	switch (value.reason) {
		case 'loaded':
			// Its shape is `processConfig`'s to check, against the workspace
			// schema, exactly as for a config imported here.
			return value.config as unknown as GkmConfig | WorkspaceConfig;
		case 'failed':
			throw new ConfigLoadFailed(configPath, value.error.message);
		case 'live':
			if (sandbox.isolating) {
				throw new ConfigObjectNotSerializable(configPath, value.paths);
			}
			return importConfig(configPath);
	}
}

/**
 * Load raw configuration from file.
 */
async function loadRawConfig(
	cwd: string,
	options: LoadConfigOptions = {},
): Promise<RawConfigResult> {
	const { configPath, workspaceRoot } = findConfigPath(cwd);
	// The run's own sandbox when none is given: a deploy reloads the config
	// deep in the engine (generating Dockerfiles), and that load is the
	// project's code as much as the first.
	const sandbox = options.sandbox ?? activeSandbox();
	const config = sandbox
		? await loadConfigInSandbox(
				sandbox,
				configPath,
				workspaceRoot,
				options.timeoutMs,
			)
		: await importConfig(configPath);

	return { config, workspaceRoot };
}

/**
 * Load configuration file (single-app format).
 * For backwards compatibility with existing code.
 *
 * @deprecated Use loadWorkspaceConfig for new code
 */
export async function loadConfig(
	cwd: string = process.cwd(),
): Promise<GkmConfig> {
	const { config } = await loadRawConfig(cwd);

	// If it's a workspace config, throw an error
	if (isWorkspaceConfig(config)) {
		throw new Error(
			'Workspace configuration detected. Use loadWorkspaceConfig() instead.',
		);
	}

	return config;
}

/**
 * Load configuration file and process it as a workspace.
 * Works with both single-app and workspace configurations.
 *
 * Single-app configs are automatically wrapped as a workspace with one app.
 *
 * @example
 * ```ts
 * const { type, workspace } = await loadWorkspaceConfig();
 *
 * if (type === 'workspace') {
 *   console.log('Multi-app workspace:', workspace.apps);
 * } else {
 *   console.log('Single app wrapped as workspace');
 * }
 * ```
 */
/**
 * The workspace a directory belongs to, as its config states it — without
 * discovering its constructs.
 *
 * For callers that need a fact the config holds (where a stage's secrets are
 * stored) and nothing the graph adds. `loadWorkspaceConfig` imports every
 * construct module to derive the apps, which is a cost a secrets read should
 * not pay.
 */
export async function loadWorkspaceSettings(
	cwd: string = process.cwd(),
	options: LoadConfigOptions = {},
): Promise<LoadedConfig['workspace']> {
	const { config, workspaceRoot } = await loadRawConfig(cwd, options);
	return processConfig(config, workspaceRoot).workspace;
}

export async function loadWorkspaceConfig(
	cwd: string = process.cwd(),
	options: LoadConfigOptions = {},
): Promise<LoadedConfig> {
	const { config, workspaceRoot } = await loadRawConfig(cwd, options);
	return withDerivedApps(processConfig(config, workspaceRoot), options.sandbox);
}

/**
 * The loaded config, with its apps read off the graph.
 *
 * Here rather than at each call site because every command needs the same
 * answer, and the ones that forgot to ask were exactly the bugs: a site that
 * never deployed, a surface that could not be its own process. `gkm dev`,
 * `gkm build`, `gkm docker` and `gkm deploy` now all see the same apps without
 * any of them knowing a derivation happened.
 *
 * Discovery imports the construct modules — declarations only, not endpoints —
 * which is the same import the reconciler and the build already do. A workspace
 * with no `constructs` glob discovers nothing and keeps whatever its config
 * said, so nothing that worked before changes.
 *
 * A construct file that throws is reported and skipped rather than taking the
 * command down: `gkm dev` failing to start because a half-written declaration
 * cannot be imported is a worse failure than starting with the app it does not
 * describe yet.
 */
async function withDerivedApps(
	loaded: LoadedConfig,
	sandbox?: Sandbox,
): Promise<LoadedConfig> {
	const globs = allConstructGlobs(loaded.workspace);
	if (globs.length === 0) {
		throw new WorkspaceDeclaresNoConstructs(loaded.workspace.root);
	}

	try {
		const background: Record<string, string[]> = {};
		const manifest = await discover({
			patterns: globs,
			cwd: loaded.workspace.root,
			background,
			...(sandbox ? { sandbox } : {}),
		});

		return {
			...loaded,
			manifest,
			background,
			workspace: {
				...loaded.workspace,
				apps: derivedApps(manifest, loaded.workspace),
			},
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		output.warn(
			`⚠️  Could not read constructs, so apps come from config alone: ${message}`,
		);
		return loaded;
	}
}

/**
 * A workspace with no `constructs` glob.
 *
 * In v10 every address, container and app comes from what the workspace
 * declares — there is no second path that reads a hand-written compose file or
 * an `apps` block's ports. A config that declares nothing has nothing to run.
 */
export class WorkspaceDeclaresNoConstructs extends GkmError {
	constructor(readonly root: string) {
		super(
			`The workspace at ${root} declares no constructs. Every workspace names ` +
				"where its constructs live — `constructs: ['./constructs/**/*.ts', " +
				"'./apps/*/endpoints/**/*.ts']` in gkm.config.ts — and its apps, " +
				'containers and URLs are derived from them.',
		);
		this.name = 'WorkspaceDeclaresNoConstructs';
	}
}

export interface AppConfigResult {
	appName: string;
	app: NormalizedAppConfig;
	gkmConfig: GkmConfig;
	workspace: NormalizedWorkspace;
	workspaceRoot: string;
	appRoot: string;
}

/**
 * The app a directory is part of: the one whose `path` contains it.
 *
 * An app's path is the one its construct declares — `new RestApi('Api',
 * { path: 'apps/api' })` — read off the workspace the constructs were derived
 * into, never off the filesystem's package names. The deepest match wins, so
 * an app inside another app's folder is its own; the workspace root belongs to
 * no app unless one lives there.
 */
function resolveWorkspaceApp(
	loadedConfig: LoadedConfig,
	cwd: string,
): { key: string; app: NormalizedAppConfig } | undefined {
	const here = real(cwd);
	let found: { key: string; app: NormalizedAppConfig; dir: string } | undefined;

	for (const [key, app] of Object.entries(loadedConfig.workspace.apps)) {
		const dir = real(join(loadedConfig.workspace.root, app.path));
		const inside = here === dir || here.startsWith(`${dir}${sep}`);
		if (inside && (!found || dir.length > found.dir.length)) {
			found = { key, app, dir };
		}
	}

	return found && { key: found.key, app: found.app };
}

/** A path with its symlinks resolved, where it exists — `/tmp` is `/private/tmp`. */
function real(path: string): string {
	const absolute = resolve(path);
	return existsSync(absolute) ? realpathSync(absolute) : absolute;
}

/** A directory that no app in the workspace lives in. */
export class NotInAnApp extends GkmError {
	constructor(
		readonly cwd: string,
		readonly apps: Readonly<Record<string, string>>,
	) {
		super(
			`${cwd} is not inside any app's path. Apps: ` +
				Object.entries(apps)
					.map(([key, path]) => `${key} (${path})`)
					.join(', ') +
				'.',
		);
		this.name = 'NotInAnApp';
	}
}

/** Every app's path, by key — what `NotInAnApp` lists. */
function appPaths(loadedConfig: LoadedConfig): Record<string, string> {
	return Object.fromEntries(
		Object.entries(loadedConfig.workspace.apps).map(([key, app]) => [
			key,
			app.path,
		]),
	);
}

/**
 * The backend app a directory is part of, with its gkm config — found by the
 * `path` its construct declares.
 *
 * @example
 * ```ts
 * // From apps/api, where a construct declares `path: 'apps/api'`
 * const { app, workspace, workspaceRoot } = await loadAppConfig();
 * ```
 *
 * @throws {NotInAnApp} when no app's path contains the directory.
 * @throws {NotABackendApp} when the app it is in has no gkm config to run.
 */
export async function loadAppConfig(
	cwd: string = process.cwd(),
): Promise<AppConfigResult> {
	const { appName, app, workspace, workspaceRoot } =
		await loadWorkspaceAppInfo(cwd);

	const gkmConfig = getAppGkmConfig(workspace, appName);
	if (!gkmConfig) throw new NotABackendApp(appName);

	return {
		appName,
		app,
		gkmConfig,
		workspace,
		workspaceRoot,
		appRoot: join(workspaceRoot, app.path),
	};
}

/** The app a directory is in has no gkm config — a site, or an entry app. */
export class NotABackendApp extends GkmError {
	constructor(readonly appName: string) {
		super(
			`App "${appName}" is not a backend app and cannot be run with gkm dev.`,
		);
		this.name = 'NotABackendApp';
	}
}

export interface WorkspaceAppInfo {
	/** The app's key in the workspace. */
	appName: string;
	app: NormalizedAppConfig;
	workspace: NormalizedWorkspace;
	workspaceRoot: string;
}

/**
 * The app a directory is part of, frontend or backend — found by the `path`
 * its construct declares. Unlike `loadAppConfig`, the app need not have a
 * gkm config, which is what `gkm exec` and `gkm test` from a site need.
 *
 * @throws {NotInAnApp} when no app's path contains the directory.
 */
export async function loadWorkspaceAppInfo(
	cwd: string = process.cwd(),
): Promise<WorkspaceAppInfo> {
	const { config, workspaceRoot } = await loadRawConfig(cwd);
	const loadedConfig = await withDerivedApps(
		processConfig(config, workspaceRoot),
	);

	const resolved = resolveWorkspaceApp(loadedConfig, cwd);
	if (!resolved) throw new NotInAnApp(cwd, appPaths(loadedConfig));

	return {
		appName: resolved.key,
		app: resolved.app,
		workspace: loadedConfig.workspace,
		workspaceRoot,
	};
}
