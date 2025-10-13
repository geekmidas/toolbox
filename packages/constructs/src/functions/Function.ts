import type { StandardSchemaV1 } from '@standard-schema/spec';
import uniqBy from 'lodash.uniqby';

import type { Service, ServiceRecord } from '@geekmidas/services';
import { type Construct, ConstructType } from '../Construct';

import type { EventPublisher, MappedEvent } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import { ConsoleLogger } from '@geekmidas/logger/console';
import type {
  ComposableStandardSchema,
  InferComposableStandardSchema,
  InferStandardSchema,
} from '@geekmidas/schema';

import { parseSchema } from '@geekmidas/schema/parser';

const DEFAULT_LOGGER = new ConsoleLogger() as any;

/**
 * Error thrown when validation fails.
 * This is a construct-level error that can be extended by adapters.
 */
export class UnprocessableEntityError extends Error {
  constructor(
    message: string,
    public issues?: any[],
  ) {
    super(message);
    this.name = 'UnprocessableEntityError';
  }
}

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
  Fn extends FunctionHandler<
    TInput,
    TServices,
    TLogger,
    OutSchema
  > = FunctionHandler<TInput, TServices, TLogger, OutSchema>,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
> implements Construct<TLogger, TEventPublisherServiceName, TEventPublisher>
{
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
      throw new UnprocessableEntityError('Validation failed', issues as any[]);
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
    readonly timeout = 30000, // Default timeout of 30 seconds
    public readonly type = ConstructType.Function,
    public input?: TInput,
    public outputSchema?: OutSchema,
    public services: TServices = [] as Service[] as TServices,
    public logger: TLogger = DEFAULT_LOGGER,
    public publisherService?: Service<
      TEventPublisherServiceName,
      TEventPublisher
    >,
    public events: MappedEvent<TEventPublisher, OutSchema>[] = [],
  ) {}
}

export type FunctionHandler<
  TInput extends ComposableStandardSchema | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
> = (
  ctx: FunctionContext<TInput, TServices, TLogger>,
) => OutSchema extends StandardSchemaV1
  ? InferStandardSchema<OutSchema> | Promise<InferStandardSchema<OutSchema>>
  : any | Promise<any>;

export type FunctionContext<
  Input extends ComposableStandardSchema | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
> = {
  services: ServiceRecord<TServices>;
  logger: TLogger;
  input: InferComposableStandardSchema<Input>;
};
