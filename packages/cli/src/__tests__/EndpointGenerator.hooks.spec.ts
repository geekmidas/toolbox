import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { e } from '@geekmidas/constructs/endpoints';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BuildContext } from '../build/types';
import { EndpointGenerator } from '../generators/EndpointGenerator';
import type { GeneratedConstruct } from '../generators/Generator';

// Create a minimal mock endpoint for testing
const mockEndpoint = e.get('/test').handle(async () => ({ ok: true }));

describe('EndpointGenerator hooks generation', () => {
  const testOutputDir = join(process.cwd(), '.test-output');
  let generator: EndpointGenerator;

  // Mock endpoint construct for testing
  const mockConstruct: GeneratedConstruct<typeof mockEndpoint> = {
    key: 'testEndpoint',
    construct: mockEndpoint,
    path: {
      relative: '/project/src/endpoints/test.ts',
      absolute: '/project/src/endpoints/test.ts',
    },
  };

  beforeEach(async () => {
    generator = new EndpointGenerator();
    await mkdir(testOutputDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testOutputDir, { recursive: true, force: true });
  });

  const baseContext: BuildContext = {
    envParserPath: '/project/src/config/env.ts',
    envParserImportPattern: '{ envParser }',
    loggerPath: '/project/src/config/logger.ts',
    loggerImportPattern: 'logger',
  };

  describe('generateAppFile', () => {
    it('should not include hooks when hooks config is undefined', async () => {
      await generator.build(baseContext, [mockConstruct], testOutputDir, {
        provider: 'server',
      });

      const appContent = await readFile(
        join(testOutputDir, 'app.ts'),
        'utf-8',
      );

      expect(appContent).not.toContain('serverHooks');
      expect(appContent).not.toContain('beforeSetup');
      expect(appContent).not.toContain('afterSetup');
    });

    it('should include hooks imports when hooks config is provided', async () => {
      const contextWithHooks: BuildContext = {
        ...baseContext,
        hooks: {
          serverHooksPath: '/project/src/config/hooks.ts',
        },
      };

      await generator.build(contextWithHooks, [mockConstruct], testOutputDir, {
        provider: 'server',
      });

      const appContent = await readFile(
        join(testOutputDir, 'app.ts'),
        'utf-8',
      );

      expect(appContent).toContain("import * as serverHooks from");
      expect(appContent).toContain('hooks.ts');
    });

    it('should include beforeSetup hook call', async () => {
      const contextWithHooks: BuildContext = {
        ...baseContext,
        hooks: {
          serverHooksPath: '/project/src/config/hooks.ts',
        },
      };

      await generator.build(contextWithHooks, [mockConstruct], testOutputDir, {
        provider: 'server',
      });

      const appContent = await readFile(
        join(testOutputDir, 'app.ts'),
        'utf-8',
      );

      expect(appContent).toContain(
        "if (typeof serverHooks.beforeSetup === 'function')",
      );
      expect(appContent).toContain(
        'await serverHooks.beforeSetup(honoApp, { envParser, logger })',
      );
    });

    it('should include afterSetup hook call', async () => {
      const contextWithHooks: BuildContext = {
        ...baseContext,
        hooks: {
          serverHooksPath: '/project/src/config/hooks.ts',
        },
      };

      await generator.build(contextWithHooks, [mockConstruct], testOutputDir, {
        provider: 'server',
      });

      const appContent = await readFile(
        join(testOutputDir, 'app.ts'),
        'utf-8',
      );

      expect(appContent).toContain(
        "if (typeof serverHooks.afterSetup === 'function')",
      );
      expect(appContent).toContain(
        'await serverHooks.afterSetup(honoApp, { envParser, logger })',
      );
    });

    it('should place telescope before beforeSetup, and beforeSetup before endpoints', async () => {
      const contextWithHooks: BuildContext = {
        ...baseContext,
        hooks: {
          serverHooksPath: '/project/src/config/hooks.ts',
        },
        telescope: {
          enabled: true,
          path: '/__telescope',
          maxEntries: 100,
          recordBody: true,
          ignore: [],
          websocket: false,
        },
      };

      await generator.build(contextWithHooks, [mockConstruct], testOutputDir, {
        provider: 'server',
      });

      const appContent = await readFile(
        join(testOutputDir, 'app.ts'),
        'utf-8',
      );

      // Use specific patterns to find the actual calls (not imports/comments)
      const telescopeIndex = appContent.indexOf('createMiddleware(telescope)');
      const beforeSetupCallIndex = appContent.indexOf(
        'serverHooks.beforeSetup(honoApp',
      );
      const setupEndpointsIndex = appContent.indexOf(
        'await setupEndpoints(honoApp',
      );

      expect(telescopeIndex).toBeGreaterThan(0);
      expect(beforeSetupCallIndex).toBeGreaterThan(0);
      expect(setupEndpointsIndex).toBeGreaterThan(0);
      // Telescope middleware first (to capture all requests)
      expect(telescopeIndex).toBeLessThan(beforeSetupCallIndex);
      // Then beforeSetup hook
      expect(beforeSetupCallIndex).toBeLessThan(setupEndpointsIndex);
    });

    it('should place afterSetup after setupEndpoints', async () => {
      const contextWithHooks: BuildContext = {
        ...baseContext,
        hooks: {
          serverHooksPath: '/project/src/config/hooks.ts',
        },
      };

      await generator.build(contextWithHooks, [mockConstruct], testOutputDir, {
        provider: 'server',
      });

      const appContent = await readFile(
        join(testOutputDir, 'app.ts'),
        'utf-8',
      );

      // Use specific patterns to find the actual calls (not imports/comments)
      const setupEndpointsIndex = appContent.indexOf(
        'await setupEndpoints(honoApp',
      );
      const afterSetupCallIndex = appContent.indexOf(
        'serverHooks.afterSetup(honoApp',
      );

      expect(setupEndpointsIndex).toBeGreaterThan(0);
      expect(afterSetupCallIndex).toBeGreaterThan(0);
      expect(afterSetupCallIndex).toBeGreaterThan(setupEndpointsIndex);
    });

    it('should generate correct relative import path for hooks', async () => {
      const contextWithHooks: BuildContext = {
        ...baseContext,
        hooks: {
          serverHooksPath: join(testOutputDir, '../../src/config/hooks.ts'),
        },
      };

      await generator.build(contextWithHooks, [mockConstruct], testOutputDir, {
        provider: 'server',
      });

      const appContent = await readFile(
        join(testOutputDir, 'app.ts'),
        'utf-8',
      );

      // Should have a relative import path
      expect(appContent).toMatch(
        /import \* as serverHooks from '\.\.\/.*hooks\.ts'/,
      );
    });
  });
});
