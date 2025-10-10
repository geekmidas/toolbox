import type { StandardSchemaV1 } from '@standard-schema/spec';
import get from 'lodash.get';
import { ConsoleLogger, type Logger } from '../logger';
import type { Service } from '../services';
import { ConstructType } from './Construct';
import type { EventPublisher, MappedEvent } from './events';
import type {
  ComposableStandardSchema,
  InferComposableStandardSchema,
} from './types';

const DEFAULT_LOGGER = new ConsoleLogger() as any;

export abstract class BaseFunctionBuilder<
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
    if (BaseFunctionBuilder.isStandardSchemaV1(schema)) {
      const validated = await schema['~standard'].validate(data);

      if (validated.issues) {
        throw validated.issues;
      }

      return validated.value as InferComposableStandardSchema<T>;
    }

    const result: any = {};
    for (const key in schema) {
      const item = schema[key];
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
    this._timeout = timeout;
    return this;
  }

  abstract output<T extends StandardSchemaV1>(schema: T): any;

  abstract input<T extends ComposableStandardSchema>(schema: T): any;

  event<TEvent extends MappedEvent<TEventPublisher, OutSchema>>(
    event: TEvent,
  ): this {
    this._events.push(event);
    return this;
  }

  publisher<T extends EventPublisher<any>, TName extends string>(
    publisher: Service<TName, T>,
  ): BaseFunctionBuilder<TInput, OutSchema, TServices, TLogger, T, TName> {
    this._publisher = publisher as unknown as Service<
      TEventPublisherServiceName,
      TEventPublisher
    >;

    return this as unknown as BaseFunctionBuilder<
      TInput,
      OutSchema,
      TServices,
      TLogger,
      T,
      TName
    >;
  }
}
