import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Cron } from '@geekmidas/api/constructs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupDir,
  createMockBuildContext,
  createTempDir,
  createTestCron,
} from '../../__tests__/test-helpers';
import { CronGenerator } from '../CronGenerator';
import type { GeneratedConstruct } from '../Generator';

describe('CronGenerator', () => {
  let tempDir: string;
  let outputDir: string;
  let generator: CronGenerator;
  let context: ReturnType<typeof createMockBuildContext>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    outputDir = join(tempDir, 'output');
    generator = new CronGenerator();
    context = createMockBuildContext();
  });

  afterEach(async () => {
    await cleanupDir(tempDir);
  });

  describe('isConstruct', () => {
    it('should identify valid crons', () => {
      const testCron = createTestCron('rate(1 hour)', 30);
      expect(generator.isConstruct(testCron)).toBe(true);
    });

    it('should reject invalid constructs', () => {
      expect(generator.isConstruct({})).toBe(false);
      expect(generator.isConstruct('string')).toBe(false);
      expect(generator.isConstruct(null)).toBe(false);
    });
  });

  describe('build', () => {
    const createMockCronConstruct = (
      key: string,
      schedule: string = 'rate(1 hour)',
      timeout: number = 30,
    ): GeneratedConstruct<Cron<any, any, any, any>> => ({
      key,
      name: key.toLowerCase(),
      construct: createTestCron(schedule, timeout),
      path: {
        absolute: join(tempDir, `${key}.ts`),
        relative: `${key}.ts`,
      },
    });

    describe('aws-lambda provider', () => {
      it('should generate cron handlers', async () => {
        const constructs = [
          createMockCronConstruct('dailyReport', 'rate(1 day)', 60),
          createMockCronConstruct('hourlyCleanup', 'rate(1 hour)', 30),
          createMockCronConstruct('weeklyBackup', 'cron(0 0 ? * SUN *)', 300),
        ];

        const cronInfos = await generator.build(
          context,
          constructs,
          outputDir,
          { provider: 'aws-lambda' },
        );

        expect(cronInfos).toHaveLength(3);
        expect(cronInfos[0]).toMatchObject({
          name: 'dailyReport',
          handler: expect.stringContaining('crons/dailyReport.handler'),
          schedule: 'rate(1 day)',
          timeout: 60,
        });
        expect(cronInfos[1]).toMatchObject({
          name: 'hourlyCleanup',
          handler: expect.stringContaining('crons/hourlyCleanup.handler'),
          schedule: 'rate(1 hour)',
          timeout: 30,
        });
        expect(cronInfos[2]).toMatchObject({
          name: 'weeklyBackup',
          handler: expect.stringContaining('crons/weeklyBackup.handler'),
          schedule: 'cron(0 0 ? * SUN *)',
          timeout: 300,
        });

        // Check that handler files were created
        const dailyReportHandlerPath = join(
          outputDir,
          'crons',
          'dailyReport.ts',
        );
        const dailyReportContent = await readFile(
          dailyReportHandlerPath,
          'utf-8',
        );
        expect(dailyReportContent).toContain('AWSScheduledFunction');
        expect(dailyReportContent).toContain('import { dailyReport }');
        expect(dailyReportContent).toContain('import envParser');
        expect(dailyReportContent).toContain('import logger');

        const hourlyCleanupHandlerPath = join(
          outputDir,
          'crons',
          'hourlyCleanup.ts',
        );
        const hourlyCleanupContent = await readFile(
          hourlyCleanupHandlerPath,
          'utf-8',
        );
        expect(hourlyCleanupContent).toContain('AWSScheduledFunction');
        expect(hourlyCleanupContent).toContain('import { hourlyCleanup }');
      });

      it('should use default schedule when none provided', async () => {
        // Create a cron with empty schedule that will use default
        const cronWithDefaultSchedule = createTestCron('', 30);

        const construct: GeneratedConstruct<Cron<any, any, any, any>> = {
          key: 'defaultScheduleCron',
          name: 'default-schedule-cron',
          construct: cronWithDefaultSchedule,
          path: {
            absolute: join(tempDir, 'defaultScheduleCron.ts'),
            relative: 'defaultScheduleCron.ts',
          },
        };

        const cronInfos = await generator.build(
          context,
          [construct],
          outputDir,
          { provider: 'aws-lambda' },
        );

        // Since the construct has a schedule, it should use that or default logic
        expect(cronInfos[0].schedule).toBeDefined();
      });

      it('should generate correct relative import paths', async () => {
        const construct: GeneratedConstruct<Cron<any, any, any, any>> = {
          key: 'deepCron',
          name: 'deep-cron',
          construct: createTestCron('rate(1 day)', 45),
          path: {
            absolute: join(tempDir, 'src/crons/deep/processor.ts'),
            relative: 'src/crons/deep/processor.ts',
          },
        };

        await generator.build(context, [construct], outputDir, {
          provider: 'aws-lambda',
        });

        const handlerPath = join(outputDir, 'crons', 'deepCron.ts');
        const handlerContent = await readFile(handlerPath, 'utf-8');

        // Check relative imports are correct
        expect(handlerContent).toContain(
          "from '../../../src/crons/deep/processor.js'",
        );
        expect(handlerContent).toContain("from '../../env'");
        expect(handlerContent).toContain("from '../../logger'");
      });

      it('should log generation progress', async () => {
        const logSpy = vi.spyOn(console, 'log');

        const constructs = [
          createMockCronConstruct('testCron', 'rate(1 hour)', 30),
        ];

        await generator.build(context, constructs, outputDir, {
          provider: 'aws-lambda',
        });

        expect(logSpy).toHaveBeenCalledWith('Generated cron handler: testCron');

        logSpy.mockRestore();
      });
    });

    describe('non aws-lambda provider', () => {
      it('should return empty array for server provider', async () => {
        const constructs = [
          createMockCronConstruct('testCron', 'rate(1 hour)', 30),
        ];

        const cronInfos = await generator.build(
          context,
          constructs,
          outputDir,
          { provider: 'server' },
        );

        expect(cronInfos).toEqual([]);
      });

      it('should return empty array for aws-apigatewayv1 provider', async () => {
        const constructs = [
          createMockCronConstruct('testCron', 'rate(1 hour)', 30),
        ];

        const cronInfos = await generator.build(
          context,
          constructs,
          outputDir,
          { provider: 'aws-apigatewayv1' },
        );

        expect(cronInfos).toEqual([]);
      });
    });

    it('should return empty array for empty constructs', async () => {
      const cronInfos = await generator.build(context, [], outputDir, {
        provider: 'aws-lambda',
      });
      expect(cronInfos).toEqual([]);
    });

    it('should use default provider when none specified', async () => {
      const constructs = [
        createMockCronConstruct('defaultCron', 'rate(1 hour)', 30),
      ];

      const cronInfos = await generator.build(context, constructs, outputDir);

      expect(cronInfos).toHaveLength(1);
      expect(cronInfos[0].name).toBe('defaultCron');

      // Check that handler was created (default is aws-lambda)
      const handlerPath = join(outputDir, 'crons', 'defaultCron.ts');
      const handlerContent = await readFile(handlerPath, 'utf-8');
      expect(handlerContent).toContain('AWSScheduledFunction');
    });

    it('should handle various schedule expressions', async () => {
      const constructs = [
        createMockCronConstruct('rateCron', 'rate(5 minutes)', 30),
        createMockCronConstruct('cronExpression', 'cron(0 12 * * ? *)', 60),
        createMockCronConstruct('dailyRate', 'rate(1 day)', 120),
      ];

      const cronInfos = await generator.build(context, constructs, outputDir, {
        provider: 'aws-lambda',
      });

      expect(cronInfos[0].schedule).toBe('rate(5 minutes)');
      expect(cronInfos[1].schedule).toBe('cron(0 12 * * ? *)');
      expect(cronInfos[2].schedule).toBe('rate(1 day)');
    });

    it('should handle crons with different timeout values', async () => {
      const constructs = [
        createMockCronConstruct('quickCron', 'rate(1 minute)', 15),
        createMockCronConstruct('slowCron', 'rate(1 hour)', 900),
      ];

      const cronInfos = await generator.build(context, constructs, outputDir, {
        provider: 'aws-lambda',
      });

      expect(cronInfos[0].timeout).toBe(15);
      expect(cronInfos[1].timeout).toBe(900);
    });

    it('should handle crons with custom environment parser patterns', async () => {
      const customContext = {
        ...context,
        envParserImportPattern: '{ customParser as envParser }',
        loggerImportPattern: '{ customLogger as logger }',
      };

      const constructs = [
        createMockCronConstruct('customCron', 'rate(1 hour)', 30),
      ];

      await generator.build(customContext, constructs, outputDir, {
        provider: 'aws-lambda',
      });

      const handlerPath = join(outputDir, 'crons', 'customCron.ts');
      const handlerContent = await readFile(handlerPath, 'utf-8');

      expect(handlerContent).toContain('import { customParser as envParser }');
      expect(handlerContent).toContain('import { customLogger as logger }');
    });
  });
});
