/**
 * A process with no port.
 *
 * `RestApi` is the process that answers HTTP. This is the one that does not —
 * the thing that runs a schedule, drains a queue, consumes a topic. Until it
 * existed, those had nowhere to say they belonged: a cron declared a schedule
 * and nothing else, and which container ran it was decided by the directory the
 * file sat in. A glob owned it.
 *
 * The cost of that shows up in the scaffolds. `gkm init --template worker` —
 * a project that is background jobs and nothing else — declared
 * `new RestApi('Api', { defaultAuthorizer: 'none', logger })`: an HTTP surface
 * with no HTTP on it, written because it was the only construct that made an
 * app exist and the only way to get a logger into the generated runtime.
 *
 * It takes no authorizer, and that is the tell that these are two constructs
 * rather than one with a flag: a `RestApi` needs one because an HTTP surface
 * can ship open by omission, and nothing reaches a worker from outside.
 *
 * ## Crons on a server target need a database
 *
 * A cron becomes an EventBridge rule on AWS and nothing here is consulted. A
 * server has nothing firing its crons but itself, and a process that schedules
 * in memory fires every job once per replica while reporting success — so the
 * schedule is kept in Postgres, and the worker says which one with
 * `.database(db)`.
 *
 * A worker with crons and no `.database(…)` schedules nothing on a server
 * target and says so at startup. That is a limitation of workers today rather
 * than a design: the store could be a cache, or something the target
 * provisions, and Postgres is what exists.
 *
 * It is not an app. A worker names the process that runs its crons and
 * subscribers, and that process is the app's server — the same one the
 * endpoints run in, minus the HTTP surface. Giving a worker a container of its
 * own made a second thing to build, deploy and keep alive for work that was
 * always going to run somewhere already. Declare as many as the shape of the
 * work wants: they are groupings, not deployments.
 *
 * @example
 * ```ts
 * // constructs/worker.ts
 * import { Worker } from '@geekmidas/constructs/worker';
 * import { logger } from './logger.js';
 *
 * export const worker = new Worker('Worker', { logger }).calls([database]);
 *
 * // crons/cleanup.ts
 * import { worker } from '@acme/constructs/worker.js';
 *
 * export const cleanup = worker
 *   .cron('rate(1 day)')
 *   .handle(async ({ logger }) => { … });
 * ```
 */

import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { DEFAULT_LOGGER } from '@geekmidas/logger/console';
import {
	type ConstructName,
	canonicalId,
	type Declaration,
	type Dependency,
} from '@geekmidas/manifest';
import {
	type Consumable,
	type Declarable,
	edgeTo,
} from './construct-interface';
import type { ScheduleExpression } from './crons/Cron';
import { CronBuilder } from './crons/CronBuilder';
import { envParserFor } from './endpoints/surfaceEnv';
import { FunctionBuilder } from './functions/FunctionBuilder';
import { SubscriberBuilder } from './subscribers/SubscriberBuilder';

export interface WorkerConfig {
	/**
	 * The logger everything built from this worker runs with.
	 *
	 * The actual logger, not a path to one — the same reason `RestApi` takes
	 * one. Every cron and subscriber in a scaffolded project used to open with
	 * `import { logger } from '…/constructs/logger.js'`, which is the line this
	 * removes.
	 */
	logger?: Logger;
	/**
	 * The environment parser everything built from this worker runs with.
	 *
	 * Defaults to `process.env` merged with the credentials `gkm dev` injected,
	 * which is what an application's own `config/env.ts` always was.
	 */
	envParser?: EnvironmentParser<{}>;
}

