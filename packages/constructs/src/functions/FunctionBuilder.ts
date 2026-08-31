import type { AuditableAction, AuditStorage } from '@geekmidas/audit';
import type { EventPublisher } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type { ComposableStandardSchema } from '@geekmidas/schema';
import type { Service } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import uniqBy from 'lodash.uniqby';
import { ConstructType } from '../Construct';
import { cloneWith } from '../clone';
import {
	type Consumable,
	idsOf,
	type ServicesOf,
	serviceOf,
	servicesOf,
} from '../construct-interface';
import { BaseFunctionBuilder } from './BaseFunctionBuilder';
import { Function, type FunctionHandler } from './Function';

export class FunctionBuilder<
	TInput extends ComposableStandardSchema,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	TEventPublisher extends EventPublisher<any> | undefined = undefined,
	TEventPublisherServiceName extends string = string,
	TAuditStorage extends AuditStorage | undefined = undefined,
	TAuditStorageServiceName extends string = string,
	TDatabase = undefined,
	TDatabaseServiceName extends string = string,
	TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
		string,
		unknown
	>,
> extends BaseFunctionBuilder<
	TInput,
	OutSchema,
	TServices,
	TLogger,
	TEventPublisher,
	TEventPublisherServiceName,
	TAuditStorage,
	TAuditStorageServiceName,
	TDatabase,
	TDatabaseServiceName
