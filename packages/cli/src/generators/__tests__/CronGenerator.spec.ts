import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Cron, ScheduleExpression } from '@geekmidas/constructs/crons';
import { itWithDir } from '@geekmidas/testkit/os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupDir,
  createMockBuildContext,
  createMockCronFile,
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
      schedule: ScheduleExpression = 'rate(1 hour)',
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
      itWithDir('should generate cron handlers', async ({ dir }) => {
        const outputDir = join(dir, 'output');
        const cronsDir = join(dir, 'crons');
        await mkdir(outputDir, { recursive: true });

        await Promise.all([
          createMockCronFile(
            cronsDir,
            'dailyReport.ts',
            'dailyReport',
            'rate(1 day)',
          ),
          createMockCronFile(
            cronsDir,
            'hourlyCleanup.ts',
            'hourlyCleanup',
            'rate(1 hour)',
          ),
          createMockCronFile(
            cronsDir,
            'weeklyBackup.ts',
            'weeklyBackup',
            'cron(0 0 ? * SUN *)',
          ),
        ]);

        const constructs = await generator.load('**/crons/*.ts', dir);

        const cronInfos = await generator.build(
          context,
          constructs,
          outputDir,
          { provider: 'aws-lambda' },
        );

        expect(cronInfos).toHaveLength(3);

        // Find crons by name since order may vary
        const dailyReport = cronInfos.find((c) => c.name === 'dailyReport');
        const hourlyCleanup = cronInfos.find((c) => c.name === 'hourlyCleanup');
        const weeklyBackup = cronInfos.find((c) => c.name === 'weeklyBackup');

        expect(dailyReport).toMatchObject({
          name: 'dailyReport',
          handler: expect.stringContaining('crons/dailyReport.handler'),
          schedule: 'rate(1 day)',
        });
        expect(hourlyCleanup).toMatchObject({
          name: 'hourlyCleanup',
          handler: expect.stringContaining('crons/hourlyCleanup.handler'),
          schedule: 'rate(1 hour)',
        });
        expect(weeklyBackup).toMatchObject({
          name: 'weeklyBackup',
          handler: expect.stringContaining('crons/weeklyBackup.handler'),
          schedule: 'cron(0 0 ? * SUN *)',
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
        const cronWithDefaultSchedule = createTestCron(undefined, 30);

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

      itWithDir(
        'should generate correct relative import paths',
        async ({ dir }) => {
          const outputDir = join(dir, 'output');
          const nestedDir = join(dir, 'src', 'crons', 'deep');
          await mkdir(outputDir, { recursive: true });

          await createMockCronFile(
            nestedDir,
            'deepCron.ts',
            'deepCron',
            'rate(1 day)',
          );

          const constructs = await generator.load(
            '**/src/crons/deep/*.ts',
            dir,
          );

          await generator.build(context, constructs, outputDir, {
            provider: 'aws-lambda',
          });

          const handlerPath = join(outputDir, 'crons', 'deepCron.ts');
          const handlerContent = await readFile(handlerPath, 'utf-8');

          // Check relative imports are correct - the path will be relative from outputDir
          expect(handlerContent).toMatch(
            /from ['"]+.*src\/crons\/deep\/deepCron\.js['"]+/,
          );
          expect(handlerContent).toMatch(/from ['"]+.*\/env['"]+/);
          expect(handlerContent).toMatch(/from ['"]+.*\/logger['"]+/);
        },
      );

      itWithDir('should log generation progress', async ({ dir }) => {
        const logSpy = vi.spyOn(console, 'log');
        const outputDir = join(dir, 'output');
        const cronsDir = join(dir, 'crons');
        await mkdir(outputDir, { recursive: true });

        await createMockCronFile(
          cronsDir,
          'testCron.ts',
          'testCron',
          'rate(1 hour)',
        );

        const constructs = await generator.load('**/crons/*.ts', dir);

        await generator.build(context, constructs, outputDir, {
          provider: 'aws-lambda',
        });

        expect(logSpy).toHaveBeenCalledWith('Generated cron handler: testCron');

        logSpy.mockRestore();
      });
    });

    describe('non aws-lambda provider', () => {
      itWithDir(
        'should return empty array for server provider',
        async ({ dir }) => {
          const outputDir = join(dir, 'output');
          const cronsDir = join(dir, 'crons');
          await mkdir(outputDir, { recursive: true });

          await createMockCronFile(
            cronsDir,
            'testCron.ts',
            'testCron',
            'rate(1 hour)',
          );

          const constructs = await generator.load('**/crons/*.ts', dir);

          const cronInfos = await generator.build(
            context,
            constructs,
            outputDir,
            { provider: 'server' },
          );

          expect(cronInfos).toEqual([]);
        },
      );

      itWithDir(
        'should return empty array for aws-apigatewayv1 provider',
        async ({ dir }) => {
          const outputDir = join(dir, 'output');
          const cronsDir = join(dir, 'crons');
          await mkdir(outputDir, { recursive: true });

          await createMockCronFile(
            cronsDir,
            'testCron.ts',
            'testCron',
            'rate(1 hour)',
          );

          const constructs = await generator.load('**/crons/*.ts', dir);

          const cronInfos = await generator.build(
            context,
            constructs,
            outputDir,
            { provider: 'aws-apigatewayv1' },
          );

          expect(cronInfos).toEqual([]);
        },
      );
    });

    it('should return empty array for empty constructs', async () => {
      const cronInfos = await generator.build(context, [], outputDir, {
        provider: 'aws-lambda',
      });
      expect(cronInfos).toEqual([]);
    });

    itWithDir(
      'should use default provider when none specified',
      async ({ dir }) => {
        const outputDir = join(dir, 'output');
        const cronsDir = join(dir, 'crons');
        await mkdir(outputDir, { recursive: true });

        await createMockCronFile(
          cronsDir,
          'defaultCron.ts',
          'defaultCron',
          'rate(1 hour)',
        );

        const constructs = await generator.load('**/crons/*.ts', dir);

        const cronInfos = await generator.build(context, constructs, outputDir);

        expect(cronInfos).toHaveLength(1);
        expect(cronInfos[0].name).toBe('defaultCron');

        // Check that handler was created (default is aws-lambda)
        const handlerPath = join(outputDir, 'crons', 'defaultCron.ts');
        const handlerContent = await readFile(handlerPath, 'utf-8');
        expect(handlerContent).toContain('AWSScheduledFunction');
      },
    );

    itWithDir('should handle various schedule expressions', async ({ dir }) => {
      const outputDir = join(dir, 'output');
      const cronsDir = join(dir, 'crons');
      await mkdir(outputDir, { recursive: true });

      await Promise.all([
        createMockCronFile(
          cronsDir,
          'rateCron.ts',
          'rateCron',
          'rate(5 minutes)',
        ),
        createMockCronFile(
          cronsDir,
          'cronExpression.ts',
          'cronExpression',
          'cron(0 12 * * ? *)',
        ),
        createMockCronFile(
          cronsDir,
          'dailyRate.ts',
          'dailyRate',
          'rate(1 day)',
        ),
      ]);

      const constructs = await generator.load('**/crons/*.ts', dir);

      const cronInfos = await generator.build(context, constructs, outputDir, {
        provider: 'aws-lambda',
      });

      // Find crons by name since order may vary
      const rateCron = cronInfos.find((c) => c.name === 'rateCron');
      const cronExpression = cronInfos.find((c) => c.name === 'cronExpression');
      const dailyRate = cronInfos.find((c) => c.name === 'dailyRate');

      expect(rateCron?.schedule).toBe('rate(5 minutes)');
      expect(cronExpression?.schedule).toBe('cron(0 12 * * ? *)');
      expect(dailyRate?.schedule).toBe('rate(1 day)');
    });

    itWithDir(
      'should handle crons with different timeout values',
      async ({ dir }) => {
        const outputDir = join(dir, 'output');
        const cronsDir = join(dir, 'crons');
        await mkdir(outputDir, { recursive: true });

        await Promise.all([
          createMockCronFile(
            cronsDir,
            'quickCron.ts',
            'quickCron',
            'rate(1 minute)',
          ),
          createMockCronFile(
            cronsDir,
            'slowCron.ts',
            'slowCron',
            'rate(1 hour)',
          ),
        ]);

        const constructs = await generator.load('**/crons/*.ts', dir);

        const cronInfos = await generator.build(
          context,
          constructs,
          outputDir,
          {
            provider: 'aws-lambda',
          },
        );

        // Find crons by name since order may vary
        const quickCron = cronInfos.find((c) => c.name === 'quickCron');
        const slowCron = cronInfos.find((c) => c.name === 'slowCron');

        // Note: timeout comes from the cron construct, not the file creation
        expect(quickCron).toBeDefined();
        expect(slowCron).toBeDefined();
      },
    );

    itWithDir(
      'should handle crons with custom environment parser patterns',
      async ({ dir }) => {
        const outputDir = join(dir, 'output');
        const cronsDir = join(dir, 'crons');
        await mkdir(outputDir, { recursive: true });

        const customContext = {
          ...context,
          envParserImportPattern: '{ customParser as envParser }',
          loggerImportPattern: '{ customLogger as logger }',
        };

        await createMockCronFile(
          cronsDir,
          'customCron.ts',
          'customCron',
          'rate(1 hour)',
        );

        const constructs = await generator.load('**/crons/*.ts', dir);

        await generator.build(customContext, constructs, outputDir, {
          provider: 'aws-lambda',
        });

        const handlerPath = join(outputDir, 'crons', 'customCron.ts');
        const handlerContent = await readFile(handlerPath, 'utf-8');

        expect(handlerContent).toContain(
          'import { customParser as envParser }',
        );
        expect(handlerContent).toContain('import { customLogger as logger }');
      },
    );
  });
});
