import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	type Cron,
	CronBuilder,
	type ScheduleExpression,
} from '@geekmidas/constructs/crons';
import { heartbeat } from '@geekmidas/constructs/monitors';
import { itWithDir } from '@geekmidas/testkit/os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	cleanupDir,
	createMockBuildContext,
	createMockCronFile,
	createTempDir,
	createTestCron,
} from '../../__tests__/test-helpers';
import { CronGenerator, InvalidCronSchedulesError } from '../CronGenerator';
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
			const testCron = createTestCron('cron(0 * * * *)', 30);
			expect(generator.isConstruct(testCron)).toBe(true);
		});

		it('should reject invalid constructs', () => {
			expect(generator.isConstruct({})).toBe(false);
			expect(generator.isConstruct('string')).toBe(false);
			expect(generator.isConstruct(null)).toBe(false);
		});
	});

	describe('build', () => {
		const _createMockCronConstruct = (
			key: string,
			schedule: ScheduleExpression = 'cron(0 * * * *)',
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
						'cron(0 0 * * *)',
					),
					createMockCronFile(
						cronsDir,
						'hourlyCleanup.ts',
						'hourlyCleanup',
						'cron(0 * * * *)',
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
					schedule: 'cron(0 0 * * ? *)',
				});
				expect(hourlyCleanup).toMatchObject({
					name: 'hourlyCleanup',
					handler: expect.stringContaining('crons/hourlyCleanup.handler'),
					schedule: 'cron(0 * * * ? *)',
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

			it('records the cron’s monitors in its manifest entry', async () => {
				const monitored = new CronBuilder()
					.schedule('cron(0 8 * * ? *)')
					.monitor(heartbeat.betterStack('MONITORING_URL'))
					.handle(async () => ({}));
				const plain = createTestCron();

				const cronInfos = await generator.build(
					context,
					[
						{
							key: 'monitored',
							name: 'monitored',
							construct: monitored,
							path: {
								absolute: join(tempDir, 'monitored.ts'),
								relative: 'monitored.ts',
							},
						},
						{
							key: 'plain',
							name: 'plain',
							construct: plain,
							path: {
								absolute: join(tempDir, 'plain.ts'),
								relative: 'plain.ts',
							},
						},
					],
					outputDir,
					{ provider: 'aws-lambda' },
				);

				expect(cronInfos[0].monitoring).toEqual([
					{ type: 'heartbeat', provider: 'betterStack', env: 'MONITORING_URL' },
				]);
				expect(cronInfos[1].monitoring).toBeUndefined();
			});

			it('should use default schedule when none provided', async () => {
				const cronWithDefaultSchedule = createTestCron(null, 30);

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

				expect(cronInfos[0].schedule).toBe('cron(0 * * * ? *)');
			});

			it('keeps day-of-week when a Unix schedule restricts both day fields', async () => {
				const cronInfos = await generator.build(
					context,
					[_createMockCronConstruct('monthly', 'cron(0 9 1 * MON)')],
					outputDir,
					{ provider: 'aws-lambda' },
				);

				expect(cronInfos[0].schedule).toBe('cron(0 9 ? * MON *)');
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
						'cron(0 0 * * *)',
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
					'cron(0 * * * *)',
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
						'cron(0 * * * *)',
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
						'cron(0 * * * *)',
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

		it.each([
			'aws-lambda',
			'server',
		] as const)('fails the %s build listing every invalid schedule', async (provider) => {
			const build = generator.build(
				context,
				[
					_createMockCronConstruct('valid', 'cron(0 8 * * *)'),
					_createMockCronConstruct(
						'badHour',
						'cron(0 25 * * *)' as ScheduleExpression,
					),
					_createMockCronConstruct('rate', 'rate(1 day)' as ScheduleExpression),
				],
				outputDir,
				{ provider },
			);

			await expect(build).rejects.toThrow(InvalidCronSchedulesError);
			await expect(build).rejects.toThrow(
				expect.objectContaining({
					message: 'Invalid cron schedules',
					cause: {
						crons: [
							{
								cron: 'badHour',
								schedule: 'cron(0 25 * * *)',
								field: 'hour',
								token: '25',
							},
							{
								cron: 'rate',
								schedule: 'rate(1 day)',
								field: undefined,
								token: 'rate(1 day)',
							},
						],
					},
				}),
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
					'cron(0 * * * *)',
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
					'cron(*/5 * * * *)',
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
					'cron(0 0 * * *)',
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

			expect(rateCron?.schedule).toBe('cron(*/5 * * * ? *)');
			expect(cronExpression?.schedule).toBe('cron(0 12 * * ? *)');
			expect(dailyRate?.schedule).toBe('cron(0 0 * * ? *)');
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
						'cron(* * * * *)',
					),
					createMockCronFile(
						cronsDir,
						'slowCron.ts',
						'slowCron',
						'cron(0 * * * *)',
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
					'cron(0 * * * *)',
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
