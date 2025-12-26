import { existsSync } from 'fs';
import { join } from 'path';
import type { GkmConfig } from './types.ts';

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
