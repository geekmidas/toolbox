import type { CronsManifest } from '@geekmidas/manifest';
import { Function } from './Function';
import type { GkmLinkable } from './Linkable';
import type { StackType } from './Stack';

export type CronExpressionValue = number | '*' | '?' | `${number}/${number}`;
export type CronExpressionDay =
	| '?'
	| 'SUN'
	| 'MON'
	| 'TUE'
	| 'WED'
	| 'THU'
	| 'FRI'
	| 'SAT';

/**
 * A 6-field cron expression body: `minute hour day-of-month month day-of-week year`.
 */
export type CronString =
	`${CronExpressionValue} ${CronExpressionValue} ${CronExpressionValue} ${CronExpressionValue} ${CronExpressionDay} ${CronExpressionValue}`;
export type CronExpression = `cron(${CronString})`;
export type CronRate = `rate(${number} ${
	| 'minute'
	| 'minutes'
	| 'hour'
	| 'hours'
	| 'day'
	| 'days'})`;
/** One-time `at(…)` schedule (e.g. `at(2025-06-01T10:00:00)`). */
export type CronAt = `at(${string})`;
export type CronSchedule = CronExpression | CronRate | CronAt;

/**
 * `Cron` — wraps `sst.aws.CronV2` to invoke a `Function` on a schedule.
 * (`sst.aws.Cron` is deprecated in SST v4 in favour of
 * [`CronV2`](https://sst.dev/docs/component/aws/cron-v2).)
 *
 * `CronProps` extends the native `sst.aws.CronV2Args` (so `enabled`, `timezone`,
 * `transform`, etc. pass through), but replaces `function`/`schedule` with the
 * friendlier `processor` (a `Function`, or anything exposing `arn`) and a fully
 * type-checked `schedule`. A cron is not a link target, so it is not `Linkable`
 * and carries no `_type` (see docs §11.3).
 *
 * Source-only (extends ambient `sst.aws.*`); see docs §2.
 */
export class Cron<
	TStage extends string = string,
	TDomain extends string = string,
> extends sst.aws.CronV2 {
	constructor(
		_stack: StackType<TStage, TDomain>,
		name: string,
		props: CronProps,
	) {
		const { processor, schedule, ...cronArgs } = props;
		super(name, {
			...cronArgs,
			schedule,
			function: processor.arn,
		});
	}

	/**
	 * Build one `Cron` per entry in a `gkm build` crons manifest. Each cron's
	 * handler becomes a validated `Function` (the cron's target), so pass `links`
	 * for that function's env validation; remaining `props` are CronV2 args.
	 */
	static fromManifest<
		TStage extends string = string,
		TDomain extends string = string,
	>(
		stack: StackType<TStage, TDomain>,
		manifest: CronsManifest,
		props: Omit<CronProps, 'processor' | 'schedule'> & {
			links?: GkmLinkable[];
		} = {},
	): Cron<TStage, TDomain>[] {
		const { links, ...cronArgs } = props;
		return manifest.crons.map((cron) => {
			const processor = new Function(stack, `${cron.name}Function`, {
				name: stack.logicalPrefixedName(cron.name),
				handler: cron.handler,
				envVars: cron.environment,
				links,
				timeout: cron.timeout ? `${cron.timeout} seconds` : undefined,
				memory: cron.memorySize ? `${cron.memorySize} MB` : undefined,
			});
			return new Cron(stack, cron.name, {
				...cronArgs,
				processor,
				schedule: cron.schedule as CronSchedule,
			});
		});
	}
}

export interface CronProps
	extends Omit<sst.aws.CronV2Args, 'function' | 'schedule'> {
	/** The function invoked on schedule — a `Function` (or anything with an `arn`). */
	processor: Function | { arn: $util.Input<string> };
	/** Cron `rate(…)`, `cron(…)`, or `at(…)` schedule, fully type-checked. */
	schedule: CronSchedule;
}
