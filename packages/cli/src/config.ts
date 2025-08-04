import { existsSync } from 'fs';
import { join } from 'path';
import { readFile } from 'fs/promises';
import type { GkmConfig } from './types.ts';

export async function loadConfig(): Promise<GkmConfig> {
  const configPath = join(process.cwd(), 'gkm.config.json');

  if (!existsSync(configPath)) {
    throw new Error(
      'gkm.config.json not found. Please create a configuration file.',
    );
  }

  try {
    const config = await readFile(configPath, 'utf-8');
    return JSON.parse(config);
  } catch (error) {
    throw new Error(
      `Failed to load gkm.config.json: ${(error as Error).message}`,
    );
  }
}
