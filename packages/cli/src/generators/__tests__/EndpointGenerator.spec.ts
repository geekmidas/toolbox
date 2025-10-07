import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Endpoint } from '@geekmidas/api/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupDir,
  createMockBuildContext,
  createTempDir,
  createTestEndpoint,
} from '../../__tests__/test-helpers';
import { EndpointGenerator } from '../EndpointGenerator';
import type { GeneratedConstruct } from '../Generator';

describe('EndpointGenerator', () => {
  let tempDir: string;
  let outputDir: string;
  let generator: EndpointGenerator;
  let context: ReturnType<typeof createMockBuildContext>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    outputDir = join(tempDir, 'output');
    generator = new EndpointGenerator();
    context = createMockBuildContext();
  });

  afterEach(async () => {
    await cleanupDir(tempDir);
  });

  describe('isConstruct', () => {
    it('should identify valid endpoints', () => {
      const testEndpoint = createTestEndpoint('/test', 'GET');
      expect(generator.isConstruct(testEndpoint)).toBe(true);
    });

    it('should reject invalid constructs', () => {
      expect(generator.isConstruct({})).toBe(false);
      expect(generator.isConstruct('string')).toBe(false);
      expect(generator.isConstruct(null)).toBe(false);
    });
  });

  describe('build', () => {
    const createTestEndpointConstruct = (
      key: string,
      path: string,
      method: string,
    ): GeneratedConstruct<Endpoint<any, any, any, any, any, any>> => ({
      key,
      name: key.toLowerCase(),
      construct: createTestEndpoint(path, method),
      path: {
        absolute: join(tempDir, `${key}.ts`),
        relative: `${key}.ts`,
      },
    });

    describe('server provider', () => {
      it('should generate a single server app file', async () => {
        const constructs = [
          createTestEndpointConstruct('testEndpoint', '/test', 'GET'),
          createTestEndpointConstruct('anotherEndpoint', '/another', 'POST'),
        ];

        const routes = await generator.build(context, constructs, outputDir, {
          provider: 'server',
          enableOpenApi: true,
        });

        expect(routes).toHaveLength(1);
        expect(routes[0]).toMatchObject({
          path: '*',
          method: 'ALL',
          handler: expect.stringContaining('app.ts'),
        });

        // Check that the app.ts file was created
        const appPath = join(outputDir, 'app.ts');
        const appContent = await readFile(appPath, 'utf-8');

        expect(appContent).toContain('import { HonoEndpoint }');
        expect(appContent).toContain(
          'import { testEndpoint, anotherEndpoint }',
        );
        expect(appContent).toContain('enableOpenApi: boolean = true');
        expect(appContent).toContain("docsPath: '/docs'");
      });

      it('should generate server app without OpenAPI when disabled', async () => {
        const constructs = [
          createTestEndpointConstruct('testEndpoint', '/test', 'GET'),
        ];

        await generator.build(context, constructs, outputDir, {
          provider: 'server',
          enableOpenApi: false,
        });

        const appPath = join(outputDir, 'app.ts');
        const appContent = await readFile(appPath, 'utf-8');

        expect(appContent).toContain('enableOpenApi: boolean = false');
        expect(appContent).toContain('docsPath: false');
      });
    });

    describe('aws-lambda provider', () => {
      it('should generate individual handlers in routes subdirectory', async () => {
        const constructs = [
          createTestEndpointConstruct('testEndpoint', '/test', 'GET'),
          createTestEndpointConstruct('anotherEndpoint', '/another', 'POST'),
        ];

        const routes = await generator.build(context, constructs, outputDir, {
          provider: 'aws-lambda',
        });

        expect(routes).toHaveLength(2);
        expect(routes[0]).toMatchObject({
          path: '/test',
          method: 'GET',
          handler: expect.stringContaining('routes/testEndpoint.handler'),
        });
        expect(routes[1]).toMatchObject({
          path: '/another',
          method: 'POST',
          handler: expect.stringContaining('routes/anotherEndpoint.handler'),
        });

        // Check that handler files were created
        const testHandlerPath = join(outputDir, 'routes', 'testEndpoint.ts');
        const testHandlerContent = await readFile(testHandlerPath, 'utf-8');
        expect(testHandlerContent).toContain('AmazonApiGatewayV2Endpoint');
        expect(testHandlerContent).toContain('import { testEndpoint }');

        const anotherHandlerPath = join(
          outputDir,
          'routes',
          'anotherEndpoint.ts',
        );
        const anotherHandlerContent = await readFile(
          anotherHandlerPath,
          'utf-8',
        );
        expect(anotherHandlerContent).toContain('AmazonApiGatewayV2Endpoint');
        expect(anotherHandlerContent).toContain('import { anotherEndpoint }');
      });
    });

    describe('aws-apigatewayv1 provider', () => {
      it('should generate individual handlers with v1 adapter', async () => {
        const constructs = [
          createTestEndpointConstruct('testEndpoint', '/test', 'GET'),
        ];

        const routes = await generator.build(context, constructs, outputDir, {
          provider: 'aws-apigatewayv1',
        });

        expect(routes).toHaveLength(1);

        const handlerPath = join(outputDir, 'testEndpoint.ts');
        const handlerContent = await readFile(handlerPath, 'utf-8');
        expect(handlerContent).toContain('AmazonApiGatewayV1Endpoint');
        expect(handlerContent).toContain('import { testEndpoint }');
      });
    });

    describe('aws-apigatewayv2 provider', () => {
      it('should generate individual handlers with v2 adapter', async () => {
        const constructs = [
          createTestEndpointConstruct('testEndpoint', '/test', 'GET'),
        ];

        const routes = await generator.build(context, constructs, outputDir, {
          provider: 'aws-apigatewayv2',
        });

        expect(routes).toHaveLength(1);

        const handlerPath = join(outputDir, 'testEndpoint.ts');
        const handlerContent = await readFile(handlerPath, 'utf-8');
        expect(handlerContent).toContain('AmazonApiGatewayV2Endpoint');
        expect(handlerContent).toContain('import { testEndpoint }');
      });
    });

    it('should return empty array for empty constructs', async () => {
      const routes = await generator.build(context, [], outputDir);
      expect(routes).toEqual([]);
    });

    it('should use default provider when none specified', async () => {
      const constructs = [
        createTestEndpointConstruct('testEndpoint', '/test', 'GET'),
      ];

      const routes = await generator.build(context, constructs, outputDir);

      expect(routes).toHaveLength(1);

      // Should use default aws-apigatewayv2
      const handlerPath = join(outputDir, 'testEndpoint.ts');
      const handlerContent = await readFile(handlerPath, 'utf-8');
      expect(handlerContent).toContain('AmazonApiGatewayV2Endpoint');
    });

    it('should throw error for unsupported provider', async () => {
      const constructs = [
        createTestEndpointConstruct('testEndpoint', '/test', 'GET'),
      ];

      await expect(
        generator.build(context, constructs, outputDir, {
          provider: 'unsupported' as any,
        }),
      ).rejects.toThrow('Unsupported provider: unsupported');
    });

    it('should generate correct import paths for nested files', async () => {
      const construct: GeneratedConstruct<Endpoint<any, any, any, any, any, any>> = {
        key: 'deepEndpoint',
        name: 'deep-endpoint',
        construct: createTestEndpoint('/deep', 'GET'),
        path: {
          absolute: join(tempDir, 'src/api/endpoints/deep.ts'),
          relative: 'src/api/endpoints/deep.ts',
        },
      };

      await generator.build(context, [construct], outputDir, {
        provider: 'aws-apigatewayv2',
      });

      const handlerPath = join(outputDir, 'deepEndpoint.ts');
      const handlerContent = await readFile(handlerPath, 'utf-8');

      // Check that relative imports are correct
      expect(handlerContent).toContain(
        "from '../../../src/api/endpoints/deep.js'",
      );
      expect(handlerContent).toContain("from '../../env'");
    });

    it('should log generation progress', async () => {
      const logSpy = vi.spyOn(console, 'log');

      const constructs = [
        createTestEndpointConstruct('endpoint1', '/test1', 'GET'),
        createTestEndpointConstruct('endpoint2', '/test2', 'POST'),
      ];

      await generator.build(context, constructs, outputDir, {
        provider: 'server',
      });

      expect(logSpy).toHaveBeenCalledWith(
        'Generated server app with 2 endpoints',
      );

      logSpy.mockRestore();
    });
  });
});
