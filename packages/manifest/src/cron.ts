/**
 * Cron expressions in the two dialects a schedule runs under:
 *
 * - **Unix**, five fields: `cron(min hour day-of-month month day-of-week)`,
 *   day-of-week 0–7 with SUN as 0 or 7. What `cron-parser` and pg-boss read.
 * - **AWS**, six fields: `cron(min hour day-of-month month day-of-week year)`,
 *   day-of-week 1–7 with SUN as 1, `?` in exactly one day field, and `L`, `W`
 *   and `#`. What EventBridge reads.
 *
 * The field count tells them apart. A seconds field is never accepted, so a
 * six-field expression is always AWS.
 */

export type CronDialect = 'unix' | 'aws';

export type CronField =
	| 'minute'
	| 'hour'
	| 'dayOfMonth'
	| 'month'
	| 'dayOfWeek'
	| 'year';

/** A validated cron expression, split into its fields. */
export interface ParsedCron {
	dialect: CronDialect;
	minute: string;
	hour: string;
	dayOfMonth: string;
	month: string;
	dayOfWeek: string;
	/** AWS only. */
	year?: string;
}

/** A best-effort conversion that changed when the cron runs. */
export interface CronConversionWarning {
	code: 'dayOfMonthDropped' | 'yearDropped';
	message: string;
	/** The token that was dropped. */
	token: string;
}

export interface CronConversion {
	expression: string;
	warnings: CronConversionWarning[];
}

/**
 * The expression is not valid in its own dialect. `field` is absent when the
 * expression isn't `cron(…)` with five or six fields at all.
 */
export class InvalidCronExpressionError extends Error {
	constructor(
		readonly expression: string,
		readonly token: string,
		readonly field?: CronField,
	) {
		super('Invalid cron expression', { cause: { expression, field, token } });
		this.name = 'InvalidCronExpressionError';
	}
}

/** The expression is valid, but has no equivalent in the target dialect. */
export class UnconvertibleCronExpressionError extends Error {
	constructor(
		readonly expression: string,
		readonly field: CronField,
		readonly token: string,
	) {
		super('Cron expression cannot be converted', {
			cause: { expression, field, token },
		});
		this.name = 'UnconvertibleCronExpressionError';
	}
}

const MONTHS = [
	'JAN',
	'FEB',
	'MAR',
	'APR',
	'MAY',
	'JUN',
	'JUL',
	'AUG',
	'SEP',
	'OCT',
	'NOV',
	'DEC',
];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

interface FieldRule {
	min: number;
	max: number;
	/** Names in order, the first being `min`. */
	names?: readonly string[];
}

const RULES = {
	minute: { min: 0, max: 59 },
	hour: { min: 0, max: 23 },
	dayOfMonth: { min: 1, max: 31 },
	month: { min: 1, max: 12, names: MONTHS },
	unixDayOfWeek: { min: 0, max: 7, names: DAYS },
	awsDayOfWeek: { min: 1, max: 7, names: DAYS },
} satisfies Record<string, FieldRule>;

/** A number in range (one or two digits), or one of the field's names. */
const toValue = (token: string, rule: FieldRule): number | undefined => {
	const named = rule.names?.indexOf(token) ?? -1;
	if (named >= 0) return rule.min + named;
	if (!/^\d{1,2}$/.test(token)) return undefined;
	const value = Number(token);
	return value >= rule.min && value <= rule.max ? value : undefined;
};

/** `*`, `v` or `a-b`, with an optional `/step`. */
const isAtom = (atom: string, rule: FieldRule): boolean => {
	const [base = '', step, ...rest] = atom.split('/');
	if (rest.length > 0) return false;
	if (step !== undefined && !/^\d{1,2}$/.test(step)) return false;
	if (base === '*') return true;
	const [from = '', to, ...more] = base.split('-');
	if (more.length > 0 || toValue(from, rule) === undefined) return false;
	return to === undefined || toValue(to, rule) !== undefined;
};

/** The first atom of a comma-separated field that is invalid. */
const invalidAtom = (
	field: string,
	isValid: (atom: string) => boolean,
): string | undefined => field.split(',').find((atom) => !isValid(atom));

const isYear = (token: string) =>
	/^\d{4}$/.test(token) && Number(token) >= 1970 && Number(token) <= 2199;

