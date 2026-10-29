import type { EventPublisher } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type { ComposableStandardSchema } from '@geekmidas/schema';
import type { Service } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import uniqBy from 'lodash.uniqby';
import { ConstructType } from '../Construct';
import { cloneWith } from '../clone';
import { FunctionBuilder, type FunctionHandler } from '../functions';
import type { MonitorService } from '../monitor';
import { Cron, type CronExpression, type ScheduleExpression } from './Cron';

export class CronBuilder<
	TInput extends ComposableStandardSchema,
	TServices extends Service[],
	TLogger extends Logger = Logger,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	TEventPublisher extends EventPublisher<any> | undefined = undefined,
	TEventPublisherServiceName extends string = string,
	TDatabase = undefined,
	TDatabaseServiceName extends string = string,
> extends FunctionBuilder<
	TInput,
	OutSchema,
	TServices,
	TLogger,
	TEventPublisher,
	TEventPublisherServiceName,
	undefined,
	string,
	TDatabase,
	TDatabaseServiceName
> {
	private _schedule?: ScheduleExpression;
	private _uptime?: MonitorService;

	constructor() {
		super(ConstructType.Cron);
	}

	override memorySize(memorySize: number): this {
		return cloneWith(this, { _memorySize: memorySize });
	}

	/**
	 * When the cron runs: a five-field Unix `cron(…)` or a six-field AWS one.
	 * `gkm build` writes it to the manifest in the AWS form.
	 */
	schedule<const T extends string>(
		_expression: CronExpression<T>,
	): CronBuilder<
		TInput,
		TServices,
		TLogger,
		OutSchema,
		TEventPublisher,
		TEventPublisherServiceName,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, {
			_schedule: _expression as ScheduleExpression,
		});
	}

	/**
	 * Report each run to an uptime monitor, so a cron that stops running is
	 * noticed: `heartbeat.betterStack()` pings on success and reports a
	 * failure. Calling it again replaces the monitor.
	 *
	 * `gkm build` records it in the manifest with the schedule's period, the
	 * longest gap between runs, so infrastructure can create the heartbeat.
	 */
	uptime(monitor: MonitorService): this {
		return cloneWith(this, { _uptime: monitor });
	}

	override input<T extends ComposableStandardSchema>(
		schema: T,
	): CronBuilder<
		T,
		TServices,
		TLogger,
		OutSchema,
		TEventPublisher,
		TEventPublisherServiceName,
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
			TEventPublisher,
			TEventPublisherServiceName,
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
		TEventPublisher,
		TEventPublisherServiceName,
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
			TEventPublisher,
			TEventPublisherServiceName,
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
		TEventPublisher,
		TEventPublisherServiceName,
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
			TEventPublisher,
			TEventPublisherServiceName,
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
		TEventPublisher,
		TEventPublisherServiceName,
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
			TEventPublisher,
			TEventPublisherServiceName,
			TDatabase,
			TDatabaseServiceName
		>;
	}

	override publisher<T extends EventPublisher<any>, TName extends string>(
		publisher: Service<TName, T>,
	): CronBuilder<
		TInput,
		TServices,
		TLogger,
		OutSchema,
		T,
		TName,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, {
			_publisher: publisher as unknown as Service<
				TEventPublisherServiceName,
				TEventPublisher
			>,
		}) as unknown as CronBuilder<
			TInput,
			TServices,
			TLogger,
			OutSchema,
			T,
			TName,
			TDatabase,
			TDatabaseServiceName
		>;
	}

	/**
	 * Set the database service for this cron job.
	 * The database will be available in the handler context as `db`.
	 */
	override database<T, TName extends string>(
		service: Service<TName, T>,
	): CronBuilder<
		TInput,
		TServices,
		TLogger,
		OutSchema,
		TEventPublisher,
		TEventPublisherServiceName,
		T,
		TName
	> {
		return cloneWith(this, {
			_databaseService: service as unknown as Service<
				TDatabaseServiceName,
				TDatabase
			>,
		}) as unknown as CronBuilder<
			TInput,
			TServices,
			TLogger,
			OutSchema,
			TEventPublisher,
			TEventPublisherServiceName,
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
		TEventPublisher,
		TEventPublisherServiceName,
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
			this._publisher,
			this._events,
			this._memorySize,
			this._databaseService,
		);

		// No reset. `.handle()` reads this builder and leaves it alone, so a
		// configured base keeps its configuration for every construct built
		// from it. The reset that used to be here wiped the base on first use.

		cron.monitors = this._uptime ? [this._uptime] : [];

		return cron;
	}
}
