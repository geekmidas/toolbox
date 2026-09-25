import { describe, expect, it } from 'vitest';
import { toCronExpression, UnrepresentableSchedule } from '../schedule';

describe('toCronExpression', () => {
	describe('cron(…), which is already cron', () => {
		it('unwraps the expression', () => {
			expect(toCronExpression('cron(0 0 * * *)')).toBe('0 0 * * *');
			expect(toCronExpression('cron(*/15 9-17 * * 1-5)')).toBe(
				'*/15 9-17 * * 1-5',
			);
		});
	});

	describe('rate(…), which is an interval rather than a schedule', () => {
		it('converts the intervals that divide their unit', () => {
			expect(toCronExpression('rate(1 minute)')).toBe('* * * * *');
			expect(toCronExpression('rate(5 minutes)')).toBe('*/5 * * * *');
			expect(toCronExpression('rate(30 minutes)')).toBe('*/30 * * * *');
			expect(toCronExpression('rate(1 hour)')).toBe('0 * * * *');
			expect(toCronExpression('rate(6 hours)')).toBe('0 */6 * * *');
			expect(toCronExpression('rate(1 day)')).toBe('0 0 * * *');
		});

		it('takes the singular and the plural alike', () => {
			expect(toCronExpression('rate(2 hour)')).toBe(
				toCronExpression('rate(2 hours)'),
			);
		});
	});

	describe('the intervals with no exact equivalent', () => {
		// The whole point of this module. `*/7` in the hour field fires at 0, 7,
		// 14, 21 and then restarts at midnight — a three-hour gap, not seven. A
		// framework that rounded this would produce a job running at the wrong
		// time, which is far harder to notice than one that refused to build.
		it('refuses an hour interval that does not divide 24', () => {
			expect(() => toCronExpression('rate(7 hours)')).toThrow(
				UnrepresentableSchedule,
			);
			expect(() => toCronExpression('rate(5 hours)')).toThrow(/divide 24/);
		});

		it('refuses a minute interval that does not divide 60', () => {
			expect(() => toCronExpression('rate(7 minutes)')).toThrow(/divide 60/);
			expect(() => toCronExpression('rate(45 minutes)')).toThrow(/divide 60/);
		});

		it('refuses every multi-day interval, because months differ in length', () => {
			expect(() => toCronExpression('rate(2 days)')).toThrow(
				/restarts every month/,
			);
			expect(() => toCronExpression('rate(7 days)')).toThrow(
				UnrepresentableSchedule,
			);
		});

		it('says what to write instead', () => {
			// An error that only says no costs the reader a search.
			expect(() => toCronExpression('rate(7 hours)')).toThrow(
				/cron\(0 \*\/6 \* \* \*\)/,
			);
		});

		it('refuses a unit it does not know', () => {
			expect(() => toCronExpression('rate(1 fortnight)' as never)).toThrow(
				/not one of minute, hour, day/,
			);
		});

		it('refuses something that is neither spelling', () => {
			expect(() => toCronExpression('every friday' as never)).toThrow(
				/neither `cron\(…\)` nor `rate\(n unit\)`/,
			);
		});
	});
});