export class Worker<TName extends string = string>
	implements Declarable<TName>
{
	readonly id: TName;

	/** Always defined — the worker's own, or the console logger. */
	readonly logger: Logger;

	/** Always defined, and normally the default. */
	readonly envParser: EnvironmentParser<{}>;

	/**
	 * Where this worker's schedules live, when it has crons and a server runs
	 * them. `undefined` until `.database(…)` says.
	 */
	readonly scheduleStore?: Consumable<string, unknown>;

	constructor(
		id: ConstructName<TName>,
		private readonly config: WorkerConfig = {},
		/** Internal: how `.calls()` carries edges into the copy it returns. */
		private readonly dependencies: readonly Dependency[] = [],
		scheduleStore?: Consumable<string, unknown>,
	) {
		const canonical = canonicalId(id as string);

		this.id = canonical as TName;
		this.logger = config.logger ?? DEFAULT_LOGGER;
		this.envParser = envParserFor(
			config.envParser
				? { id: canonical, envParser: config.envParser }
				: undefined,
		);
		this.scheduleStore = scheduleStore;
	}

	/**
	 * The database this worker keeps its schedules in.
	 *
	 * Only a server target uses it. On AWS a cron is an EventBridge rule
	 * invoking a Lambda and nothing here is consulted — but a server has nothing
	 * firing its crons except itself, and a process that schedules in memory
	 * fires every job once per replica while reporting that all is well.
	 *
	 * So the store is declared rather than discovered. It could have been
	 * inferred — from a database the app happens to declare, or from the events
	 * backend when that backend is pg-boss — and both would work until an app
	 * had two databases, or moved its events to SNS, at which point the
	 * schedules would quietly move or stop. Naming it is one line and cannot
	 * drift.
	 *
	 * @example
	 * ```ts
	 * export const jobs = new Worker('Jobs', { logger }).database(database);
	 * ```
	 */
	database<T, TDbName extends string>(
		source: Consumable<TDbName, T>,
	): Worker<TName> {
		return new Worker<TName>(
			this.id as ConstructName<TName>,
			this.config,
			[...this.dependencies, edgeTo(source)],
			source as unknown as Consumable<string, unknown>,
		);
	}

	/**
	 * This worker's cron factory, carrying its logger.
	 *
	 * `export const c = crons.logger(logger)` written once and hung off the
	 * thing that runs it, so a cron file opens with the schedule rather than
	 * with an import of a logger it has to know the path to.
	 */
	get crons() {
		return this.own(new CronBuilder().logger(this.logger));
	}

	/**
	 * This worker's subscriber factory, carrying its logger.
	 *
	 * Chain `.publisher(…)` before `.subscribe([…])`: the event names are typed
	 * from the publisher's message union, so there is nothing to spell twice.
	 */
	get subscribers() {
		return this.own(new SubscriberBuilder().logger(this.logger));
	}

	/** This worker's function factory, carrying its logger. */
	get functions() {
		return this.own(new FunctionBuilder().logger(this.logger));
	}

	/**
	 * Sugar for the common case, the way `api.get()` is for `api.endpoints`.
	 *
	 * @example `worker.cron('rate(1 day)').handle(async ({ logger }) => { … })`
	 */
	cron(schedule: ScheduleExpression) {
		return this.crons.schedule(schedule);
	}

	/**
	 * Resources and surfaces this worker calls.
	 *
	 * Not `.dependsOn()`: this records the edge that derives the worker's
	 * environment and its access, the same distinction `RestApi.calls()` draws.
	 */
	calls(constructs: readonly Declarable[]): Worker<TName> {
		return new Worker<TName>(
			this.id as ConstructName<TName>,
			this.config,
			[...this.dependencies, ...constructs.map(edgeTo)],
			this.scheduleStore,
		);
	}

	/**
	 * Stamps this worker's id onto a builder, so everything built from it says
	 * which process runs it.
	 */
	private own<T extends { _owner?: string; _scheduleStore?: unknown }>(
		builder: T,
	): T {
		builder._owner = this.id;
		builder._scheduleStore = this.scheduleStore;

		return builder;
	}

	declare(): Declaration[] {
		return [
			{
				kind: 'worker',
				id: this.id,
				...(this.dependencies.length
					? { dependencies: this.dependencies }
					: {}),
				// Nothing calls a worker, so it publishes no address.
				provides: [],
			},
		];
	}
}
