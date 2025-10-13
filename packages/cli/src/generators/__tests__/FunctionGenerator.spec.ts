import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Function } from '@geekmidas/constructs';
import { FunctionBuilder } from '@geekmidas/api/function';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupDir,
  createMockBuildContext,
  createTempDir,
} from '../../__tests__/test-helpers';
import { FunctionGenerator } from '../FunctionGenerator';
import type { GeneratedConstruct } from '../Generator';

describe('FunctionGenerator', () => {
  let tempDir: string;
  let outputDir: string;
  let generator: FunctionGenerator;
  let context: ReturnType<typeof createMockBuildContext>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    outputDir = join(tempDir, 'output');
    generator = new FunctionGenerator();
    context = createMockBuildContext();
  });

  afterEach(async () => {
    await cleanupDir(tempDir);
  });

  describe('isConstruct', () => {
    it('should identify valid functions', async () => {
      // Import the actual FunctionBuilder to create a real Function instance

      const { z } = await import('zod');

      const testFunction = new FunctionBuilder()
        .input(z.object({ name: z.string() }))
        .output(z.object({ greeting: z.string() }))
        .timeout(30)
        .handle(async ({ input }: any) => ({
          greeting: `Hello, ${input.name}!`,
        }));

      expect(generator.isConstruct(testFunction)).toBe(true);
    });

    it('should reject invalid constructs', () => {
      expect(generator.isConstruct({})).toBe(false);
      expect(generator.isConstruct('string')).toBe(false);
      expect(generator.isConstruct(null)).toBe(false);
    });
  });

  describe('build', () => {
    const createTestFunctionConstruct = (
      key: string,
      timeout: number = 30,
    ): GeneratedConstruct<Function<any, any, any, any>> => ({
      key,
      name: key.toLowerCase(),
      construct: {
        __IS_FUNCTION__: true,
        type: 'dev.geekmidas.function.function',
        timeout,
        handle: async () => ({ greeting: 'Hello!' }),
      } as any,
      path: {
        absolute: join(tempDir, `${key}.ts`),
        relative: `${key}.ts`,
      },
    });

    describe('aws-lambda provider', () => {
      it('should generate function handlers', async () => {
        const constructs = [
          createTestFunctionConstruct('processData', 60),
          createTestFunctionConstruct('sendEmail', 30),
        ];

        const functionInfos = await generator.build(
          context,
          constructs,
          outputDir,
          { provider: 'aws-lambda' },
        );

        expect(functionInfos).toHaveLength(2);
        expect(functionInfos[0]).toMatchObject({
          name: 'processData',
          handler: expect.stringContaining('functions/processData.handler'),
          timeout: 60,
        });
        expect(functionInfos[1]).toMatchObject({
          name: 'sendEmail',
          handler: expect.stringContaining('functions/sendEmail.handler'),
          timeout: 30,
        });

        // Check that handler files were created
        const processDataHandlerPath = join(
          outputDir,
          'functions',
          'processData.ts',
        );
        const processDataContent = await readFile(
          processDataHandlerPath,
          'utf-8',
        );
        expect(processDataContent).toContain('AWSLambdaFunction');
        expect(processDataContent).toContain('import { processData }');
        expect(processDataContent).toContain('import envParser');
        expect(processDataContent).toContain('import logger');

        const sendEmailHandlerPath = join(
          outputDir,
          'functions',
          'sendEmail.ts',
        );
        const sendEmailContent = await readFile(sendEmailHandlerPath, 'utf-8');
        expect(sendEmailContent).toContain('AWSLambdaFunction');
        expect(sendEmailContent).toContain('import { sendEmail }');
      });

      it('should generate correct relative import paths', async () => {
        const construct: GeneratedConstruct<Function<any, any, any, any>> = {
          key: 'deepFunction',
          name: 'deep-function',
          construct: createTestFunctionConstruct('deepFunction', 45).construct,
          path: {
            absolute: join(tempDir, 'src/functions/deep/processor.ts'),
            relative: 'src/functions/deep/processor.ts',
          },
        };

        await generator.build(context, [construct], outputDir, {
          provider: 'aws-lambda',
        });

        const handlerPath = join(outputDir, 'functions', 'deepFunction.ts');
        const handlerContent = await readFile(handlerPath, 'utf-8');

        // Check relative imports are correct - the path will be relative from outputDir
        expect(handlerContent).toMatch(
          /from ['"].*src\/functions\/deep\/processor\.js['"]/,
        );
        expect(handlerContent).toMatch(/from ['"].*\/env['"]/);
        expect(handlerContent).toMatch(/from ['"].*\/logger['"]/);
      });

      it('should log generation progress', async () => {
        const logSpy = vi.spyOn(console, 'log');

        const constructs = [createTestFunctionConstruct('testFunction', 30)];

        await generator.build(context, constructs, outputDir, {
          provider: 'aws-lambda',
        });

        expect(logSpy).toHaveBeenCalledWith(
          'Generated function handler: testFunction',
        );

        logSpy.mockRestore();
      });
    });

    describe('non aws-lambda provider', () => {
      it('should return empty array for server provider', async () => {
        const constructs = [createTestFunctionConstruct('testFunction', 30)];

        const functionInfos = await generator.build(
          context,
          constructs,
          outputDir,
          { provider: 'server' },
        );

        expect(functionInfos).toEqual([]);
      });

      it('should return empty array for aws-apigatewayv1 provider', async () => {
        const constructs = [createTestFunctionConstruct('testFunction', 30)];

        const functionInfos = await generator.build(
          context,
          constructs,
          outputDir,
          { provider: 'aws-apigatewayv1' },
        );

        expect(functionInfos).toEqual([]);
      });
    });

    it('should return empty array for empty constructs', async () => {
      const functionInfos = await generator.build(context, [], outputDir, {
        provider: 'aws-lambda',
      });
      expect(functionInfos).toEqual([]);
    });

    it('should use default provider when none specified', async () => {
      const constructs = [createTestFunctionConstruct('defaultFunction', 30)];

      const functionInfos = await generator.build(
        context,
        constructs,
        outputDir,
      );

      expect(functionInfos).toHaveLength(1);
      expect(functionInfos[0].name).toBe('defaultFunction');

      // Check that handler was created (default is aws-lambda)
      const handlerPath = join(outputDir, 'functions', 'defaultFunction.ts');
      const handlerContent = await readFile(handlerPath, 'utf-8');
      expect(handlerContent).toContain('AWSLambdaFunction');
    });

    it('should handle functions with different timeout values', async () => {
      const constructs = [
        createTestFunctionConstruct('quickFunction', 15),
        createTestFunctionConstruct('slowFunction', 300),
      ];

      const functionInfos = await generator.build(
        context,
        constructs,
        outputDir,
        { provider: 'aws-lambda' },
      );

      expect(functionInfos[0].timeout).toBe(15);
      expect(functionInfos[1].timeout).toBe(300);
    });

    it('should handle functions with custom environment parser patterns', async () => {
      const customContext = {
        ...context,
        envParserImportPattern: '{ customParser as envParser }',
        loggerImportPattern: '{ customLogger as logger }',
      };

      const constructs = [createTestFunctionConstruct('customFunction', 30)];

      await generator.build(customContext, constructs, outputDir, {
        provider: 'aws-lambda',
      });

      const handlerPath = join(outputDir, 'functions', 'customFunction.ts');
      const handlerContent = await readFile(handlerPath, 'utf-8');

      expect(handlerContent).toContain('import { customParser as envParser }');
      expect(handlerContent).toContain('import { customLogger as logger }');
    });
  });
});
