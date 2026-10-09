/**
 * When a stage's backups run, and how long they are kept — `deploy.backups`,
 * by stage, read.
 *
 * Kept free of the AWS SDK and the stack, so the workspace schema can check
 * an entry with the words a deploy would use, the way `checkStageProvider`
 * does for `deploy.objects`.
 *
 * - `every: '6h'` — every six hours, counted from 02:00 UTC: 02:00, 08:00,
 *   14:00, 20:00. `'1d'` is 02:00 UTC every day, the default.
 * - `cron: '0 *\/6 * * *'` — a five-field cron expression, in UTC.
 * - `keep: '30d'` — how long a backup is kept, the default 30 days.
 *
 * A schedule may run at most once an hour.
 */

import { GkmError } from '../errors';

/** What one stage's entry may be. */
export type StageBackupsEntry =
	| false
	| { every?: string; cron?: string; keep?: string };

/** The default: every day at 02:00 UTC, kept 30 days. */
export const DEFAULT_EVERY = '1d';
export const DEFAULT_KEEP = '30d';

/** Where an `every` schedule is counted from: 02:00 UTC. */
export const EVERY_ANCHOR_SECONDS = 2 * 60 * 60;

/** The shortest interval a schedule may have. */
export const MIN_INTERVAL_SECONDS = 60 * 60;

/** An `every` that is not an interval, or is shorter than an hour. */
export class BackupIntervalInvalid extends GkmError {
	constructor(
		readonly stage: string,
		readonly value: string,
		readonly reason: string,
	) {
		super(
			`deploy.backups.${stage}.every is '${value}', which ${reason}. Give a ` +
				"number and a unit — '90m', '6h', '1d' — of at least an hour, or a " +
				"five-field cron expression in UTC: { cron: '0 */6 * * *' }.",
		);
		this.name = 'BackupIntervalInvalid';
	}
}

/** A `cron` that is not a five-field expression, or runs more than hourly. */
export class BackupCronInvalid extends GkmError {
	constructor(
		readonly stage: string,
		readonly value: string,
		readonly reason: string,
	) {
		super(
			`deploy.backups.${stage}.cron is '${value}', which ${reason}. Give ` +
				"five fields in UTC — minute hour day-of-month month day-of-week, e.g. '0 */6 * * *' — " +
				'that run at most once an hour.',
		);
		this.name = 'BackupCronInvalid';
	}
}

/** A `keep` that is not a number of days. */
export class BackupRetentionInvalid extends GkmError {
	constructor(
		readonly stage: string,
		readonly value: string,
	) {
		super(
			`deploy.backups.${stage}.keep is '${value}', which is not a number of ` +
				"days. Give one of at least a day: keep: '30d'.",
		);
		this.name = 'BackupRetentionInvalid';
	}
}

/** An entry that is neither `false` nor `{ every | cron, keep }`. */
export class BackupsEntryInvalid extends GkmError {
	constructor(
		readonly stage: string,
		readonly value: unknown,
		readonly reason: string,
	) {
		super(
			`deploy.backups.${stage} is ${JSON.stringify(value)}, which ${reason}. ` +
				"It takes { every: '6h', keep: '30d' }, { cron: '0 */6 * * *', keep: '30d' }, " +
				'or false to take no backups.',
		);
		this.name = 'BackupsEntryInvalid';
	}
}

/** A five-field cron expression, each field expanded; `null` is `*`. */
export interface CronSchedule {
	kind: 'cron';
	expression: string;
	minutes: number[];
	hours: number[];
	days: number[] | null;
	months: number[] | null;
	weekdays: number[] | null;
}

/** Every `seconds`, counted from `offset` seconds past the epoch. */
export interface IntervalSchedule {
	kind: 'every';
	seconds: number;
	offset: number;
}

export type BackupSchedule = CronSchedule | IntervalSchedule;

/** A stage's backups, as the stack runs them. */
export interface StageBackups {
	schedule: BackupSchedule;
	/** How many days a backup is kept: the lifecycle rule's expiry. */
	keepDays: number;
	/**
	 * The longest a schedule goes between two runs — what the container's
	 * health check counts a missed run by.
	 */
	maxGapSeconds: number;
	/** `every 1d at 02:00 UTC, kept 30 days`, for the deploy's output. */
	describe: string;
}

const UNITS: Readonly<Record<string, number>> = { m: 60, h: 3600, d: 86400 };

