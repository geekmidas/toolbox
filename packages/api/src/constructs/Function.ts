import type { StandardSchemaV1 } from '@standard-schema/spec';
import get from 'lodash.get';
import uniqBy from 'lodash.uniqby';
import { ConsoleLogger, type Logger } from '../logger.ts';
import type { Service, ServiceDiscovery, ServiceRecord } from '../services.ts';

import {
  type ComposableStandardSchema,
  FunctionType,
  type InferComposableStandardSchema,
  type InferStandardSchema,
} from './types.ts';

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
  Fn extends FunctionHandler<
    TInput,
    TServices,
    TLogger,
    OutSchema
  > = FunctionHandler<TInput, TServices, TLogger, OutSchema>,
> {
  __IS_FUNCTION__ = true;

  static isFunction(obj: any): obj is Function<any, any, any, any> {
    return obj && obj.__IS_FUNCTION__ === true;
  }

  constructor(
    protected readonly fn: Fn,
    readonly timeout = 30000, // Default timeout of 30 seconds
    public readonly type = FunctionType.Function,
    public input?: TInput,
    public outputSchema?: OutSchema,
    public services: TServices = [] as Service[] as TServices,
    public logger: TLogger = DEFAULT_LOGGER,
  ) {}
}

export class FunctionBuilder<
  TInput extends ComposableStandardSchema,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
> {
  protected inputSchema?: TInput;
  protected outputSchema?: OutSchema;
  protected _timeout?: number;

  public _services: TServices = [] as Service[] as TServices;
  public _logger: TLogger = DEFAULT_LOGGER;

  static isStandardSchemaV1(s: unknown): s is StandardSchemaV1 {
    const schema = (s as StandardSchemaV1)['~standard'];

    return schema && typeof schema.validate === 'function';
  }

  static async parseComposableStandardSchema<
    T extends ComposableStandardSchema | undefined,
  >(data: unknown, schema: T): Promise<InferComposableStandardSchema<T>> {
    if (FunctionBuilder.isStandardSchemaV1(schema)) {
      const validated = await schema['~standard'].validate(data);

      if (validated.issues) {
        throw validated.issues;
      }

      return validated.value as InferComposableStandardSchema<T>;
    }

    const result: any = {};
    for (const key in schema) {
      const item = schema[key];
      if (FunctionBuilder.isStandardSchemaV1(item)) {
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

  constructor(public type = FunctionType.Function) {}

  services<T extends Service[]>(
    services: T,
  ): FunctionBuilder<TInput, OutSchema, [...TServices, ...T], TLogger> {
    this._services = uniqBy(
      [...this._services, ...services],
      (s) => s.serviceName,
    ) as TServices;
    return this as unknown as FunctionBuilder<
      TInput,
      OutSchema,
      [...TServices, ...T],
      TLogger
    >;
  }

  logger<T extends Logger>(
    logger: T,
  ): FunctionBuilder<TInput, OutSchema, TServices, T> {
    this._logger = logger as unknown as TLogger;

    return this as unknown as FunctionBuilder<TInput, OutSchema, TServices, T>;
  }

  timeout(
    timeout: number,
  ): FunctionBuilder<TInput, OutSchema, TServices, TLogger> {
    this._timeout = timeout;
    return this;
  }

  output<T extends StandardSchemaV1>(
    schema: T,
  ): FunctionBuilder<TInput, T, TServices, TLogger> {
    this.outputSchema = schema as unknown as OutSchema;

    return this as unknown as FunctionBuilder<TInput, T, TServices, TLogger>;
  }

  input<T extends ComposableStandardSchema>(
    schema: T,
  ): FunctionBuilder<T, OutSchema, TServices, TLogger> {
    this.inputSchema = schema as unknown as TInput;

    return this as unknown as FunctionBuilder<T, OutSchema, TServices, TLogger>;
  }
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
  services: ServiceDiscovery<ServiceRecord<TServices>, TLogger>;
  logger: TLogger;
} & Input;
