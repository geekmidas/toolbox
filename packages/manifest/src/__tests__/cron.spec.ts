import { describe, expect, it } from 'vitest';
import {
	InvalidCronExpressionError,
	parseCron,
	toAwsCron,
	toUnixCron,
	UnconvertibleCronExpressionError,
} from '../cron';

describe('parseCron', () => {
	it.each([
		['cron(0 8 * * *)', 'unix'],
		['cron(*/15 * * * *)', 'unix'],
		['cron(0 9 * * 1-5)', 'unix'],
		['cron(0 9 * * MON-FRI)', 'unix'],
		['cron(0 6,18 * * *)', 'unix'],
		['cron(0 0 1 * 0)', 'unix'],
		['cron(0 9 1 * MON)', 'unix'],
		['cron(0 0 * * 7)', 'unix'],
		['cron(0 08 * * ? *)', 'aws'],
		['cron(0/30 * * * ? *)', 'aws'],
		['cron(0 0 * * ? *)', 'aws'],
		['cron(0 9 ? * MON-FRI *)', 'aws'],
		['cron(0 9 ? * 2-6 *)', 'aws'],
		['cron(0 9 L * ? *)', 'aws'],
		['cron(0 9 15W * ? *)', 'aws'],
		['cron(0 9 ? * 6#3 *)', 'aws'],
		['cron(0 9 ? * FRIL 2026-2027)', 'aws'],
	])('accepts %s as %s', (expression, dialect) => {
		expect(parseCron(expression).dialect).toBe(dialect);
	});

	it('splits the fields', () => {
		expect(parseCron('cron(0 9 ? * MON-FRI 2026)')).toEqual({
			dialect: 'aws',
			minute: '0',
			hour: '9',
			dayOfMonth: '?',
			month: '*',
			dayOfWeek: 'MON-FRI',
			year: '2026',
		});
	});

	it.each([
		['4 fields', 'cron(0 8 * *)', undefined, '0 8 * *'],
		['7 fields', 'cron(0 0 8 * * ? *)', undefined, '0 0 8 * * ? *'],
		['rate()', 'rate(1 day)', undefined, 'rate(1 day)'],
		['`?` in Unix', 'cron(0 8 * * ?)', 'dayOfWeek', '?'],
		['AWS without `?`', 'cron(0 8 * * * *)', 'dayOfWeek', '*'],
		['AWS with `?` in both day fields', 'cron(0 8 ? * ? *)', 'dayOfWeek', '?'],
		[
			'AWS with both day fields restricted',
			'cron(0 9 1 * MON *)',
			'dayOfWeek',
			'MON',
		],
		['AWS day-of-week 0', 'cron(0 9 ? * 0 *)', 'dayOfWeek', '0'],
		['hour 25', 'cron(0 25 * * *)', 'hour', '25'],
		['minute 60', 'cron(60 * * * ? *)', 'minute', '60'],
		['`L` in Unix', 'cron(0 9 L * *)', 'dayOfMonth', 'L'],
		['a double space', 'cron(0  8 * * *)', 'hour', ''],
		['an unknown month', 'cron(0 8 * FOO *)', 'month', 'FOO'],
		['a year before 1970', 'cron(0 8 * * ? 1969)', 'year', '1969'],
		['an invalid atom in a list', 'cron(0 6,24 * * *)', 'hour', '24'],
	])('rejects %s', (_, expression, field, token) => {
		expect(() => parseCron(expression)).toThrow(
			expect.objectContaining({
				name: 'InvalidCronExpressionError',
				message: 'Invalid cron expression',
				cause: { expression, field, token },
			}),
		);
	});

	it('throws InvalidCronExpressionError', () => {
		expect(() => parseCron('cron(0 25 * * *)')).toThrow(
			InvalidCronExpressionError,
		);
	});
});

