import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, parse, resolve, sep } from 'node:path';
import { output } from './output.js';
import { discover } from './reconcile/discover.js';
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

/** No gkm config in a directory or any of its parents. */
export class ConfigNotFound extends Error {
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

/**
 * Load raw configuration from file.
 */
async function loadRawConfig(cwd: string): Promise<RawConfigResult> {
	const { configPath, workspaceRoot } = findConfigPath(cwd);

	try {
		const config = await import(configPath);
		return {
			config: config.default,
			workspaceRoot,
		};
	} catch (error) {
		throw new Error(`Failed to load config: ${(error as Error).message}`);
	}
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
): Promise<LoadedConfig['workspace']> {
	const { config, workspaceRoot } = await loadRawConfig(cwd);
	return processConfig(config, workspaceRoot).workspace;
}

export async function loadWorkspaceConfig(
	cwd: string = process.cwd(),
): Promise<LoadedConfig> {
	const { config, workspaceRoot } = await loadRawConfig(cwd);
	return withDerivedApps(processConfig(config, workspaceRoot));
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
async function withDerivedApps(loaded: LoadedConfig): Promise<LoadedConfig> {
	const globs = allConstructGlobs(loaded.workspace);
	if (globs.length === 0) {
		throw new WorkspaceDeclaresNoConstructs(loaded.workspace.root);
	}

	try {
		const manifest = await discover({
			patterns: globs,
			cwd: loaded.workspace.root,
		});

		return {
			...loaded,
			manifest,
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
export class WorkspaceDeclaresNoConstructs extends Error {
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
export class NotInAnApp extends Error {
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
export class NotABackendApp extends Error {
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
