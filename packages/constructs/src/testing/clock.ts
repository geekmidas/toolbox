/**
 * A test's clock: the time a `Webhooks` construct schedules by, moved by hand.
 *
 * Only that seam is replaced. Faking the process's timers would stop Postgres
 * and pg-boss's own timeouts too, so `Date`, `setTimeout` and the database's
 * `now()` keep the real time; what reads `hooks.clock()` — when a delivery is
 * next due, when a rotated secret stops signing — reads this.
 */
export interface TestClock {
	/** The time now, as a construct swapped onto this clock sees it. */
	now(): Date;
	/**
	 * Jump to `date`.
	 *
	 * @throws {InvalidClockTime} when it is not a time
	 */
	set(date: Date | string | number): void;
	/**
	 * Move forward: a number of milliseconds, or an amount and a unit —
	 * `'30s'`, `'1m'`, `'2h'`, `'1d'`.
	 *
	 * @throws {InvalidClockDuration} for anything else
	 */
	advance(by: number | string): void;
}

/** What `clock.advance` takes as a string, in milliseconds per unit. */
const UNITS: Record<string, number> = {
	ms: 1,
	s: 1_000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
};

/** `clock.advance` was given something that is not a duration. */
export class InvalidClockDuration extends Error {
	constructor(readonly duration: unknown) {
		super(
			`clock.advance(${JSON.stringify(duration)}) is not a duration. Pass ` +
				`milliseconds, or an amount and a unit: '30s', '1m', '2h', '1d'.`,
		);
		this.name = 'InvalidClockDuration';
	}
}

/** `clock.set` was given something that is not a time. */
export class InvalidClockTime extends Error {
	constructor(readonly time: unknown) {
		super(
			`clock.set(${JSON.stringify(time)}) is not a time. Pass a Date, an ` +
				`ISO string such as '2026-01-01T00:00:00Z', or epoch milliseconds.`,
		);
		this.name = 'InvalidClockTime';
	}
}

/** Milliseconds, from a number of them or `'<amount><ms|s|m|h|d>'`. */
export function durationMs(by: number | string): number {
	if (typeof by === 'number') {
		if (!Number.isFinite(by)) throw new InvalidClockDuration(by);
		return by;
	}
	const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)\s*$/.exec(by);
	if (!match) throw new InvalidClockDuration(by);
	return Number(match[1]) * UNITS[match[2]!]!;
}

/**
 * A clock stopped at `start` — the real time when the test began — that moves
 * only when told to, so what a test schedules is due exactly when it says.
 */
export function testClock(start: Date = new Date()): TestClock {
	let time = start.getTime();
	return {
		now: () => new Date(time),
		set: (date) => {
			const next = new Date(date).getTime();
			if (Number.isNaN(next)) throw new InvalidClockTime(date);
			time = next;
		},
		advance: (by) => {
			time += durationMs(by);
		},
	};
}
