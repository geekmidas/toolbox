import type { ScheduleExpression } from './Cron';

/**
 * A schedule a cron runner can take, as standard five-field cron.
 *
 * `ScheduleExpression` has two spellings. `cron(m h dom mon dow)` is already
 * five-field cron and unwraps; `rate(n unit)` is an interval, and an interval
 * is not a schedule — it says how often, where cron says when.
 *
 * Most intervals still have an exact cron equivalent, because they divide their
 * unit evenly: `rate(5 minutes)` is every fifth minute of every hour, and that
 * is `*​/5 * * * *` precisely. `rate(7 hours)` has none. There is no cron field
 * that means "every seven hours" — `*​/7` in the hour field fires at 0, 7, 14
 * and 21 and then starts over at midnight, so the gap between the last firing
 * of one day and the first of the next is three hours rather than seven.
 *
 * Those are refused rather than rounded. A job that runs at the wrong hour is
 * far harder to notice than one that refused to build, and a schedule quietly
 * adjusted by the framework is a bug nobody goes looking for.
 */
export class UnrepresentableSchedule extends Error {
	constructor(
		readonly schedule: string,
		reason: string,
	) {
		super(
			`\`${schedule}\` has no exact cron equivalent: ${reason}.\n\n` +
				'Cron says *when*, not *how often*, so an interval is only exact when ' +
				'it divides its unit evenly.\n' +
				'Write the schedule you mean instead — `cron(0 */6 * * *)` for every ' +
				'sixth hour, say — or pick an interval that divides: minutes into 60, ' +
				'hours into 24.',
		);
		this.name = 'UnrepresentableSchedule';
	}
}

/** Units `rate(…)` accepts, singular or plural. */
const UNITS = ['minute', 'hour', 'day'] as const;
type Unit = (typeof UNITS)[number];

/**
 * Standard five-field cron for a schedule expression.
 *
 * @throws {UnrepresentableSchedule} when a `rate(…)` has no exact equivalent.
 */
export function toCronExpression(schedule: ScheduleExpression): string {
	const cron = /^cron\((.+)\)$/.exec(schedule);
	if (cron?.[1]) return cron[1].trim();

	const rate = /^rate\(\s*(\d+)\s+(\w+?)s?\s*\)$/.exec(schedule);
	if (!rate) {
		throw new UnrepresentableSchedule(
			schedule,
			'it is neither `cron(…)` nor `rate(n unit)`',
		);
	}

	const every = Number(rate[1]);
	const unit = rate[2] as Unit;
	/* c8 ignore next */ if (!unit)
		throw new UnrepresentableSchedule(schedule, 'no unit');

	if (!UNITS.includes(unit)) {
		throw new UnrepresentableSchedule(
			schedule,
			`\`${unit}\` is not one of ${UNITS.join(', ')}`,
		);
	}

	if (every < 1) {
		throw new UnrepresentableSchedule(
			schedule,
			'an interval must be at least 1',
		);
	}

	switch (unit) {
		case 'minute':
			if (every === 1) return '* * * * *';
			if (60 % every !== 0) {
				throw new UnrepresentableSchedule(
					schedule,
					`${every} does not divide 60, so the interval would reset at the top of each hour`,
				);
			}
			return `*/${every} * * * *`;

		case 'hour':
			if (every === 1) return '0 * * * *';
			if (24 % every !== 0) {
				throw new UnrepresentableSchedule(
					schedule,
					`${every} does not divide 24, so the interval would reset at midnight`,
				);
			}
			return `0 */${every} * * *`;

		case 'day':
			if (every === 1) return '0 0 * * *';
			// `*/n` in day-of-month restarts on the 1st, so a 2-day interval fires
			// on the 1st and 3rd of a 31-day month and then again on the 1st — one
			// day later, not two. No month length makes that come out even.
			throw new UnrepresentableSchedule(
				schedule,
				'day-of-month restarts every month, so no multi-day interval is even',
			);
	}
}
