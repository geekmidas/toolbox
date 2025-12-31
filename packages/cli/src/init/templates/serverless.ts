import type {
  GeneratedFile,
  TemplateConfig,
  TemplateOptions,
} from './index.js';

export const serverlessTemplate: TemplateConfig = {
  name: 'serverless',
  description: 'AWS Lambda handlers',

  dependencies: {
    '@geekmidas/constructs': 'workspace:*',
    '@geekmidas/envkit': 'workspace:*',
    '@geekmidas/logger': 'workspace:*',
    '@geekmidas/cloud': 'workspace:*',
    hono: '~4.8.2',
    pino: '~9.6.0',
  },

  devDependencies: {
    '@biomejs/biome': '~1.9.4',
    '@geekmidas/cli': 'workspace:*',
    '@types/aws-lambda': '~8.10.92',
    '@types/node': '~22.0.0',
    tsx: '~4.20.0',
    turbo: '~2.3.0',
    typescript: '~5.8.2',
    vitest: '~4.0.0',
  },

  scripts: {
    dev: 'gkm dev',
    build: 'gkm build --provider aws-apigatewayv2',
    test: 'vitest',
    'test:once': 'vitest run',
    typecheck: 'tsc --noEmit',
    lint: 'biome lint .',
    fmt: 'biome format . --write',
    'fmt:check': 'biome format .',
  },

  files: (options: TemplateOptions): GeneratedFile[] => {
    const { loggerType, routesStructure } = options;

    const loggerContent = `import { createLogger } from '@geekmidas/logger/${loggerType}';

export const logger = createLogger();
`;

    // Get route path based on structure
    const getRoutePath = (domain: string, file: string) => {
      switch (routesStructure) {
        case 'centralized-endpoints':
          return `src/endpoints/${domain}/${file}`;
        case 'centralized-routes':
          return `src/routes/${domain}/${file}`;
        case 'domain-based':
          return `src/${domain}/routes/${file}`;
      }
    };

    const files: GeneratedFile[] = [
      // src/config/env.ts
      {
        path: 'src/config/env.ts',
        content: `import { EnvironmentParser } from '@geekmidas/envkit';

export const envParser = new EnvironmentParser(process.env);

export const config = envParser
  .create((get) => ({
    stage: get('STAGE').string().default('dev'),
    region: get('AWS_REGION').string().default('us-east-1'),${
      options.database
        ? `
    database: {
      url: get('DATABASE_URL').string(),
    },`
        : ''
    }
  }))
  .parse();
`,
      },

      // src/config/logger.ts
      {
        path: 'src/config/logger.ts',
        content: loggerContent,
      },

      // health endpoint
      {
        path: getRoutePath('health', 'index.ts'),
        content: `import { e } from '@geekmidas/constructs/endpoints';

export default e
  .get('/health')
  .handle(async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    region: process.env.AWS_REGION || 'local',
  }));
`,
      },

      // src/functions/hello.ts
      {
        path: 'src/functions/hello.ts',
        content: `import { f } from '@geekmidas/constructs/functions';
import { z } from 'zod';

export default f
  .input(z.object({ name: z.string() }))
  .output(z.object({ message: z.string() }))
  .handle(async ({ input }) => ({
    message: \`Hello, \${input.name}!\`,
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

// Note: For production Lambda, consider using a persistent storage
export const telescope = new Telescope({
  storage: new InMemoryStorage({ maxEntries: 50 }),
  enabled: process.env.STAGE === 'dev',
});
`,
      });
    }

    return files;
  },
};
