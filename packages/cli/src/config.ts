import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GkmConfig } from './types.js';
import {
	type LoadedConfig,
	type WorkspaceConfig,
	isWorkspaceConfig,
	processConfig,
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

/**
 * Find and return the path to the config file.
 */
function findConfigPath(cwd: string): string {
	const files = ['gkm.config.json', 'gkm.config.ts', 'gkm.config.js'];

	for (const file of files) {
		const path = join(cwd, file);
		if (existsSync(path)) {
			return path;
		}
	}

	throw new Error(
		'Configuration file not found. Please create gkm.config.json, gkm.config.ts, or gkm.config.js in the project root.',
	);
}

/**
 * Load raw configuration from file.
 */
async function loadRawConfig(
	cwd: string,
): Promise<GkmConfig | WorkspaceConfig> {
	const configPath = findConfigPath(cwd);

	try {
		const config = await import(configPath);
		return config.default;
	} catch (error) {
		throw new Error(
			`Failed to load config: ${(error as Error).message}`,
		);
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
	const config = await loadRawConfig(cwd);

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
	const config = await loadRawConfig(cwd);
	return processConfig(config, cwd);
}