> {
	protected _memorySize?: number;

	constructor(public override type = ConstructType.Function) {
		super(type);
	}

	override timeout(timeout: number): this {
		return cloneWith(this, { _timeout: timeout });
	}

	memorySize(memorySize: number): this {
		return cloneWith(this, { _memorySize: memorySize });
	}

	output<T extends StandardSchemaV1>(
		schema: T,
	): FunctionBuilder<
		TInput,
		T,
		TServices,
		TLogger,
		TEventPublisher,
		TEventPublisherServiceName,
		TAuditStorage,
		TAuditStorageServiceName,
		TDatabase,
		TDatabaseServiceName,
		TAuditAction
	> {
		return cloneWith(this, {
			outputSchema: schema as unknown as OutSchema,
		}) as unknown as FunctionBuilder<
			TInput,
			T,
			TServices,
			TLogger,
			TEventPublisher,
			TEventPublisherServiceName,
			TAuditStorage,
			TAuditStorageServiceName,
			TDatabase,
			TDatabaseServiceName,
			TAuditAction
		>;
	}

	input<T extends ComposableStandardSchema>(
		schema: T,
	): FunctionBuilder<
		T,
		OutSchema,
		TServices,
		TLogger,
		TEventPublisher,
		TEventPublisherServiceName,
		TAuditStorage,
		TAuditStorageServiceName,
		TDatabase,
		TDatabaseServiceName,
		TAuditAction
	> {
		return cloneWith(this, {
			inputSchema: schema as unknown as TInput,
		}) as unknown as FunctionBuilder<
			T,
			OutSchema,
			TServices,
			TLogger,
			TEventPublisher,
			TEventPublisherServiceName,
			TAuditStorage,
			TAuditStorageServiceName,
			TDatabase,
			TDatabaseServiceName,
			TAuditAction
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
	dependsOn<const T extends readonly Consumable[]>(
		constructs: T,
	): FunctionBuilder<
		TInput,
		OutSchema,
		[...TServices, ...ServicesOf<T>],
		TLogger,
		TEventPublisher,
		TEventPublisherServiceName,
		TAuditStorage,
		TAuditStorageServiceName,
		TDatabase,
		TDatabaseServiceName,
		TAuditAction
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
		}) as unknown as FunctionBuilder<
			TInput,
			OutSchema,
			[...TServices, ...ServicesOf<T>],
			TLogger,
			TEventPublisher,
			TEventPublisherServiceName,
			TAuditStorage,
			TAuditStorageServiceName,
			TDatabase,
			TDatabaseServiceName,
			TAuditAction
		>;
	}

	services<T extends Service[]>(
		services: T,
	): FunctionBuilder<
		TInput,
		OutSchema,
		[...TServices, ...T],
		TLogger,
		TEventPublisher,
		TEventPublisherServiceName,
		TAuditStorage,
		TAuditStorageServiceName,
		TDatabase,
		TDatabaseServiceName,
		TAuditAction
	> {
		return cloneWith(this, {
			_services: uniqBy(
				[...this._services, ...services],
				(s) => s.serviceName,
			) as TServices,
		}) as unknown as FunctionBuilder<
			TInput,
			OutSchema,
			[...TServices, ...T],
			TLogger,
			TEventPublisher,
			TEventPublisherServiceName,
			TAuditStorage,
			TAuditStorageServiceName,
			TDatabase,
			TDatabaseServiceName,
			TAuditAction
		>;
	}

	logger<T extends Logger>(
		logger: T,
	): FunctionBuilder<
		TInput,
		OutSchema,
		TServices,
		T,
		TEventPublisher,
		TEventPublisherServiceName,
		TAuditStorage,
		TAuditStorageServiceName,
		TDatabase,
		TDatabaseServiceName,
		TAuditAction
	> {
		return cloneWith(this, {
			_logger: logger as unknown as TLogger,
		}) as unknown as FunctionBuilder<
			TInput,
			OutSchema,
			TServices,
			T,
			TEventPublisher,
			TEventPublisherServiceName,
			TAuditStorage,
			TAuditStorageServiceName,
			TDatabase,
			TDatabaseServiceName,
			TAuditAction
		>;
	}

	override publisher<T extends EventPublisher<any>, TName extends string>(
		publisher: Service<TName, T>,
	): FunctionBuilder<
		TInput,
		OutSchema,
		TServices,
		TLogger,
		T,
		TName,
		TAuditStorage,
		TAuditStorageServiceName,
		TDatabase,
		TDatabaseServiceName,
		TAuditAction
	> {
		return cloneWith(this, {
			_publisher: publisher as unknown as Service<
				TEventPublisherServiceName,
				TEventPublisher
			>,
		}) as unknown as FunctionBuilder<
			TInput,
			OutSchema,
			TServices,
			TLogger,
			T,
			TName,
			TAuditStorage,
			TAuditStorageServiceName,
			TDatabase,
			TDatabaseServiceName,
			TAuditAction
		>;
	}

	override auditor<T extends AuditStorage, TName extends string>(
		storage: Service<TName, T>,
	): FunctionBuilder<
		TInput,
		OutSchema,
		TServices,
		TLogger,
		TEventPublisher,
		TEventPublisherServiceName,
		T,
		TName,
		TDatabase,
		TDatabaseServiceName,
		TAuditAction
	> {
		return cloneWith(this, {
			_auditorStorage: storage as unknown as Service<
				TAuditStorageServiceName,
				TAuditStorage
			>,
		}) as unknown as FunctionBuilder<
			TInput,
			OutSchema,
			TServices,
			TLogger,
			TEventPublisher,
			TEventPublisherServiceName,
			T,
			TName,
			TDatabase,
			TDatabaseServiceName,
			TAuditAction
		>;
	}

	/**
	 * Set the audit action types for this function.
	 * This provides type-safety for the auditor in the handler context.
	 */
	actions<T extends AuditableAction<string, unknown>>(): FunctionBuilder<
		TInput,
		OutSchema,
		TServices,
		TLogger,
		TEventPublisher,
		TEventPublisherServiceName,
		TAuditStorage,
		TAuditStorageServiceName,
		TDatabase,
		TDatabaseServiceName,
		T
	> {
		return this as unknown as FunctionBuilder<
			TInput,
			OutSchema,
			TServices,
			TLogger,
			TEventPublisher,
			TEventPublisherServiceName,
			TAuditStorage,
			TAuditStorageServiceName,
			TDatabase,
			TDatabaseServiceName,
			T
		>;
	}

	/**
	 * Set the database service for this function.
	 * The database will be available in the handler context as `db`.
	 */
	override database<T, TName extends string>(
		source: Consumable<TName, T> | Service<TName, T>,
	): FunctionBuilder<
		TInput,
		OutSchema,
		TServices,
		TLogger,
		TEventPublisher,
		TEventPublisherServiceName,
		TAuditStorage,
		TAuditStorageServiceName,
		T,
		TName,
		TAuditAction
	> {
		const service = serviceOf(source);

		return cloneWith(this, {
			_databaseService: service as unknown as Service<
				TDatabaseServiceName,
				TDatabase
			>,
		}) as unknown as FunctionBuilder<
			TInput,
			OutSchema,
			TServices,
			TLogger,
			TEventPublisher,
			TEventPublisherServiceName,
			TAuditStorage,
			TAuditStorageServiceName,
			T,
			TName,
			TAuditAction
		>;
	}

	handle(
		fn: FunctionHandler<
			TInput,
			TServices,
			TLogger,
			OutSchema,
			TDatabase,
			TAuditStorage,
			TAuditAction
		>,
	): Function<
		TInput,
		TServices,
		TLogger,
		OutSchema,
		TEventPublisher,
		TEventPublisherServiceName,
		TAuditStorage,
		TAuditStorageServiceName,
		TDatabase,
		TDatabaseServiceName,
		TAuditAction,
		FunctionHandler<
			TInput,
			TServices,
			TLogger,
			OutSchema,
			TDatabase,
			TAuditStorage,
			TAuditAction
		>
	> {
		const func = new Function(
			fn,
			this._timeout,
			this.type,
			this.inputSchema,
			this.outputSchema,
			this._services,
			this._logger,
			this._publisher,
			this._events,
			this._memorySize,
			this._auditorStorage,
			this._databaseService,
			this._constructs,
		);

		// No reset. `.handle()` reads this builder and leaves it alone, so a
		// configured base — `const fn = f.logger(log).timeout(60_000)` — keeps
		// its configuration for every construct built from it. The reset that
		// used to be here wiped the base on first use, which made a base usable
		// exactly once, and quietly reverted the logger to the default.

		return func;
	}
}
