import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleInProcess } from '../inProcess';

describe('scheduleInProcess', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-04T10:00:30Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('fires on the schedule, in UTC, until stopped', async () => {
		const fire = vi.fn();
		const schedule = scheduleInProcess('* * * * *', fire);

		// Not at once: the next minute boundary is 30 seconds away.
		await vi.advanceTimersByTimeAsync(29_000);
		expect(fire).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1_000);
		expect(fire).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(120_000);
		expect(fire).toHaveBeenCalledTimes(3);

		schedule.stop();
		await vi.advanceTimersByTimeAsync(600_000);
		expect(fire).toHaveBeenCalledTimes(3);
	});

	it('skips what a long run overran rather than firing them back to back', async () => {
		let calls = 0;
		const schedule = scheduleInProcess('* * * * *', async () => {
			calls += 1;
			// Three minutes of work for a once-a-minute job.
			if (calls === 1) await new Promise((r) => setTimeout(r, 180_000));
		});

		await vi.advanceTimersByTimeAsync(30_000 + 180_000);
		expect(calls).toBe(1);

		await vi.advanceTimersByTimeAsync(60_000);
		expect(calls).toBe(2);
		schedule.stop();
	});

	it('waits out a schedule further off than a timer reaches', async () => {
		// Yearly: past Node's ~24.8-day timer ceiling, which clamps to 1ms and
		// would fire at once and then continuously.
		const fire = vi.fn();
		const schedule = scheduleInProcess('0 0 1 1 *', fire);

		await vi.advanceTimersByTimeAsync(60 * 24 * 60 * 60 * 1000);
		expect(fire).not.toHaveBeenCalled();
		schedule.stop();
	});

	it('refuses an expression it cannot read when scheduling, not later', () => {
		expect(() => scheduleInProcess('not a cron', vi.fn())).toThrow();
	});
});
