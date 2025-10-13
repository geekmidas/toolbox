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
import { buildCommand } from '../index';

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

        // Check app.ts has the createApp function with new API
        const appContent = await readFile(join(serverDir, 'app.ts'), 'utf-8');
        expect(appContent).toContain('function createApp');
        expect(appContent).toContain('interface ServerApp');
        expect(appContent).toContain('async start(options');

        // Check endpoints.ts has the HonoEndpoint setup
        const endpointsContent = await readFile(
          join(serverDir, 'endpoints.ts'),
          'utf-8',
        );
        expect(endpointsContent).toContain('HonoEndpoint');
      } finally {
        process.chdir(originalCwd);
      }
    },
  );

  itWithDir(
    'should perform complete build with all construct types for AWS Lambda',
    async ({ dir }) => {
      // Create comprehensive test setup with all construct types
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
        'POST',
      );
      await createMockFunctionFile(
        dir,
        'src/functions/processData.ts',
        'processDataFunction',
        300,
      );
      await createMockFunctionFile(
        dir,
        'src/functions/sendEmail.ts',
        'sendEmailFunction',
        30,
      );
      await createMockCronFile(
        dir,
        'src/crons/dailyCleanup.ts',
        'dailyCleanupCron',
        'rate(1 day)',
      );
      await createMockCronFile(
        dir,
        'src/crons/hourlyReport.ts',
        'hourlyReportCron',
        'cron(0 * * * ? *)',
      );

      // Create config
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
        // Build for AWS Lambda
        await buildCommand({ provider: 'aws' });

        const awsLambdaDir = join(dir, '.gkm', 'aws-lambda');
        const awsApiGatewayV2Dir = join(dir, '.gkm', 'aws-apigatewayv2');

        // Verify Lambda handlers were created
        expect(
          await readFile(
            join(awsLambdaDir, 'functions', 'processDataFunction.ts'),
            'utf-8',
          ),
        ).toContain('AWSLambdaFunction');
        expect(
          await readFile(
            join(awsLambdaDir, 'functions', 'sendEmailFunction.ts'),
            'utf-8',
          ),
        ).toContain('AWSLambdaFunction');

        // Verify Cron handlers were created
        expect(
          await readFile(
            join(awsLambdaDir, 'crons', 'dailyCleanupCron.ts'),
            'utf-8',
          ),
        ).toContain('AWSScheduledFunction');
        expect(
          await readFile(
            join(awsLambdaDir, 'crons', 'hourlyReportCron.ts'),
            'utf-8',
          ),
        ).toContain('AWSScheduledFunction');

        // Verify API Gateway handlers were created
        expect(
          await readFile(
            join(awsApiGatewayV2Dir, 'getUsersEndpoint.ts'),
            'utf-8',
          ),
        ).toContain('AmazonApiGatewayV2Endpoint');
        expect(
          await readFile(
            join(awsApiGatewayV2Dir, 'getPostsEndpoint.ts'),
            'utf-8',
          ),
        ).toContain('AmazonApiGatewayV2Endpoint');

        // Verify unified manifest was created at root .gkm directory
        const manifestPath = join(dir, '.gkm', 'manifest.json');
        const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));

        // Verify manifest structure includes all routes from both providers
        expect(manifest).toMatchObject({
          routes: expect.arrayContaining([
            // Routes from aws-lambda provider
            expect.objectContaining({
              path: '/users',
              method: 'GET',
              handler: expect.stringContaining(
                'routes/getUsersEndpoint.handler',
              ),
            }),
            expect.objectContaining({
              path: '/posts',
              method: 'POST',
              handler: expect.stringContaining(
                'routes/getPostsEndpoint.handler',
              ),
            }),
            // Routes from aws-apigatewayv2 provider
            expect.objectContaining({
              path: '/users',
              method: 'GET',
              handler: expect.stringContaining('getUsersEndpoint.handler'),
            }),
            expect.objectContaining({
              path: '/posts',
              method: 'POST',
              handler: expect.stringContaining('getPostsEndpoint.handler'),
            }),
          ]),
          functions: expect.arrayContaining([
            expect.objectContaining({
              name: 'processDataFunction',
              handler: expect.stringContaining(
                'functions/processDataFunction.handler',
              ),
              timeout: 300,
            }),
            expect.objectContaining({
              name: 'sendEmailFunction',
              handler: expect.stringContaining(
                'functions/sendEmailFunction.handler',
              ),
              timeout: 30,
            }),
          ]),
          crons: expect.arrayContaining([
            expect.objectContaining({
              name: 'dailyCleanupCron',
              handler: expect.stringContaining(
                'crons/dailyCleanupCron.handler',
              ),
              schedule: 'rate(1 day)',
            }),
            expect.objectContaining({
              name: 'hourlyReportCron',
              handler: expect.stringContaining(
                'crons/hourlyReportCron.handler',
              ),
              schedule: 'cron(0 * * * ? *)',
            }),
          ]),
        });

        // Verify counts - should have duplicated routes (one for each provider)
        expect(manifest.routes).toHaveLength(4); // 2 routes x 2 providers
        expect(manifest.functions).toHaveLength(2);
        expect(manifest.crons).toHaveLength(2);
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
      expect(logSpy).toHaveBeenCalledWith('Found 0 subscribers');
      expect(logSpy).toHaveBeenCalledWith(
        'No endpoints, functions, crons, or subscribers found to process',
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
