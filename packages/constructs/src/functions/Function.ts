import type { AuditableAction, Auditor, AuditStorage } from '@geekmidas/audit';
import { UnprocessableEntityError } from '@geekmidas/errors';
import type { EventPublisher, MappedEvent } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import { ConsoleLogger } from '@geekmidas/logger/console';
import type {
  ComposableStandardSchema,
  InferComposableStandardSchema,
  InferStandardSchema,
} from '@geekmidas/schema';
import { parseSchema } from '@geekmidas/schema/parser';
import type { Service, ServiceRecord } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import uniqBy from 'lodash.uniqby';
import { Construct, ConstructType } from '../Construct';

const DEFAULT_LOGGER = new ConsoleLogger() as any;

export class FunctionFactory<
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
> {
  private defaultServices: TServices;
  constructor(
    defaultServices: TServices,
    private defaultLogger: TLogger = DEFAULT_LOGGER,
  ) {
    // Initialize default services
    this.defaultServices = uniqBy(
      defaultServices,
      (s) => s.serviceName,
    ) as TServices;
  }

  // Create a new factory with services
  services<S extends Service[]>(
    services: S,
  ): FunctionFactory<[...S, ...TServices], TLogger> {
    return new FunctionFactory<[...S, ...TServices], TLogger>(
      [...services, ...this.defaultServices],
      this.defaultLogger,
    );
  }

  logger<L extends Logger>(logger: L): FunctionFactory<TServices, L> {
    return new FunctionFactory<TServices, L>(this.defaultServices, logger);
  }
}

export class Function<
  TInput extends ComposableStandardSchema | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
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
  Fn extends FunctionHandler<
    TInput,
    TServices,
    TLogger,
    OutSchema,
    TDatabase,
    TAuditStorage,
    TAuditAction
  > = FunctionHandler<
    TInput,
    TServices,
    TLogger,
    OutSchema,
    TDatabase,
    TAuditStorage,
    TAuditAction
  >,
> extends Construct<
  TLogger,
  TEventPublisherServiceName,
  TEventPublisher,
  OutSchema,
  TServices,
  TAuditStorageServiceName,
  TAuditStorage
> {
  __IS_FUNCTION__ = true;

  static isFunction(obj: any): obj is Function<any, any, any, any, any> {
    return Boolean(
      obj &&
        obj.__IS_FUNCTION__ === true &&
        obj.type === ConstructType.Function,
    );
  }

  /**
   * Validates data against a StandardSchema.
   *
   * @param schema - The StandardSchema to validate against
   * @param data - The data to validate
   * @returns Validation result with value or issues
   */
  static validate<T extends StandardSchemaV1>(schema: T, data: unknown) {
    return schema['~standard'].validate(data);
  }

  /**
   * Parses and validates data against a schema, throwing an error if validation fails.
   *
   * @param schema - The StandardSchema to validate against
   * @param data - The data to parse and validate
   * @returns The validated data with proper typing
   * @throws {UnprocessableEntityError} When validation fails
   */
  static async parseSchema<T extends StandardSchemaV1>(
    schema: T,
    data: unknown,
  ): Promise<InferStandardSchema<T>> {
    try {
      return await parseSchema(schema, data);
    } catch (issues) {
      throw new UnprocessableEntityError('Validation failed', issues);
    }
  }

  /**
   * Parses and validates the endpoint output against the output schema.
   *
   * @param output - The raw output data to validate
   * @returns The validated output data
   * @throws {UnprocessableEntityError} When output validation fails
   */
  async parseOutput(output: unknown): Promise<InferStandardSchema<OutSchema>> {
    return Function.parseSchema(
      this.outputSchema as StandardSchemaV1,
      output,
    ) as Promise<InferStandardSchema<OutSchema>>;
  }

  constructor(
    protected readonly fn: Fn,
    timeout = 30000, // Default timeout of 30 seconds
    type: ConstructType = ConstructType.Function,
    public input?: TInput,
    outputSchema?: OutSchema,
    services: TServices = [] as unknown as TServices,
    logger: TLogger = DEFAULT_LOGGER,
    publisherService?: Service<TEventPublisherServiceName, TEventPublisher>,
    events: MappedEvent<TEventPublisher, OutSchema>[] = [],
    memorySize?: number,
    auditorStorageService?: Service<TAuditStorageServiceName, TAuditStorage>,
    public databaseService?: Service<TDatabaseServiceName, TDatabase>,
  ) {
    super(
      type,
      logger,
      services,
      events,
      publisherService,
      outputSchema,
      timeout,
      memorySize,
      auditorStorageService,
    );
  }
}

export type FunctionHandler<
  TInput extends ComposableStandardSchema | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TDatabase = undefined,
  TAuditStorage extends AuditStorage | undefined = undefined,
  TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
    string,
    unknown
  >,
> = (
  ctx: FunctionContext<
    TInput,
    TServices,
    TLogger,
    TDatabase,
    TAuditStorage,
    TAuditAction
  >,
) => OutSchema extends StandardSchemaV1
  ? InferStandardSchema<OutSchema> | Promise<InferStandardSchema<OutSchema>>
  : any | Promise<any>;

/**
 * Conditional type that adds `db` property only when TDatabase is configured.
 */
type DatabaseContext<TDatabase> = TDatabase extends undefined
  ? {}
  : { db: TDatabase };

/**
 * Conditional auditor context - only present when audit storage is configured.
 */
type AuditorContext<
  TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
    string,
    unknown
  >,
  TAuditStorage = undefined,
> = TAuditStorage extends undefined
  ? {}
  : {
      /**
       * Auditor instance for recording audit events.
       * Only present when audit storage is configured on the function.
       */
      auditor: Auditor<TAuditAction>;
    };

export type FunctionContext<
  Input extends ComposableStandardSchema | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TDatabase = undefined,
  TAuditStorage extends AuditStorage | undefined = undefined,
  TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
    string,
    unknown
  >,
> = {
  services: ServiceRecord<TServices>;
  logger: TLogger;
  input: InferComposableStandardSchema<Input>;
} & DatabaseContext<TDatabase> &
  AuditorContext<TAuditAction, TAuditStorage>;
