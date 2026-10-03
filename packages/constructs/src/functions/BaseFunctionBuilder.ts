import type { AuditStorage } from '@geekmidas/audit';
import type { Logger } from '@geekmidas/logger';
import { DEFAULT_LOGGER } from '@geekmidas/logger/console';
import type {
	ComposableStandardSchema,
	InferComposableStandardSchema,
} from '@geekmidas/schema';
import type { Service } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import get from 'lodash.get';
import uniqBy from 'lodash.uniqby';
import { ConstructType } from '../Construct';
import { cloneWith } from '../clone';
import {
	type Consumable,
	databaseEdges,
	idsOf,
	serviceOf,
} from '../construct-interface';
import { type EventFor, type TopicEvent, topicEvent } from '../publisher';
import type { Topic } from '../topic/Topic';

export abstract class BaseFunctionBuilder<
	TInput extends ComposableStandardSchema,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	TAuditStorage extends AuditStorage | undefined = undefined,
	TAuditStorageServiceName extends string = string,
	TDatabase = undefined,
	TDatabaseServiceName extends string = string,
> {
	protected inputSchema?: TInput;
	protected outputSchema?: OutSchema;
	protected _timeout?: number;

	public _services: TServices = [] as Service[] as TServices;
	/**
	 * The construct ids `.dependsOn()` was given.
	 *
	 * Beside the services rather than instead of them: a handler *runs* with
	 * clients and the manifest *records* which constructs it reaches, and
	 * dissolving one into the other is what lost the edges. Shared by every
	 * builder because every one of them can depend on something.
	 */
	public _constructs: string[] = [];
	public _logger: TLogger = DEFAULT_LOGGER;

	/**
	 * The deploy unit everything built from this builder belongs to.
	 *
	 * Seeded by the factory a `Worker` or `RestApi` hands out, so a cron knows
	 * which process runs it without a directory having to imply it.
	 */
	public _owner?: string;

	/**
	 * Where a cron built from this factory keeps its schedule.
	 *
	 * Set by the worker that handed the factory out, the same way the logger
	 * and the owner are — so a cron file names a schedule and nothing else.
	 * Only a server target reads it; on AWS the schedule is an EventBridge rule.
	 */
	public _scheduleStore?: unknown;

	/** What the built construct publishes, each event bound to its topic. */
	public _events: TopicEvent[] = [];
	protected _auditorStorage?: Service<TAuditStorageServiceName, TAuditStorage>;
	protected _databaseService?: Service<TDatabaseServiceName, TDatabase>;
	/** The edge `.database()` added, so the next one can replace it. */
	protected _databaseEdge?: string;

	static isStandardSchemaV1(s: unknown): s is StandardSchemaV1 {
		const schema = (s as StandardSchemaV1)['~standard'];

		return schema && typeof schema.validate === 'function';
	}

	static async parseComposableStandardSchema<
		T extends ComposableStandardSchema | undefined,
	>(data: unknown, schema: T): Promise<InferComposableStandardSchema<T>> {
		if (BaseFunctionBuilder.isStandardSchemaV1(schema)) {
			const validated = await schema['~standard'].validate(data);

			if (validated.issues) {
				throw validated.issues;
			}

			return validated.value as InferComposableStandardSchema<T>;
		}

		const result: any = {};
		// The record form, once the single-schema case above has returned. A
		// `for..in` key types as a key of `NonNullable<T>`, which does not index
		// the constraint itself — and every value is re-checked by
		// `isStandardSchemaV1` on the next line regardless.
		const fields = schema as Record<string, unknown>;
		for (const key in fields) {
			const item = fields[key];
			if (BaseFunctionBuilder.isStandardSchemaV1(item)) {
				const value = get(data, key);
				const validated = await item['~standard'].validate(value);

				if (validated.issues) {
					throw validated.issues;
				}

				result[key] = validated.value;
			}
		}

		return result as InferComposableStandardSchema<T>;
	}

	constructor(public type = ConstructType.Function) {}

	abstract services<T extends Service[]>(services: T): any;

	abstract logger<T extends Logger>(logger: T): any;

	timeout(timeout: number): this {
		return cloneWith(this, { _timeout: timeout });
	}

	abstract output<T extends StandardSchemaV1>(schema: T): any;

	abstract input<T extends ComposableStandardSchema>(schema: T): any;

	/**
	 * A clone that publishes `event` to `topic` once the handler succeeds, and
	 * has the topic as a dependency the way `.dependsOn([topic])` would: in
	 * `services`, and an edge in the manifest. Each builder types it as its own
	 * `event()`, since only it knows how its services widen.
	 */
	protected withEvent(
		topic: Topic<any, any>,
		event: EventFor<Topic<any, any>, any>,
	): this {
		return cloneWith(this, {
			// Replaced rather than pushed: a clone shares whatever array the field
			// points at, so an in-place push would be seen by the base it came from.
			_events: [...this._events, topicEvent(topic, event)],
			_services: uniqBy(
				[...this._services, topic.service],
				(s: Service) => s.serviceName,
			) as unknown as TServices,
			_constructs: idsOf([topic as unknown as Consumable], this._constructs),
		});
	}

	auditor<T extends AuditStorage, TName extends string>(
		storage: Service<TName, T>,
	): BaseFunctionBuilder<
		TInput,
		OutSchema,
		TServices,
		TLogger,
		T,
		TName,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, {
			_auditorStorage: storage as unknown as Service<
				TAuditStorageServiceName,
				TAuditStorage
			>,
		}) as unknown as BaseFunctionBuilder<
			TInput,
			OutSchema,
			TServices,
			TLogger,
			T,
			TName,
			TDatabase,
			TDatabaseServiceName
		>;
	}

	/**
	 * Set the database service for this function.
	 * The database will be available in the handler context as `db`.
	 */
	database<T, TName extends string>(
		source: Consumable<TName, T> | Service<TName, T>,
	): BaseFunctionBuilder<
		TInput,
		OutSchema,
		TServices,
		TLogger,
		TAuditStorage,
		TAuditStorageServiceName,
		T,
		TName
	> {
		const service = serviceOf(source);

		return cloneWith(this, {
			_databaseService: service as unknown as Service<
				TDatabaseServiceName,
				TDatabase
			>,
			// The edge, as `.dependsOn()` records one — see EndpointFactory —
			// in place of the one a previous `.database()` added, which is how a
			// worker's default database is overridden rather than added to.
			...databaseEdges(
				{
					constructs: this._constructs,
					edge: this._databaseEdge,
					service: this._databaseService as Service | undefined,
					services: this._services,
				},
				source,
			),
		}) as unknown as BaseFunctionBuilder<
			TInput,
			OutSchema,
			TServices,
			TLogger,
			TAuditStorage,
			TAuditStorageServiceName,
			T,
			TName
		>;
	}
}