/** `'6h'` as seconds. */
export function parseInterval(stage: string, value: string): number {
	const match = /^(\d+)\s*([mhd])$/.exec(value.trim());
	if (!match) {
		throw new BackupIntervalInvalid(stage, value, 'is not an interval');
	}
	const seconds = Number(match[1]) * UNITS[match[2]!]!;
	if (seconds < MIN_INTERVAL_SECONDS) {
		throw new BackupIntervalInvalid(
			stage,
			value,
			'is shorter than an hour, the shortest interval backups take',
		);
	}
	return seconds;
}

/** `'30d'` as days. */
export function parseRetention(stage: string, value: string): number {
	const match = /^(\d+)\s*d$/.exec(value.trim());
	const days = match ? Number(match[1]) : 0;
	if (!match || days < 1) throw new BackupRetentionInvalid(stage, value);
	return days;
}

const CRON_FIELDS = [
	{ name: 'minute', min: 0, max: 59 },
	{ name: 'hour', min: 0, max: 23 },
	{ name: 'day of month', min: 1, max: 31 },
	{ name: 'month', min: 1, max: 12 },
	{ name: 'day of week', min: 0, max: 7 },
] as const;

/** One cron field's values, or `null` for `*`. */
function cronField(
	field: string,
	spec: (typeof CRON_FIELDS)[number],
): number[] | null | string {
	if (field === '*') return null;
	const values = new Set<number>();
	for (const part of field.split(',')) {
		const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
		if (!match) return `has '${part}' in its ${spec.name} field`;
		const step = match[4] ? Number(match[4]) : 1;
		if (step < 1) return `steps by 0 in its ${spec.name} field`;
		const from = match[1] === '*' ? spec.min : Number(match[2]);
		const to =
			match[1] === '*'
				? spec.max
				: match[3] !== undefined
					? Number(match[3])
					: match[4]
						? spec.max
						: from;
		if (from < spec.min || to > spec.max || from > to) {
			return `has '${part}' in its ${spec.name} field, outside ${spec.min}-${spec.max}`;
		}
		for (let value = from; value <= to; value += step) values.add(value);
	}
	return [...values].sort((a, b) => a - b);
}

/** A five-field cron expression, expanded. */
export function parseCron(stage: string, expression: string): CronSchedule {
	const fields = expression.trim().split(/\s+/);
	if (fields.length !== 5) {
		throw new BackupCronInvalid(
			stage,
			expression,
			`has ${fields.length} field${fields.length === 1 ? '' : 's'}, not five`,
		);
	}
	const parsed = fields.map((field, i) => cronField(field, CRON_FIELDS[i]!));
	const problem = parsed.find((p) => typeof p === 'string');
	if (typeof problem === 'string') {
		throw new BackupCronInvalid(stage, expression, problem);
	}
	const [minutes, hours, days, months, weekdays] = parsed as (
		| number[]
		| null
	)[];
	return {
		kind: 'cron',
		expression: fields.join(' '),
		minutes: minutes ?? range(0, 59),
		hours: hours ?? range(0, 23),
		days: days ?? null,
		months: months ?? null,
		// Sunday is 0 and 7 alike.
		weekdays: weekdays
			? [...new Set(weekdays.map((d) => d % 7))].sort((a, b) => a - b)
			: null,
	};
}