describe('toAwsCron', () => {
	it.each([
		['both day fields `*`', 'cron(0 8 * * *)', 'cron(0 8 * * ? *)'],
		['only day-of-month restricted', 'cron(0 0 1 * *)', 'cron(0 0 1 * ? *)'],
		['only day-of-week restricted', 'cron(0 9 * * 1-5)', 'cron(0 9 ? * 2-6 *)'],
		['day-of-week names', 'cron(0 9 * * MON-FRI)', 'cron(0 9 ? * MON-FRI *)'],
		['SUN as 0', 'cron(0 0 * * 0)', 'cron(0 0 ? * 1 *)'],
		['SUN as 7', 'cron(0 0 * * 7)', 'cron(0 0 ? * 1 *)'],
		['a range wrapping past SUN', 'cron(0 0 * * 5-7)', 'cron(0 0 ? * 1,6,7 *)'],
		['a step', 'cron(0 0 * * */2)', 'cron(0 0 ? * 1,3,5,7 *)'],
		['every day of the week', 'cron(0 0 * * 0-6)', 'cron(0 0 ? * * *)'],
	])('converts %s', (_, unix, aws) => {
		expect(toAwsCron(unix)).toEqual({ expression: aws, warnings: [] });
	});

	it('keeps day-of-week and warns when both day fields are restricted', () => {
		expect(toAwsCron('cron(0 9 1 * 1)')).toEqual({
			expression: 'cron(0 9 ? * 2 *)',
			warnings: [
				{
					code: 'dayOfMonthDropped',
					message:
						'Both day fields are restricted, so day-of-month was dropped and the cron runs on fewer days',
					token: '1',
				},
			],
		});
	});

	it('returns an AWS expression unchanged', () => {
		expect(toAwsCron('cron(0 9 15W * ? *)')).toEqual({
			expression: 'cron(0 9 15W * ? *)',
			warnings: [],
		});
	});

	it('rejects an invalid expression', () => {
		expect(() => toAwsCron('cron(0 25 * * *)')).toThrow(
			InvalidCronExpressionError,
		);
	});
});

describe('toUnixCron', () => {
	it.each([
		['`?` in day-of-week', 'cron(0 8 * * ? *)', 'cron(0 8 * * *)'],
		['`?` in day-of-month', 'cron(0 9 ? * 2-6 *)', 'cron(0 9 * * 1-5)'],
		['day-of-week names', 'cron(0 9 ? * MON-FRI *)', 'cron(0 9 * * MON-FRI)'],
		['SUN as 1', 'cron(0 0 ? * 1 *)', 'cron(0 0 * * 0)'],
		['SAT as 7', 'cron(0 0 ? * 7 *)', 'cron(0 0 * * 6)'],
		['`L` in day-of-month', 'cron(0 9 L * ? *)', 'cron(0 9 L * *)'],
		['`nL` in day-of-week', 'cron(0 9 ? * 6L *)', 'cron(0 9 * * 5L)'],
		['`n#k` in day-of-week', 'cron(0 9 ? * 6#3 *)', 'cron(0 9 * * 5#3)'],
		['a named `nL`', 'cron(0 9 ? * FRIL *)', 'cron(0 9 * * FRIL)'],
	])('converts %s', (_, aws, unix) => {
		expect(toUnixCron(aws)).toEqual({ expression: unix, warnings: [] });
	});

	it('drops a specific year with a warning', () => {
		expect(toUnixCron('cron(0 9 ? * FRI 2026-2027)')).toEqual({
			expression: 'cron(0 9 * * FRI)',
			warnings: [
				{
					code: 'yearDropped',
					message: 'The year was dropped, so the cron runs every year',
					token: '2026-2027',
				},
			],
		});
	});

	it('returns a Unix expression unchanged', () => {
		expect(toUnixCron('cron(0 9 1 * MON)')).toEqual({
			expression: 'cron(0 9 1 * MON)',
			warnings: [],
		});
	});

	it.each(['15W', 'LW', 'L-3'])('rejects %s in day-of-month', (token) => {
		const expression = `cron(0 9 ${token} * ? *)`;
		expect(() => toUnixCron(expression)).toThrow(
			expect.objectContaining({
				name: 'UnconvertibleCronExpressionError',
				message: 'Cron expression cannot be converted',
				cause: { expression, field: 'dayOfMonth', token },
			}),
		);
		expect(() => toUnixCron(expression)).toThrow(
			UnconvertibleCronExpressionError,
		);
	});
});

describe('round trip', () => {
	it.each([
		'cron(0 8 * * *)',
		'cron(*/15 * * * *)',
		'cron(0 9 * * 1-5)',
		'cron(0 9 * * MON-FRI)',
		'cron(0 6,18 1 * *)',
		'cron(0 0 * * 0)',
	])('%s converts to AWS and back unchanged', (unix) => {
		expect(toUnixCron(toAwsCron(unix).expression).expression).toBe(unix);
	});
});
