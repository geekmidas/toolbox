import type { GeneratedFile, TemplateConfig, TemplateOptions } from './index.js';

export const minimalTemplate: TemplateConfig = {
  name: 'minimal',
  description: 'Basic health endpoint',

  dependencies: {
    '@geekmidas/constructs': 'workspace:*',
    '@geekmidas/envkit': 'workspace:*',
    '@geekmidas/logger': 'workspace:*',
    hono: '~4.8.2',
    pino: '~9.6.0',
  },

  devDependencies: {
    '@biomejs/biome': '~1.9.4',
    '@geekmidas/cli': 'workspace:*',
    '@types/node': '~22.0.0',
    tsx: '~4.20.0',
    turbo: '~2.3.0',
    typescript: '~5.8.2',
    vitest: '~4.0.0',
  },

  scripts: {
    dev: 'gkm dev',
    build: 'gkm build',
    test: 'vitest',
    'test:once': 'vitest run',
    typecheck: 'tsc --noEmit',
    lint: 'biome lint .',
    fmt: 'biome format . --write',
    'fmt:check': 'biome format .',
  },

  files: (options: TemplateOptions): GeneratedFile[] => {
    const files: GeneratedFile[] = [
      // src/config/env.ts
      {
        path: 'src/config/env.ts',
        content: `import { EnvironmentParser } from '@geekmidas/envkit';

export const envParser = new EnvironmentParser(process.env);

export const config = envParser
  .create((get) => ({
    port: get('PORT').string().transform(Number).default(3000),
    nodeEnv: get('NODE_ENV').string().default('development'),
  }))
  .parse();
`,
      },

      // src/config/logger.ts - using pino
      {
        path: 'src/config/logger.ts',
        content: `import { PinoLogger } from '@geekmidas/logger/pino';

export const logger = new PinoLogger({
  app: '${options.name}',
  level: process.env.LOG_LEVEL || 'info',
});
`,
      },

      // src/endpoints/health.ts
      {
        path: 'src/endpoints/health.ts',
        content: `import { e } from '@geekmidas/constructs/endpoints';

export default e
  .get('/health')
  .handle(async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));
`,
      },
    ];

    // Add Telescope config if enabled
    if (options.telescope) {
      files.push({
        path: 'src/config/telescope.ts',
        content: `import { Telescope } from '@geekmidas/telescope';
import { InMemoryStorage } from '@geekmidas/telescope/storage/memory';

export const telescope = new Telescope({
  storage: new InMemoryStorage({ maxEntries: 100 }),
  enabled: process.env.NODE_ENV === 'development',
});
`,
      });
    }

    return files;
  },
};
