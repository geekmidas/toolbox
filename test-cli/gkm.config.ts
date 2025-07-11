import type { GkmConfig } from '@geekmidas/cli';

const config: GkmConfig = {
  routes: 'src/routes/**/*.ts',
  envParser: './src/env.ts#envParser',
  logger: './src/logger.ts#logger'
};

export default config;