import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import type { GkmConfig } from './types.js';
import {
	getAppGkmConfig,
	isWorkspaceConfig,
	type LoadedConfig,
	type NormalizedAppConfig,
	type NormalizedWorkspace,
	processConfig,
	type WorkspaceConfig,
} from './workspace/index.js';

export type { GkmConfig } from './types.js';
export type { LoadedConfig, WorkspaceConfig } from './workspace/index.js';
export { defineWorkspace } from './workspace/index.js';
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

	throw new Error(
		'Configuration file not found. Please create gkm.config.json, gkm.config.ts, or gkm.config.js in the project root.',
	);
}

/**
 * Get app name from package.json in the given directory.
 * Handles scoped packages by extracting the name after the scope.
 *
 * @example
 * getAppNameFromCwd('/path/to/apps/api')
 * // package.json: { "name": "@myorg/api" }
 * // Returns: 'api'
 */
export function getAppNameFromCwd(cwd: string = process.cwd()): string | null {
	const packageJsonPath = join(cwd, 'package.json');

	if (!existsSync(packageJsonPath)) {
		return null;
	}

	try {
		const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
		const name = packageJson.name as string | undefined;

		if (!name) {
			return null;
		}

		// Handle scoped packages: @scope/name -> name
		if (name.startsWith('@') && name.includes('/')) {
			return name.split('/')[1] ?? null;
		}

		return name;
	} catch {
		return null;
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
export async function loadWorkspaceConfig(
	cwd: string = process.cwd(),
): Promise<LoadedConfig> {
	const { config, workspaceRoot } = await loadRawConfig(cwd);
	return processConfig(config, workspaceRoot);
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
 * Load app-specific configuration from workspace.
 * Uses the app name from package.json to find the correct app config.
 *
 * @example
 * ```ts
 * // From apps/api directory with package.json: { "name": "@myorg/api" }
 * const { app, workspace, workspaceRoot } = await loadAppConfig();
 * console.log(app.routes); // './src/endpoints/**\/*.ts'
 * ```
 */
export async function loadAppConfig(
	cwd: string = process.cwd(),
): Promise<AppConfigResult> {
	const appName = getAppNameFromCwd(cwd);

	if (!appName) {
		throw new Error(
			'Could not determine app name. Ensure package.json exists with a "name" field.',
		);
	}

	const { config, workspaceRoot } = await loadRawConfig(cwd);
	const loadedConfig = processConfig(config, workspaceRoot);

	// Find the app in workspace (apps is a Record<string, NormalizedAppConfig>)
	const app = loadedConfig.workspace.apps[appName];

	if (!app) {
		const availableApps = Object.keys(loadedConfig.workspace.apps).join(', ');
		throw new Error(
			`App "${appName}" not found in workspace config. Available apps: ${availableApps}. ` +
				`Ensure the package.json name matches the app key in gkm.config.ts.`,
		);
	}

	// Get the app's GKM config using the helper
	const gkmConfig = getAppGkmConfig(loadedConfig.workspace, appName);

	if (!gkmConfig) {
		throw new Error(
			`App "${appName}" is not a backend app and cannot be run with gkm dev.`,
		);
	}

	return {
		appName,
		app,
		gkmConfig,
		workspace: loadedConfig.workspace,
		workspaceRoot,
		appRoot: join(workspaceRoot, app.path),
	};
}
