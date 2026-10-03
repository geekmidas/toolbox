import type { Logger } from '@geekmidas/logger';
import type {
	ComposableStandardSchema,
	InferStandardSchema,
} from '@geekmidas/schema';
import type { Service } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import uniqBy from 'lodash.uniqby';
import { ConstructType } from '../Construct';
import { cloneWith } from '../clone';
import {
	type Consumable,
	idsOf,
	isConsumable,
	type ServicesOf,
	serviceOf,
	servicesOf,
} from '../construct-interface';
import { FunctionBuilder, type FunctionHandler } from '../functions';
import type { EventFor } from '../publisher';
import type { Topic } from '../topic/Topic';
import { Cron, type ScheduleExpression } from './Cron';

export class CronBuilder<
	TInput extends ComposableStandardSchema,
	TServices extends Service[],
	TLogger extends Logger = Logger,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	TDatabase = undefined,
	TDatabaseServiceName extends string = string,
> extends FunctionBuilder<
	TInput,
	OutSchema,
	TServices,
	TLogger,
	undefined,
	string,
	TDatabase,
	TDatabaseServiceName
> {
	private _schedule?: ScheduleExpression;

	constructor() {
		super(ConstructType.Cron);
	}

	override memorySize(memorySize: number): this {
		return cloneWith(this, { _memorySize: memorySize });
	}

	schedule(
		_expression: ScheduleExpression,
	): CronBuilder<
		TInput,
		TServices,
		TLogger,
		OutSchema,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, { _schedule: _expression });
	}

	override input<T extends ComposableStandardSchema>(
		schema: T,
	): CronBuilder<
		T,
		TServices,
		TLogger,
		OutSchema,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, {
			inputSchema: schema as unknown as TInput,
		}) as unknown as CronBuilder<
			T,
			TServices,
			TLogger,
			OutSchema,
			TDatabase,
			TDatabaseServiceName
		>;
	}

	override output<T extends StandardSchemaV1>(
		schema: T,
	): CronBuilder<
		TInput,
		TServices,
		TLogger,
		T,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, {
			outputSchema: schema as unknown as OutSchema,
		}) as unknown as CronBuilder<
			TInput,
			TServices,
			TLogger,
			T,
			TDatabase,
			TDatabaseServiceName
		>;
	}

	/**
	 * Depend on constructs — a database, a bucket, a mail sender, a queue, a
	 * topic.
	 *
	 * It records the edge and dissolves each construct's client into the
	 * handler's service record under the construct's own id, so
	 * `.dependsOn([uploads])` is what makes `services.uploads` exist and type.
	 *
	 * Constructs only. A `Service` does not match the shape, which is what keeps
	 * env sniffing confined to `.services()` and the explicit lift.
	 */
	override dependsOn<const T extends readonly Consumable[]>(
		constructs: T,
	): CronBuilder<
		TInput,
		[...TServices, ...ServicesOf<T>],
		TLogger,
		OutSchema,
		TDatabase,
		TDatabaseServiceName
	> {
		// Both halves of the edge, from one call and one clone: the services the
		// handler runs with, and the ids the manifest records. Recording them
		// separately is what let them drift apart.
		//
		// `servicesOf` is the half that validates, so it runs first — recording
		// ids ahead of it left a caught `NotAConstruct` with `undefined` already
		// on a `string[]`.
		const services = servicesOf(constructs) as unknown as Service[];

		return cloneWith(this, {
			_services: uniqBy(
				[...this._services, ...services],
				(s: Service) => s.serviceName,
			),
			_constructs: idsOf(constructs, this._constructs),
		}) as unknown as CronBuilder<
			TInput,
			[...TServices, ...ServicesOf<T>],
			TLogger,
			OutSchema,
			TDatabase,
			TDatabaseServiceName
		>;
	}

	override services<T extends Service[]>(
		services: T,
	): CronBuilder<
		TInput,
		[...TServices, ...T],
		TLogger,
		OutSchema,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, {
			_services: uniqBy(
				[...this._services, ...services],
				(s) => s.serviceName,
			) as TServices,
		}) as unknown as CronBuilder<
			TInput,
			[...TServices, ...T],
			TLogger,
			OutSchema,
			TDatabase,
			TDatabaseServiceName
		>;
	}

	override logger<T extends Logger>(
		logger: T,
	): CronBuilder<
		TInput,
		TServices,
		T,
		OutSchema,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, {
			_logger: logger as unknown as TLogger,
		}) as unknown as CronBuilder<
			TInput,
			TServices,
			T,
			OutSchema,
			TDatabase,
			TDatabaseServiceName
		>;
	}

	/**
	 * Publish `event` to `topic` each time the cron has run successfully —
	 * repeatable, to as many topics as it names. The topic becomes a dependency
	 * as with `.dependsOn([topic])`, so `services.<topic>` is there too.
	 */
	override event<TTopic extends Topic<any, any>>(
		topic: TTopic,
		event: EventFor<TTopic, InferStandardSchema<OutSchema>>,
	): CronBuilder<
		TInput,
		[...TServices, TTopic['service']],
		TLogger,
		OutSchema,
		TDatabase,
		TDatabaseServiceName
	> {
		return this.withEvent(topic, event as never) as unknown as CronBuilder<
			TInput,
			[...TServices, TTopic['service']],
			TLogger,
			OutSchema,
			TDatabase,
			TDatabaseServiceName
		>;
	}

	/**
	 * Set the database service for this cron job.
	 * The database will be available in the handler context as `db`.
	 */
	override database<T, TName extends string>(
		source: Consumable<TName, T> | Service<TName, T>,
	): CronBuilder<TInput, TServices, TLogger, OutSchema, T, TName> {
		const service = serviceOf(source);

		return cloneWith(this, {
			_databaseService: service as unknown as Service<
				TDatabaseServiceName,
				TDatabase
			>,
			// The edge, as `.dependsOn()` records one — see EndpointFactory.
			...(isConsumable(source)
				? { _constructs: idsOf([source], this._constructs) }
				: {}),
		}) as unknown as CronBuilder<
			TInput,
			TServices,
			TLogger,
			OutSchema,
			T,
			TName
		>;
	}

	override handle(
		fn: FunctionHandler<TInput, TServices, TLogger, OutSchema, TDatabase>,
	): Cron<
		TInput,
		TServices,
		TLogger,
		OutSchema,
		TDatabase,
		TDatabaseServiceName
	> {
		const cron = new Cron(
			fn,
			this._timeout,
			this._schedule,
			this.inputSchema,
			this.outputSchema,
			this._services,
			this._logger,
			this._events,
			this._memorySize,
			this._databaseService,
			this._constructs,
		);

		// Which process runs it. Carried from the factory rather than inferred
		// from the directory the file happens to sit in.
		cron.owner = this._owner;

		// And where that process keeps the schedule, when a server is what runs
		// it. Declared once on the worker rather than repeated per cron.
		cron.scheduleStore = this._scheduleStore
			? serviceOf(this._scheduleStore as Consumable<string, unknown>)
			: undefined;

		// No reset. `.handle()` reads this builder and leaves it alone, so a
		// configured base — `const fn = f.logger(log).timeout(60_000)` — keeps
		// its configuration for every construct built from it. The reset that
		// used to be here wiped the base on first use, which made a base usable
		// exactly once, and quietly reverted the logger to the default.

		return cron;
	}
}
