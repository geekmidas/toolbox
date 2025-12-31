import { existsSync } from 'fs';
import { join } from 'path';
import type { GkmConfig } from './types.ts';

export type { GkmConfig } from './types.ts';
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
  const [path, exportName] = configString.split('#');
  const importPattern = !exportName
    ? defaultAlias
    : exportName === defaultAlias
      ? `{ ${defaultAlias} }`
      : `{ ${exportName} as ${defaultAlias} }`;

  return { path, importPattern };
}

export async function loadConfig(
  cwd: string = process.cwd(),
): Promise<GkmConfig> {
  const files = ['gkm.config.json', 'gkm.config.ts', 'gkm.config.js'];
  let configPath = '';

  for (const file of files) {
    const path = join(cwd, file);
    if (existsSync(path)) {
      configPath = path;
      break;
    }
  }

  if (!configPath) {
    throw new Error(
      'Configuration file not found. Please create gkm.config.json, gkm.config.ts, or gkm.config.js in the project root.',
    );
  }

  try {
    const config = await import(configPath);
    return config.default;
  } catch (error) {
    throw new Error(
      `Failed to load gkm.config.json: ${(error as Error).message}`,
    );
  }
}
