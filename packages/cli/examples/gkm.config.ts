import type { GkmConfig } from '@geekmidas/cli';

const config: GkmConfig = {
  // Glob pattern to find endpoint files
  routes: 'src/routes/**/*.ts',
  
  // Environment parser configuration
  // Format: path#exportName (if no #exportName, treats as default import)
  envParser: './src/env.ts#envParser',
  
  // Logger configuration
  // Format: path#exportName (if no #exportName, treats as default import)
  logger: './src/logger.ts#logger'
};

export default config;