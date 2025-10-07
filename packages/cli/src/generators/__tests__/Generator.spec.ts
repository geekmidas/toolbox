import { Endpoint } from '@geekmidas/api/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupDir,
  createMockBuildContext,
  createTempDir,
  createTestFile,
} from '../../__tests__/test-helpers';
import {
  ConstructGenerator,
  type GeneratedConstruct,
  type GeneratorOptions,
} from '../Generator';

// Create a concrete implementation for testing
class TestGenerator extends ConstructGenerator<
  Endpoint<any, any, any, any, any, any>,
  string[]
> {
  isConstruct(value: any): value is Endpoint<any, any, any, any, any, any> {
    return Endpoint.isEndpoint(value);
  }

  async build(
    context: any,
    constructs: GeneratedConstruct<Endpoint<any, any, any, any, any, any>>[],
    outputDir: string,
    options?: GeneratorOptions,
  ): Promise<string[]> {
    return constructs.map((c) => `${c.name}:${c.construct._path}`);
  }
}

describe('ConstructGenerator', () => {
  let tempDir: string;
  let generator: TestGenerator;

  beforeEach(async () => {
    tempDir = await createTempDir();
    generator = new TestGenerator();
  });

  afterEach(async () => {
    await cleanupDir(tempDir);
  });

  describe('load', () => {
    it('should load constructs from matching files', async () => {
      // Create test files
      await createTestFile(
        tempDir,
        'endpoints/test1.ts',
        `
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

export const testEndpoint = e
  .get('/test1')
  .output(z.object({ message: z.string() }))
  .handle(async () => ({ message: 'test1' }));

export const anotherEndpoint = e
  .post('/test2')
  .output(z.object({ message: z.string() }))
  .handle(async () => ({ message: 'test2' }));

export const notAnEndpoint = 'just a string';
`,
      );

      await createTestFile(
        tempDir,
        'endpoints/test2.ts',
        `
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

export const thirdEndpoint = e
  .put('/test3')
  .output(z.object({ message: z.string() }))
  .handle(async () => ({ message: 'test3' }));
`,
      );

      const constructs = await generator.load(`${tempDir}/endpoints/*.ts`);

      expect(constructs).toHaveLength(3);
      expect(constructs[0]).toMatchObject({
        key: 'testEndpoint',
        name: 'test-endpoint',
        path: {
          absolute: expect.stringContaining('test1.ts'),
          relative: expect.stringContaining('endpoints/test1.ts'),
        },
      });
      expect(constructs[0].construct._path).toBe('/test1');
      expect(constructs[0].construct.method).toBe('GET');

      expect(constructs[1]).toMatchObject({
        key: 'anotherEndpoint',
        name: 'another-endpoint',
      });
      expect(constructs[1].construct._path).toBe('/test2');

      expect(constructs[2]).toMatchObject({
        key: 'thirdEndpoint',
        name: 'third-endpoint',
      });
    });

    it('should handle array of patterns', async () => {
      await createTestFile(
        tempDir,
        'api/endpoint.ts',
        `
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

export const apiEndpoint = e
  .get('/api')
  .output(z.object({ message: z.string() }))
  .handle(async () => ({ message: 'api' }));
`,
      );
      await createTestFile(
        tempDir,
        'routes/endpoint.ts',
        `
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

export const routeEndpoint = e
  .post('/route')
  .output(z.object({ message: z.string() }))
  .handle(async () => ({ message: 'route' }));
`,
      );

      const constructs = await generator.load([
        `${tempDir}/api/*.ts`,
        `${tempDir}/routes/*.ts`,
      ]);

      expect(constructs).toHaveLength(2);
      expect(constructs.map((c) => c.construct._path)).toContain('/api');
      expect(constructs.map((c) => c.construct._path)).toContain('/route');
    });

    it('should return empty array when no patterns provided', async () => {
      const constructs = await generator.load();
      expect(constructs).toEqual([]);
    });

    it('should return empty array for empty string pattern', async () => {
      const constructs = await generator.load('');
      expect(constructs).toEqual([]);
    });

    it('should handle files with no matching exports', async () => {
      await createTestFile(
        tempDir,
        'no-constructs.ts',
        `
export const someString = 'hello';
export const someNumber = 123;
export const someObject = { foo: 'bar' };
`,
      );

      const constructs = await generator.load(`${tempDir}/*.ts`);
      expect(constructs).toEqual([]);
    });

    it('should convert export names to kebab-case', async () => {
      await createTestFile(
        tempDir,
        'kebab-test.ts',
        `
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

export const MyComplexEndpointName = e
  .get('/test')
  .output(z.object({ message: z.string() }))
  .handle(async () => ({ message: 'test' }));

export const UPPERCASE_ENDPOINT = e
  .post('/upper')
  .output(z.object({ message: z.string() }))
  .handle(async () => ({ message: 'upper' }));

export const snake_case_endpoint = e
  .put('/snake')
  .output(z.object({ message: z.string() }))
  .handle(async () => ({ message: 'snake' }));
`,
      );

      const constructs = await generator.load(`${tempDir}/*.ts`);

      expect(constructs[0].name).toBe('my-complex-endpoint-name');
      expect(constructs[1].name).toBe('uppercase-endpoint');
      expect(constructs[2].name).toBe('snake-case-endpoint');
    });

    it('should throw error when file import fails', async () => {
      await createTestFile(
        tempDir,
        'broken.ts',
        `
import { nonExistent } from './does-not-exist';
export const endpoint = nonExistent;
`,
      );

      await expect(generator.load(`${tempDir}/*.ts`)).rejects.toThrow(
        'Failed to load constructs',
      );
    });

    it('should log warning for failed file loads', async () => {
      const warnSpy = vi.spyOn(console, 'warn');

      await createTestFile(
        tempDir,
        'syntax-error.ts',
        `export const endpoint = {`,
      );

      try {
        await generator.load(`${tempDir}/*.ts`);
      } catch (error) {
        // Expected to throw
      }

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load'),
        expect.any(String),
      );

      warnSpy.mockRestore();
    });
  });

  describe('static build', () => {
    it('should load constructs and call build method', async () => {
      await createTestFile(
        tempDir,
        'endpoint.ts',
        `export const testEndpoint = { _path: '/test', method: 'GET' };`,
      );

      const context = createMockBuildContext();
      const outputDir = join(tempDir, 'output');
      const options: GeneratorOptions = { provider: 'server' };

      const result = await ConstructGenerator.build(
        context,
        outputDir,
        generator,
        `${tempDir}/*.ts`,
        options,
      );

      expect(result).toEqual(['test-endpoint:/test']);
    });

    it('should work without options', async () => {
      await createTestFile(
        tempDir,
        'endpoint.ts',
        `
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

export const testEndpoint = e
  .get('/test')
  .output(z.object({ message: z.string() }))
  .handle(async () => ({ message: 'test' }));
`,
      );

      const context = createMockBuildContext();
      const outputDir = join(tempDir, 'output');

      const result = await ConstructGenerator.build(
        context,
        outputDir,
        generator,
        `${tempDir}/*.ts`,
      );

      expect(result).toEqual(['test-endpoint:/test']);
    });
  });
});

import { join } from 'node:path';
