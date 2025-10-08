import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { itWithDir } from '@geekmidas/testkit/os';
import { describe, expect, vi } from 'vitest';
import {
  createMockCronFile,
  createMockEndpointFile,
  createMockFunctionFile,
  createTestFile,
} from '../../__tests__/test-helpers';
import { buildCommand } from '../index-new';

describe('buildCommand', () => {
  itWithDir(
    'should build endpoints, functions, and crons for multiple providers',
    async ({ dir }) => {
      // Create test files that will be discovered
      await createMockEndpointFile(
        dir,
        'src/endpoints/users.ts',
        'getUsersEndpoint',
        '/users',
        'GET',
      );
      await createMockEndpointFile(
        dir,
        'src/endpoints/posts.ts',
        'getPostsEndpoint',
        '/posts',
        'GET',
      );
      await createMockFunctionFile(
        dir,
        'src/functions/process.ts',
        'processDataFunction',
        60,
      );
      await createMockCronFile(
        dir,
        'src/crons/cleanup.ts',
        'cleanupCron',
        'rate(1 day)',
      );

      // Create a basic config file
      await createTestFile(
        dir,
        'gkm.config.ts',
        `
export default {
  routes: './src/endpoints/**/*.ts',
  functions: './src/functions/**/*.ts',
  crons: './src/crons/**/*.ts',
  envParser: './config/env',
  logger: './config/logger',
};
`,
      );

      // Create env and logger files
      await createTestFile(dir, 'config/env.ts', 'export default {}');
      await createTestFile(dir, 'config/logger.ts', 'export default {}');

      const originalCwd = process.cwd();
      process.chdir(dir);

      try {
        await buildCommand({ provider: 'server' });

        // Check that output directories were created
        const serverDir = join(dir, '.gkm', 'server');
        expect(await readFile(join(serverDir, 'app.ts'), 'utf-8')).toContain(
          'HonoEndpoint',
        );
      } finally {
        process.chdir(originalCwd);
      }
    },
  );

  itWithDir('should handle case with no constructs found', async ({ dir }) => {
    // Create a basic config file with no actual construct files
    await createTestFile(
      dir,
      'gkm.config.ts',
      `
export default {
  routes: './src/endpoints/**/*.ts',
  functions: './src/functions/**/*.ts',
  crons: './src/crons/**/*.ts',
  envParser: './config/env',
  logger: './config/logger',
};
`,
    );

    // Create env and logger files
    await createTestFile(dir, 'config/env.ts', 'export default {}');
    await createTestFile(dir, 'config/logger.ts', 'export default {}');

    const originalCwd = process.cwd();
    process.chdir(dir);

    const logSpy = vi.spyOn(console, 'log');

    try {
      await buildCommand({ provider: 'server' });

      expect(logSpy).toHaveBeenCalledWith('Found 0 endpoints');
      expect(logSpy).toHaveBeenCalledWith('Found 0 functions');
      expect(logSpy).toHaveBeenCalledWith('Found 0 crons');
      expect(logSpy).toHaveBeenCalledWith(
        'No endpoints, functions, or crons found to process',
      );
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
    }
  });

  itWithDir(
    'should handle optional functions and crons config',
    async ({ dir }) => {
      // Create config with undefined functions and crons
      await createTestFile(
        dir,
        'gkm.config.ts',
        `
export default {
  routes: './src/endpoints/**/*.ts',
  functions: undefined,
  crons: undefined,
  envParser: './config/env',
  logger: './config/logger',
};
`,
      );

      await createMockEndpointFile(
        dir,
        'src/endpoints/test.ts',
        'testEndpoint',
        '/test',
        'GET',
      );

      // Create env and logger files
      await createTestFile(dir, 'config/env.ts', 'export default {}');
      await createTestFile(dir, 'config/logger.ts', 'export default {}');

      const originalCwd = process.cwd();
      process.chdir(dir);

      const logSpy = vi.spyOn(console, 'log');

      try {
        await buildCommand({ provider: 'server' });

        expect(logSpy).toHaveBeenCalledWith('Found 1 endpoints');
        expect(logSpy).toHaveBeenCalledWith('Found 0 functions');
        expect(logSpy).toHaveBeenCalledWith('Found 0 crons');

        // Should not log functions or crons loading messages
        expect(logSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('Loading functions'),
        );
        expect(logSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('Loading crons'),
        );
      } finally {
        process.chdir(originalCwd);
        logSpy.mockRestore();
      }
    },
  );

  itWithDir(
    'should parse envParser configuration correctly',
    async ({ dir }) => {
      // Create config with custom named exports
      await createTestFile(
        dir,
        'gkm.config.ts',
        `
export default {
  routes: './src/endpoints/**/*.ts',
  functions: undefined,
  crons: undefined,
  envParser: './config/env#customEnvParser',
  logger: './config/logger#customLogger',
};
`,
      );

      await createMockEndpointFile(
        dir,
        'src/endpoints/test.ts',
        'testEndpoint',
        '/test',
        'GET',
      );

      // Create env and logger files with named exports
      await createTestFile(
        dir,
        'config/env.ts',
        'export const customEnvParser = {}',
      );
      await createTestFile(
        dir,
        'config/logger.ts',
        'export const customLogger = {}',
      );

      const originalCwd = process.cwd();
      process.chdir(dir);

      try {
        await buildCommand({ provider: 'aws' });

        // Verify that a handler file was generated with correct imports
        const handlerFile = join(dir, '.gkm/aws-apigatewayv2/testEndpoint.ts');
        const handlerContent = await readFile(handlerFile, 'utf-8');
        expect(handlerContent).toContain('{ customEnvParser as envParser }');
      } finally {
        process.chdir(originalCwd);
      }
    },
  );

  itWithDir(
    'should create output directories for each provider',
    async ({ dir }) => {
      // Create config with multiple providers
      await createTestFile(
        dir,
        'gkm.config.ts',
        `
export default {
  routes: './src/endpoints/**/*.ts',
  functions: undefined,
  crons: undefined,
  envParser: './config/env',
  logger: './config/logger',
};
`,
      );

      await createMockEndpointFile(
        dir,
        'src/endpoints/test.ts',
        'testEndpoint',
        '/test',
        'GET',
      );

      // Create env and logger files
      await createTestFile(dir, 'config/env.ts', 'export default {}');
      await createTestFile(dir, 'config/logger.ts', 'export default {}');

      const originalCwd = process.cwd();
      process.chdir(dir);

      try {
        await buildCommand({ provider: 'aws' });

        const v2HandlerFile = join(
          dir,
          '.gkm/aws-apigatewayv2/testEndpoint.ts',
        );

        const v2Content = await readFile(v2HandlerFile, 'utf-8');

        expect(v2Content).toContain('AmazonApiGatewayV2Endpoint');
      } finally {
        process.chdir(originalCwd);
      }
    },
  );

  itWithDir(
    'should handle default import patterns for envParser and logger',
    async ({ dir }) => {
      // Create config with default import patterns
      await createTestFile(
        dir,
        'gkm.config.ts',
        `
export default {
  routes: './src/endpoints/**/*.ts',
  functions: undefined,
  crons: undefined,
  envParser: './config/env',
  logger: './config/logger',
};
`,
      );

      await createMockEndpointFile(
        dir,
        'src/endpoints/test.ts',
        'testEndpoint',
        '/test',
        'GET',
      );

      // Create env and logger files with default exports
      await createTestFile(dir, 'config/env.ts', 'export default {}');
      await createTestFile(dir, 'config/logger.ts', 'export default {}');

      const originalCwd = process.cwd();
      process.chdir(dir);

      try {
        await buildCommand({ provider: 'aws' });

        // Verify that a handler file was generated with default imports
        const handlerFile = join(dir, '.gkm/aws-apigatewayv2/testEndpoint.ts');
        const handlerContent = await readFile(handlerFile, 'utf-8');
        expect(handlerContent).toContain('import envParser');
        expect(handlerContent).not.toContain('{ envParser }');
      } finally {
        process.chdir(originalCwd);
      }
    },
  );

  itWithDir(
    'should handle envParser pattern with same name as expected',
    async ({ dir }) => {
      // Create config with named exports that match expected names
      await createTestFile(
        dir,
        'gkm.config.ts',
        `
export default {
  routes: './src/endpoints/**/*.ts',
  functions: undefined,
  crons: undefined,
  envParser: './config/env#envParser',
  logger: './config/logger#logger',
};
`,
      );

      await createMockEndpointFile(
        dir,
        'src/endpoints/test.ts',
        'testEndpoint',
        '/test',
        'GET',
      );

      // Create env and logger files with named exports
      await createTestFile(dir, 'config/env.ts', 'export const envParser = {}');
      await createTestFile(dir, 'config/logger.ts', 'export const logger = {}');

      const originalCwd = process.cwd();
      process.chdir(dir);

      try {
        await buildCommand({ provider: 'aws' });

        // Verify that a handler file was generated with named imports
        const handlerFile = join(dir, '.gkm/aws-apigatewayv2/testEndpoint.ts');
        const handlerContent = await readFile(handlerFile, 'utf-8');

        expect(handlerContent).toContain('{ envParser }');
      } finally {
        process.chdir(originalCwd);
      }
    },
  );
});
