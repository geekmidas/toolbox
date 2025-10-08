import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Endpoint } from '@geekmidas/api/server';
import { itWithDir } from '@geekmidas/testkit/os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpMethod } from '../../../../api/src/constructs/types';
import {
  cleanupDir,
  createMockBuildContext,
  createMockEndpointFile,
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

  it('should identify valid endpoints', () => {
    const testEndpoint = createTestEndpoint('/test', 'GET');
    expect(generator.isConstruct(testEndpoint)).toBe(true);
  });

  it('should reject invalid constructs', () => {
    expect(generator.isConstruct({})).toBe(false);
    expect(generator.isConstruct('string')).toBe(false);
    expect(generator.isConstruct(null)).toBe(false);
  });

  const createTestEndpointConstruct = (
    key: string,
    path: string,
    method: HttpMethod,
    dir: string = tempDir,
  ): GeneratedConstruct<Endpoint<any, any, any, any, any, any>> => ({
    key,
    name: key.toLowerCase(),
    construct: createTestEndpoint(path, method),
    path: {
      absolute: join(dir, `${key}.ts`),
      relative: `./${key}.ts`,
    },
  });

  itWithDir('should generate a single server app file', async ({ dir }) => {
    const outputDir = join(dir, 'output');
    const routesDir = join(dir, 'routes');
    await mkdir(outputDir, { recursive: true });

    await Promise.all([
      createMockEndpointFile(
        routesDir,
        'testEndpoint.ts',
        'testEndpoint',
        '/test',
        'GET',
      ),
      createMockEndpointFile(
        routesDir,
        'anotherEndpoint.ts',
        'anotherEndpoint',
        '/another',
        'POST',
      ),
    ]);

    const constructs = await generator.load('**/routes/*.ts', dir);

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
    expect(appContent).toContain('import { testEndpoint }');
    expect(appContent).toContain('import { anotherEndpoint }');
    expect(appContent).toContain('enableOpenApi: boolean = true');
    expect(appContent).toContain("docsPath: '/docs'");
  });

  itWithDir('should generate server app without OpenAPI when disabled', async ({ dir }) => {
    const outputDir = join(dir, 'output');
    const routesDir = join(dir, 'routes');
    await mkdir(outputDir, { recursive: true });

    await createMockEndpointFile(
      routesDir,
      'testEndpoint.ts',
      'testEndpoint',
      '/test',
      'GET',
    );

    const constructs = await generator.load('**/routes/*.ts', dir);

    await generator.build(context, constructs, outputDir, {
      provider: 'server',
      enableOpenApi: false,
    });

    const appPath = join(outputDir, 'app.ts');
    const appContent = await readFile(appPath, 'utf-8');

    expect(appContent).toContain('enableOpenApi: boolean = false');
    expect(appContent).toContain('docsPath: false');
  });

  itWithDir('should generate individual handlers in routes subdirectory', async ({ dir }) => {
    const outputDir = join(dir, 'output');
    const routesDir = join(dir, 'routes');
    await mkdir(outputDir, { recursive: true });

    await Promise.all([
      createMockEndpointFile(
        routesDir,
        'testEndpoint.ts',
        'testEndpoint',
        '/test',
        'GET',
      ),
      createMockEndpointFile(
        routesDir,
        'anotherEndpoint.ts',
        'anotherEndpoint',
        '/another',
        'POST',
      ),
    ]);

    const constructs = await generator.load('**/routes/*.ts', dir);

    const routes = await generator.build(context, constructs, outputDir, {
      provider: 'aws-lambda',
    });

    expect(routes).toHaveLength(2);
    
    // Find routes by their path since order may vary
    const testRoute = routes.find(r => r.path === '/test');
    const anotherRoute = routes.find(r => r.path === '/another');
    
    expect(testRoute).toMatchObject({
      path: '/test',
      method: 'GET',
      handler: expect.stringContaining('routes/testEndpoint.handler'),
    });
    expect(anotherRoute).toMatchObject({
      path: '/another',
      method: 'POST',
      handler: expect.stringContaining('routes/anotherEndpoint.handler'),
    });

    // Check that handler files were created
    const testHandlerPath = join(outputDir, 'routes', 'testEndpoint.ts');
    const testHandlerContent = await readFile(testHandlerPath, 'utf-8');
    expect(testHandlerContent).toContain('AmazonApiGatewayV2Endpoint');
    expect(testHandlerContent).toContain('import { testEndpoint }');

    const anotherHandlerPath = join(outputDir, 'routes', 'anotherEndpoint.ts');
    const anotherHandlerContent = await readFile(anotherHandlerPath, 'utf-8');
    expect(anotherHandlerContent).toContain('AmazonApiGatewayV2Endpoint');
    expect(anotherHandlerContent).toContain('import { anotherEndpoint }');
  });

  itWithDir('should generate individual handlers with v1 adapter', async ({ dir }) => {
    const outputDir = join(dir, 'output');
    const routesDir = join(dir, 'routes');
    await mkdir(outputDir, { recursive: true });

    await createMockEndpointFile(
      routesDir,
      'testEndpoint.ts',
      'testEndpoint',
      '/test',
      'GET',
    );

    const constructs = await generator.load('**/routes/*.ts', dir);

    const routes = await generator.build(context, constructs, outputDir, {
      provider: 'aws-apigatewayv1',
    });

    expect(routes).toHaveLength(1);

    const handlerPath = join(outputDir, 'testEndpoint.ts');
    const handlerContent = await readFile(handlerPath, 'utf-8');
    expect(handlerContent).toContain('AmazonApiGatewayV1Endpoint');
    expect(handlerContent).toContain('import { testEndpoint }');
  });

  itWithDir('should generate individual handlers with v2 adapter', async ({ dir }) => {
    const outputDir = join(dir, 'output');
    const routesDir = join(dir, 'routes');
    await mkdir(outputDir, { recursive: true });

    await createMockEndpointFile(
      routesDir,
      'testEndpoint.ts',
      'testEndpoint',
      '/test',
      'GET',
    );

    const constructs = await generator.load('**/routes/*.ts', dir);

    const routes = await generator.build(context, constructs, outputDir, {
      provider: 'aws-apigatewayv2',
    });

    expect(routes).toHaveLength(1);

    const handlerPath = join(outputDir, 'testEndpoint.ts');
    const handlerContent = await readFile(handlerPath, 'utf-8');
    expect(handlerContent).toContain('AmazonApiGatewayV2Endpoint');
    expect(handlerContent).toContain('import { testEndpoint }');
  });

  it('should return empty array for empty constructs', async () => {
    const routes = await generator.build(context, [], outputDir);
    expect(routes).toEqual([]);
  });

  itWithDir('should use default provider when none specified', async ({ dir }) => {
    const outputDir = join(dir, 'output');
    const routesDir = join(dir, 'routes');
    await mkdir(outputDir, { recursive: true });

    await createMockEndpointFile(
      routesDir,
      'testEndpoint.ts',
      'testEndpoint',
      '/test',
      'GET',
    );

    const constructs = await generator.load('**/routes/*.ts', dir);

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

  itWithDir('should generate correct import paths for nested files', async ({ dir }) => {
    const outputDir = join(dir, 'output');
    const nestedDir = join(dir, 'src', 'api', 'endpoints');
    await mkdir(outputDir, { recursive: true });

    await createMockEndpointFile(
      nestedDir,
      'deepEndpoint.ts',
      'deepEndpoint',
      '/deep',
      'GET',
    );

    const constructs = await generator.load('**/src/api/endpoints/*.ts', dir);

    await generator.build(context, constructs, outputDir, {
      provider: 'aws-apigatewayv2',
    });

    const handlerPath = join(outputDir, 'deepEndpoint.ts');
    const handlerContent = await readFile(handlerPath, 'utf-8');

    // Check that relative imports are correct
    expect(handlerContent).toContain(
      "from '../src/api/endpoints/deepEndpoint.js'",
    );
    expect(handlerContent).toMatch(/from ['"]\.\.\/\.\.\/\.\.\/.*\/env['"]/);
  });

  itWithDir('should log generation progress', async ({ dir }) => {
    const logSpy = vi.spyOn(console, 'log');
    const outputDir = join(dir, 'output');
    const routesDir = join(dir, 'routes');
    await mkdir(outputDir, { recursive: true });

    await Promise.all([
      createMockEndpointFile(
        routesDir,
        'endpoint1.ts',
        'endpoint1',
        '/test1',
        'GET',
      ),
      createMockEndpointFile(
        routesDir,
        'endpoint2.ts',
        'endpoint2',
        '/test2',
        'POST',
      ),
    ]);

    const constructs = await generator.load('**/routes/*.ts', dir);

    await generator.build(context, constructs, outputDir, {
      provider: 'server',
    });

    expect(logSpy).toHaveBeenCalledWith(
      'Generated server app with 2 endpoints',
    );

    logSpy.mockRestore();
  });
});
