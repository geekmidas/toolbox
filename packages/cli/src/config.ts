import { existsSync } from 'fs';
import { join } from 'path';
import type { GkmConfig } from './types.js';

export async function loadConfig(): Promise<GkmConfig> {
  const configPath = join(process.cwd(), 'gkm.config.ts');
  
  if (!existsSync(configPath)) {
    throw new Error('gkm.config.ts not found. Please create a configuration file.');
  }
  
  try {
    const config = await import(configPath);
    return config.default || config;
  } catch (error) {
    throw new Error(`Failed to load gkm.config.ts: ${(error as Error).message}`);
  }
}