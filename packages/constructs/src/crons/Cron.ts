import type { AuditableAction } from '@geekmidas/audit';
import type { EventPublisher } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type { ComposableStandardSchema } from '@geekmidas/schema';
import type { Service } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import { ConstructType } from '../Construct';
import { Function, type FunctionHandler } from '../functions';
import type { MonitorInfo } from '../monitor';

export class Cron<
	TInput extends ComposableStandardSchema | undefined = undefined,
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	TEventPublisher extends EventPublisher<any> | undefined = undefined,
	TEventPublisherServiceName extends string = string,
	TDatabase = undefined,
	TDatabaseServiceName extends string = string,
> extends Function<
	TInput,
	TServices,
	TLogger,
	OutSchema,
	TEventPublisher,
	TEventPublisherServiceName,
	undefined,
	string,
	TDatabase,
	TDatabaseServiceName,
	AuditableAction<string, unknown>,
	FunctionHandler<TInput, TServices, TLogger, OutSchema, TDatabase>
> {
	static isCron(obj: any): obj is Cron<any, any, any, any> {
		return Boolean(
			obj &&
				(obj as Function).__IS_FUNCTION__ === true &&
				obj.type === ConstructType.Cron,
		);
	}

	constructor(
		fn: FunctionHandler<TInput, TServices, TLogger, OutSchema, TDatabase>,
		timeout?: number,
		protected _schedule?: ScheduleExpression,
		input?: TInput,
		outputSchema?: OutSchema,
		services: TServices = [] as unknown as TServices,
		logger?: TLogger,
		publisherService?: Service<TEventPublisherServiceName, TEventPublisher>,
		events: any[] = [],
		memorySize?: number,
		databaseService?: Service<TDatabaseServiceName, TDatabase>,
	) {
		super(
			fn,
			timeout,
			ConstructType.Cron,
			input,
			outputSchema,
			services,
			logger,
			publisherService,
			events,
			memorySize,
			undefined, // auditorStorageService
			databaseService,
		);
	}

	get schedule(): ScheduleExpression | undefined {
		return this._schedule;
	}

	/**
	 * The monitor set with `.uptime()` as the build manifest records it, or
	 * nothing when the cron has none.
	 */
	getUptime(): MonitorInfo | undefined {
		const [uptime] = this.monitors;
		return uptime && (uptime.monitor ?? { type: uptime.serviceName });
	}
}

// ---- Cron expression types ------------------------------------------------
//
// `.schedule()` takes a `cron(…)` in either of two dialects, told apart by the
// field count, and checks each by its own rules:
//
// - Unix, five fields: `min hour day-of-month month day-of-week`, with
//   day-of-week 0–7 (SUN = 0 or 7) and no `?`.
// - AWS, six fields: `min hour day-of-month month day-of-week year`, with
//   day-of-week 1–7 (SUN = 1), `?` in exactly one day field, and `L`, `W`
//   and `#` where EventBridge allows them.
//
// The types are generic because a plain union of every field's forms is too
// large for TypeScript, so the literal is checked field by field instead.
// `@geekmidas/manifest`'s `parseCron` applies the same rules at build time.

type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

/** `'0'`…`'99'`, with an optional leading zero (`'08'`). */
type UpTo99 = Digit | `${Digit}${Digit}`;

type ToNumber<S extends string> = S extends `0${infer R extends `${number}`}`
	? R extends ''
		? 0
		: ToNumber<R>
	: S extends `${infer N extends number}`
		? N
		: never;

type Range<
	N extends number,
	Acc extends number[] = [],
> = Acc['length'] extends N ? Acc[number] : Range<N, [...Acc, Acc['length']]>;

/** Numbers from `Min` to `Max` inclusive. */
type Between<Min extends number, Max extends number> =
	| Exclude<Range<Max>, Range<Min>>
	| Max;

/** A single value: a number in range, or one of the field's names. */
type IsValue<
	S extends string,
	Min extends number,
	Max extends number,
	Names extends string,
> = S extends Names
	? true
	: S extends UpTo99
		? ToNumber<S> extends Between<Min, Max>
			? true
			: false
		: false;

/** `v`, `a-b` or `*`, with an optional `/step`. */
type IsAtom<
	S extends string,
	Min extends number,
	Max extends number,
	Names extends string,
