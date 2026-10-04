import { CronExpressionParser } from 'cron-parser';

/**
 * The longest delay a timer takes. Node clamps anything longer to 1ms, so a
 * monthly cron would fire at once and then every millisecond.
 */
const MAX_DELAY = 2 ** 31 - 1;

/** A schedule that is running, and the way to stop it. */
export interface InProcessSchedule {
	stop(): void;
}

/**
 * Run `fire` on a cron expression, in this process, by timer.
 *
 * For the one process that has no broker to keep a schedule: `gkm dev` on a
 * target whose crons are infrastructure once deployed — an EventBridge rule on
 * AWS. Deployed, a timer is the wrong tool: each replica would fire every job
 * once, and nothing would say so. That is why a server schedules through
 * pg-boss, and why this is never what a deployed process does.
 *
 * In UTC, as the deployed schedule is. The next firing is worked out from the
 * clock after each run rather than read off a sequence, so a run that outlasts
 * its interval skips what it overran instead of firing them back to back.
 */
export function scheduleInProcess(
	expression: string,
	fire: () => Promise<unknown> | unknown,
): InProcessSchedule {
	// Parsed once up front, so a bad expression throws here — to the caller
	// scheduling it — rather than inside a timer.
	CronExpressionParser.parse(expression, { tz: 'UTC' });

	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;

	const arm = (at: number) => {
		if (stopped) return;
		const delay = at - Date.now();
		timer = setTimeout(
			async () => {
				if (Date.now() < at) return arm(at);
				await fire();
				arm(nextAfter(expression, new Date()));
			},
			Math.min(Math.max(delay, 0), MAX_DELAY),
		);
		// The server keeps the process alive; a schedule alone should not.
		timer.unref?.();
	};

	arm(nextAfter(expression, new Date()));

	return {
		stop() {
			stopped = true;
			clearTimeout(timer);
		},
	};
}

function nextAfter(expression: string, from: Date): number {
	return CronExpressionParser.parse(expression, {
		tz: 'UTC',
		currentDate: from,
	})
		.next()
		.getTime();
}