const isYearAtom = (atom: string): boolean => {
	const [base = '', step, ...rest] = atom.split('/');
	if (rest.length > 0) return false;
	if (step !== undefined && !/^\d{1,2}$/.test(step)) return false;
	if (base === '*') return true;
	const [from = '', to, ...more] = base.split('-');
	return more.length === 0 && isYear(from) && (to === undefined || isYear(to));
};

/** `L`, `L-n`, `LW` and `nW`, AWS day-of-month only, alone in the field. */
const isAwsDayOfMonthSpecial = (field: string) =>
	field === 'L' ||
	field === 'LW' ||
	/^L-\d{1,2}$/.test(field) ||
	(field.endsWith('W') &&
		toValue(field.slice(0, -1), RULES.dayOfMonth) !== undefined);

/** `nL` and `n#k`, AWS day-of-week only, alone in the field. */
const isAwsDayOfWeekSpecial = (field: string) => {
	if (field.endsWith('L')) {
		return toValue(field.slice(0, -1), RULES.awsDayOfWeek) !== undefined;
	}
	const [day = '', nth, ...rest] = field.split('#');
	return (
		nth !== undefined &&
		rest.length === 0 &&
		toValue(day, RULES.awsDayOfWeek) !== undefined &&
		/^[1-5]$/.test(nth)
	);
};

/**
 * Splits and validates a `cron(…)` expression in either dialect.
 *
 * @throws {InvalidCronExpressionError} naming the field and token that failed.
 */
export function parseCron(expression: string): ParsedCron {
	const inner = /^cron\((.*)\)$/.exec(expression)?.[1];
	const fields = inner?.split(' ') ?? [];
	if (fields.length !== 5 && fields.length !== 6) {
		throw new InvalidCronExpressionError(expression, inner ?? expression);
	}

	const [minute = '', hour = '', dayOfMonth = '', month = '', dayOfWeek = ''] =
		fields;
	const year = fields[5];
	const dialect: CronDialect = year === undefined ? 'unix' : 'aws';
	const fail = (field: CronField, token: string): never => {
		throw new InvalidCronExpressionError(expression, token, field);
	};
	const check = (field: CronField, value: string, rule: FieldRule) => {
		const atom = invalidAtom(value, (a) => isAtom(a, rule));
		if (atom !== undefined) fail(field, atom);
	};

	check('minute', minute, RULES.minute);
	check('hour', hour, RULES.hour);
	check('month', month, RULES.month);

	if (year === undefined) {
		check('dayOfMonth', dayOfMonth, RULES.dayOfMonth);
		check('dayOfWeek', dayOfWeek, RULES.unixDayOfWeek);
		return { dialect, minute, hour, dayOfMonth, month, dayOfWeek };
	}

	if (dayOfMonth === '?' && dayOfWeek === '?') fail('dayOfWeek', '?');
	if (dayOfMonth !== '?' && dayOfWeek !== '?') fail('dayOfWeek', dayOfWeek);
	if (dayOfMonth !== '?' && !isAwsDayOfMonthSpecial(dayOfMonth)) {
		check('dayOfMonth', dayOfMonth, RULES.dayOfMonth);
	}
	if (dayOfWeek !== '?' && !isAwsDayOfWeekSpecial(dayOfWeek)) {
		check('dayOfWeek', dayOfWeek, RULES.awsDayOfWeek);
	}
	const yearAtom = invalidAtom(year, isYearAtom);
	if (yearAtom !== undefined) fail('year', yearAtom);

	return { dialect, minute, hour, dayOfMonth, month, dayOfWeek, year };
}

/**
 * The days a day-of-week field runs on, as Unix numbers 0–6 (SUN = 0).
 * Only for plain fields: values, ranges, steps and lists.
 */
const unixDays = (field: string, dialect: CronDialect): Set<number> => {
	const rule = dialect === 'unix' ? RULES.unixDayOfWeek : RULES.awsDayOfWeek;
	const days = new Set<number>();
	for (const atom of field.split(',')) {
		const [base = '', step] = atom.split('/');
		const [from = '', to] = base.split('-');
		const start = base === '*' ? rule.min : (toValue(from, rule) as number);
		const end =
			to !== undefined
				? (toValue(to, rule) as number)
				: base === '*' || step !== undefined
					? rule.max
					: start;
		for (let day = start; day <= end; day += Number(step ?? 1)) {
			days.add(dialect === 'unix' ? day % 7 : day - 1);
		}
	}
	return days;
};

