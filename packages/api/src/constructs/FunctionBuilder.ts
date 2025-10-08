import type { StandardSchemaV1 } from '@standard-schema/spec';
import get from 'lodash.get';
import uniqBy from 'lodash.uniqby';
import { ConsoleLogger, type Logger } from '../logger';
import type { Service } from '../services';
import { ConstructType } from './Construct';
import { Function, type FunctionHandler } from './Function';
import type { EventPublisher, MappedEvent } from './events';
import type {
  ComposableStandardSchema,
  InferComposableStandardSchema,
} from './types';

const DEFAULT_LOGGER = new ConsoleLogger() as any;

export class FunctionBuilder<
  TInput extends ComposableStandardSchema,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
> {
  protected inputSchema?: TInput;
  protected outputSchema?: OutSchema;
  protected _timeout?: number;

  public _services: TServices = [] as Service[] as TServices;
  public _logger: TLogger = DEFAULT_LOGGER;

  protected _events: MappedEvent<TEventPublisher, OutSchema>[] = [];
  protected _publisher?: Service<TEventPublisherServiceName, TEventPublisher>;

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

  constructor(public type = ConstructType.Function) {}

  services<T extends Service[]>(
    services: T,
  ): Omit<this, '_services'> & { _services: [...TServices, ...T] } {
    this._services = uniqBy(
      [...this._services, ...services],
      (s) => s.serviceName,
    ) as TServices;

    return this as unknown as Omit<this, '_services'> & {
      _services: [...TServices, ...T];
    };
  }

  logger<T extends Logger>(logger: T): Omit<this, '_logger'> & { _logger: T } {
    this._logger = logger as unknown as TLogger;

    return this as unknown as Omit<this, '_logger'> & { _logger: T };
  }

  timeout(timeout: number): this {
    this._timeout = timeout;
    return this;
  }

  output<T extends StandardSchemaV1>(
    schema: T,
  ): Omit<this, 'outputSchema'> & { outputSchema: T } {
    this.outputSchema = schema as unknown as OutSchema;

    return this as unknown as Omit<this, 'outputSchema'> & { outputSchema: T };
  }

  input<T extends ComposableStandardSchema>(
    schema: T,
  ): Omit<this, 'inputSchema'> & { inputSchema: T } {
    this.inputSchema = schema as unknown as TInput;

    return this as unknown as Omit<this, 'inputSchema'> & { inputSchema: T };
  }

  event<TEvent extends MappedEvent<TEventPublisher, OutSchema>>(
    event: TEvent,
  ): this {
    this._events.push(event);
    return this;
  }

  publisher<T extends EventPublisher<any>, TName extends string>(
    publisher: Service<TName, T>,
  ): Omit<this, '_publisher'> & { _publisher: Service<TName, T> } {
    this._publisher = publisher as unknown as Service<
      TEventPublisherServiceName,
      TEventPublisher
    >;

    return this as unknown as Omit<this, '_publisher'> & {
      _publisher: Service<TName, T>;
    };
  }

  handle(
    fn: FunctionHandler<TInput, TServices, TLogger, OutSchema>,
  ): Function<
    TInput,
    TServices,
    TLogger,
    OutSchema,
    FunctionHandler<TInput, TServices, TLogger, OutSchema>,
    TEventPublisher,
    TEventPublisherServiceName
  > {
    return new Function(
      fn,
      this._timeout,
      ConstructType.Endpoint,
      this.inputSchema,
      this.outputSchema,
      this._services,
      this._logger,
      this._publisher,
      this._events,
    );
  }
}