> = S extends `${infer Base}/${infer Step}`
	? Step extends UpTo99
		? Base extends '*'
			? true
			: IsAtom<Base, Min, Max, Names>
		: false
	: S extends '*'
		? true
		: S extends `${infer A}-${infer B}`
			? [IsValue<A, Min, Max, Names>, IsValue<B, Min, Max, Names>] extends [
					true,
					true,
				]
				? true
				: false
			: IsValue<S, Min, Max, Names>;

/** A comma-separated list of atoms. */
type IsField<
	S extends string,
	Min extends number,
	Max extends number,
	Names extends string = never,
> = S extends `${infer Head},${infer Rest}`
	? IsAtom<Head, Min, Max, Names> extends true
		? IsField<Rest, Min, Max, Names>
		: false
	: IsAtom<S, Min, Max, Names>;

type MonthName =
	| 'JAN'
	| 'FEB'
	| 'MAR'
	| 'APR'
	| 'MAY'
	| 'JUN'
	| 'JUL'
	| 'AUG'
	| 'SEP'
	| 'OCT'
	| 'NOV'
	| 'DEC';
type DayName = 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT';

type AllTrue<T extends boolean[]> = T extends true[] ? true : false;

type IsUnix<S extends string> =
	S extends `${infer Mi} ${infer H} ${infer Dom} ${infer Mo} ${infer Dow}`
		? AllTrue<
				[
					IsField<Mi, 0, 59>,
					IsField<H, 0, 23>,
					IsField<Dom, 1, 31>,
					IsField<Mo, 1, 12, MonthName>,
					IsField<Dow, 0, 7, DayName>,
				]
			>
		: false;

type IsAwsDayOfMonth<S extends string> = S extends 'L' | `L-${UpTo99}` | 'LW'
	? true
	: S extends `${infer D}W`
		? IsValue<D, 1, 31, never>
		: IsField<S, 1, 31>;

type IsAwsDayOfWeek<S extends string> = S extends `${infer D}L`
	? IsValue<D, 1, 7, DayName>
	: S extends `${infer D}#${infer N}`
		? AllTrue<[IsValue<D, 1, 7, DayName>, IsValue<N, 1, 5, never>]>
		: IsField<S, 1, 7, DayName>;

/** 1970–2199, EventBridge's range. */
type Year = `19${'7' | '8' | '9'}${Digit}` | `${'20' | '21'}${Digit}${Digit}`;

type IsYearAtom<S extends string> = S extends
	| '*'
	| Year
	| `${'*' | Year}/${UpTo99}`
	| `${Year}-${Year}`
	? true
	: false;

type IsAwsYear<S extends string> = S extends `${infer Head},${infer Rest}`
	? IsYearAtom<Head> extends true
		? IsAwsYear<Rest>
		: false
	: IsYearAtom<S>;

type IsAws<S extends string> =
	S extends `${infer Mi} ${infer H} ${infer Dom} ${infer Mo} ${infer Dow} ${infer Y}`
		? AllTrue<
				[
					IsField<Mi, 0, 59>,
					IsField<H, 0, 23>,
					IsField<Mo, 1, 12, MonthName>,
					IsAwsYear<Y>,
					Dom extends '?'
						? Dow extends '?'
							? false
							: IsAwsDayOfWeek<Dow>
						: Dow extends '?'
							? IsAwsDayOfMonth<Dom>
							: false,
				]
			>
		: false;

/** `T` when it is a valid five-field Unix `cron(…)`. */
export type UnixCronExpression<T extends string> = T extends `cron(${infer S})`
	? IsUnix<S> extends true
		? T
		: never
	: never;

/** `T` when it is a valid six-field AWS (EventBridge) `cron(…)`. */
export type AwsCronExpression<T extends string> = T extends `cron(${infer S})`
	? IsAws<S> extends true
		? T
		: never
	: never;

/**
 * `T` when it is a valid cron expression in either dialect, otherwise a
 * message saying what's expected. A schedule built at runtime can be cast to
 * {@link ScheduleExpression}, which `gkm build` then checks.
 */
export type CronExpression<T extends string> = [T] extends [ScheduleExpression]
	? [ScheduleExpression] extends [T]
		? T
		: CheckedCronExpression<T>
	: CheckedCronExpression<T>;

type CheckedCronExpression<T extends string> = [
	UnixCronExpression<T> | AwsCronExpression<T>,
] extends [never]
	? 'Expected cron(…) with 5 fields (Unix) or 6 fields (AWS)'
	: T;

/**
 * A cron's schedule once set. Literals are checked by {@link CronExpression};
 * every schedule is checked again by `gkm build`.
 */
export type ScheduleExpression = `cron(${string})`;