/** Days as a list, with runs of three or more written as ranges. */
const formatDays = (days: number[]): string => {
	const parts: string[] = [];
	let i = 0;
	while (i < days.length) {
		let j = i;
		while (j + 1 < days.length && days[j + 1] === (days[j] as number) + 1) {
			j++;
		}
		parts.push(
			j - i >= 2 ? `${days[i]}-${days[j]}` : days.slice(i, j + 1).join(','),
		);
		i = j + 1;
	}
	return parts.join(',');
};

/**
 * Rewrites a day-of-week field's numbers into the target dialect. Fields
 * written only with names and `*` mean the same in both and pass through.
 */
const convertDayOfWeek = (field: string, from: CronDialect): string => {
	if (!/\d/.test(field)) return field;
	const days = unixDays(field, from);
	if (days.size === 7) return '*';
	if (from === 'aws') return formatDays([...days].sort((a, b) => a - b));
	// SUN goes from first to last, so a week from MON reads in order.
	return formatDays([...days].map((day) => day + 1).sort((a, b) => a - b));
};

const format = (fields: string[]) => `cron(${fields.join(' ')})`;

/**
 * Converts a cron expression to the six-field AWS form EventBridge reads. An
 * AWS expression is returned unchanged.
 *
 * Unix runs on either day field when both are restricted, and AWS can't
 * express that, so day-of-week is kept and day-of-month dropped with a
 * warning.
 *
 * @throws {InvalidCronExpressionError} when the expression is invalid.
 */
export function toAwsCron(expression: string): CronConversion {
	const cron = parseCron(expression);
	if (cron.dialect === 'aws') return { expression, warnings: [] };

	const { minute, hour, dayOfMonth, month, dayOfWeek } = cron;
	const warnings: CronConversionWarning[] = [];
	if (dayOfMonth !== '*' && dayOfWeek !== '*') {
		warnings.push({
			code: 'dayOfMonthDropped',
			message:
				'Both day fields are restricted, so day-of-month was dropped and the cron runs on fewer days',
			token: dayOfMonth,
		});
	}

	const [awsDayOfMonth, awsDayOfWeek] =
		dayOfWeek === '*'
			? [dayOfMonth, '?']
			: ['?', convertDayOfWeek(dayOfWeek, 'unix')];

	return {
		expression: format([minute, hour, awsDayOfMonth, month, awsDayOfWeek, '*']),
		warnings,
	};
}

/**
 * Converts a cron expression to the five-field Unix form `cron-parser` reads.
 * A Unix expression is returned unchanged.
 *
 * A specific year is dropped with a warning, so the cron runs every year.
 *
 * @throws {InvalidCronExpressionError} when the expression is invalid.
 * @throws {UnconvertibleCronExpressionError} for `W` and `L-n`, which Unix
 * has no equivalent for.
 */
export function toUnixCron(expression: string): CronConversion {
	const cron = parseCron(expression);
	if (cron.dialect === 'unix') return { expression, warnings: [] };

	const { minute, hour, dayOfMonth, month, dayOfWeek, year = '*' } = cron;
	const warnings: CronConversionWarning[] = [];
	if (year !== '*') {
		warnings.push({
			code: 'yearDropped',
			message: 'The year was dropped, so the cron runs every year',
			token: year,
		});
	}

	if (dayOfMonth.includes('W') || dayOfMonth.startsWith('L-')) {
		throw new UnconvertibleCronExpressionError(
			expression,
			'dayOfMonth',
			dayOfMonth,
		);
	}

	return {
		expression: format([
			minute,
			hour,
			dayOfMonth === '?' ? '*' : dayOfMonth,
			month,
			convertAwsDayOfWeek(dayOfWeek),
		]),
		warnings,
	};
}

/** `?` becomes `*`; `nL` and `n#k` keep their suffix with `n` shifted. */
const convertAwsDayOfWeek = (field: string): string => {
	if (field === '?') return '*';
	const special = /^(\w+?)(L|#[1-5])$/.exec(field);
	if (special) {
		const [, day = '', suffix = ''] = special;
		return `${convertDayOfWeek(day, 'aws')}${suffix}`;
	}
	return convertDayOfWeek(field, 'aws');
};