function range(from: number, to: number): number[] {
	return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** Whether a cron schedule runs on the UTC day of `date`. */
function cronDay(schedule: CronSchedule, date: Date): boolean {
	if (schedule.months && !schedule.months.includes(date.getUTCMonth() + 1)) {
		return false;
	}
	const dom = schedule.days?.includes(date.getUTCDate());
	const dow = schedule.weekdays?.includes(date.getUTCDay());
	// Cron's rule: with both restricted, either one matching is enough.
	if (schedule.days && schedule.weekdays) return Boolean(dom || dow);
	if (schedule.days) return Boolean(dom);
	if (schedule.weekdays) return Boolean(dow);
	return true;
}

/** How far ahead a cron schedule is looked for its next run: four years. */
const CRON_HORIZON_DAYS = 4 * 366;

/**
 * The first time after `after` (to the minute) the schedule runs, or `null`
 * when it does not within four years.
 *
 * The container's runner (`runner.ts`) keeps a copy of this, since it ships
 * alone; a test holds the two to the same answers.
 */
export function nextRun(schedule: BackupSchedule, after: Date): Date | null {
	const from = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
	if (schedule.kind === 'every') {
		const interval = schedule.seconds * 1000;
		const offset = schedule.offset * 1000;
		const k = Math.ceil((from - offset) / interval);
		return new Date(offset + k * interval);
	}
	const start = new Date(from);
	const day = Date.UTC(
		start.getUTCFullYear(),
		start.getUTCMonth(),
		start.getUTCDate(),
	);
	for (let i = 0; i < CRON_HORIZON_DAYS; i++) {
		const date = new Date(day + i * 86_400_000);
		if (!cronDay(schedule, date)) continue;
		for (const hour of schedule.hours) {
			for (const minute of schedule.minutes) {
				const at = date.getTime() + hour * 3_600_000 + minute * 60_000;
				if (at >= from) return new Date(at);
			}
		}
	}
	return null;
}

/**
 * The shortest and longest a schedule goes between two runs, in seconds,
 * over the four years from 2026 — leap days and month ends included — or
 * `null` when it does not run twice in them.
 */
export function scheduleGaps(
	schedule: BackupSchedule,
): { shortest: number; longest: number } | null {
	if (schedule.kind === 'every') {
		return { shortest: schedule.seconds, longest: schedule.seconds };
	}
	const start = Date.UTC(2026, 0, 1);
	const end = start + CRON_HORIZON_DAYS * 86_400_000;
	let previous: number | undefined;
	let longest = 0;
	let shortest = Number.POSITIVE_INFINITY;
	let at: Date | null = new Date(start - 60_000);
	while (at && at.getTime() < end) {
		at = nextRun(schedule, at);
		if (!at) break;
		if (previous !== undefined) {
			longest = Math.max(longest, at.getTime() - previous);
			shortest = Math.min(shortest, at.getTime() - previous);
			// Too frequent already: the rest would only cost time.
			if (shortest < MIN_INTERVAL_SECONDS * 1000) break;
		}
		previous = at.getTime();
	}
	if (longest === 0) return null;
	return { shortest: shortest / 1000, longest: longest / 1000 };
}

/** `21600` as `6h`, `86400` as `1d`. */
function duration(seconds: number): string {
	if (seconds % 86400 === 0) return `${seconds / 86400}d`;
	if (seconds % 3600 === 0) return `${seconds / 3600}h`;
	return `${seconds / 60}m`;
}

/**
 * One stage's entry, checked and resolved: `false`, or its schedule and
 * retention — the defaults filling what it leaves out.
 *
 * @throws {BackupsEntryInvalid} for an entry of the wrong shape
 * @throws {BackupIntervalInvalid} for an `every` that is not an interval of an hour or more
 * @throws {BackupCronInvalid} for a `cron` that is not five fields, or runs more than hourly
 * @throws {BackupRetentionInvalid} for a `keep` that is not days
 */
export function checkStageBackups(
	stage: string,
	value: unknown,
): StageBackups | false {
	if (value === false) return false;
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new BackupsEntryInvalid(stage, value, 'is not an entry');
	}
	const entry = value as Record<string, unknown>;
	const unknown = Object.keys(entry).filter(
		(key) => !['every', 'cron', 'keep'].includes(key),
	);
	if (unknown.length > 0) {
		throw new BackupsEntryInvalid(
			stage,
			value,
			`has ${unknown.map((k) => `'${k}'`).join(', ')}, which it does not take`,
		);
	}
	for (const key of ['every', 'cron', 'keep'] as const) {
		if (entry[key] !== undefined && typeof entry[key] !== 'string') {
			throw new BackupsEntryInvalid(
				stage,
				value,
				`has a ${key} that is not text`,
			);
		}
	}
	if (entry.every !== undefined && entry.cron !== undefined) {
		throw new BackupsEntryInvalid(
			stage,
			value,
			'gives both every and cron; give one',
		);
	}

	const keep = (entry.keep as string | undefined) ?? DEFAULT_KEEP;
	const keepDays = parseRetention(stage, keep);

	if (typeof entry.cron === 'string') {
		const schedule = parseCron(stage, entry.cron);
		const gaps = scheduleGaps(schedule);
		if (!gaps) {
			throw new BackupCronInvalid(
				stage,
				entry.cron,
				'does not run twice in four years',
			);
		}
		if (gaps.shortest < MIN_INTERVAL_SECONDS) {
			throw new BackupCronInvalid(
				stage,
				entry.cron,
				`runs ${duration(gaps.shortest)} apart at its closest, more often than once an hour`,
			);
		}
		return {
			schedule,
			keepDays,
			maxGapSeconds: gaps.longest,
			describe: `cron '${schedule.expression}' (UTC), kept ${keepDays} days`,
		};
	}

	const every = (entry.every as string | undefined) ?? DEFAULT_EVERY;
	const seconds = parseInterval(stage, every);
	return {
		schedule: { kind: 'every', seconds, offset: EVERY_ANCHOR_SECONDS },
		keepDays,
		maxGapSeconds: seconds,
		describe: `every ${duration(seconds)} from 02:00 UTC, kept ${keepDays} days`,
	};
}
