import snakecase from 'lodash.snakecase';

/**
 * Converts a string to environment variable case format (UPPER_SNAKE_CASE).
 * Numbers following underscores are preserved without the underscore.
 *
 * @param name - The string to convert
 * @returns The converted string in environment variable format
 *
 * @example
 * environmentCase('myVariable') // 'MY_VARIABLE'
 * environmentCase('apiV2') // 'APIV2'
 */
export function environmentCase(name: string): string {
  return snakecase(name)
    .toUpperCase()
    .replace(/_\d+/g, (r) => {
      return r.replace('_', '');
    });
}

/**
 * A record of environment variable names to their values.
 * Values can be primitives or nested records.
 */
export interface EnvRecord {
  [key: string]: EnvValue;
}

/**
 * Represents a value that can be stored in an environment record.
 * Can be a primitive value or a nested record of environment values.
 */
export type EnvValue = string | number | boolean | EnvRecord;

/**
 * A resolver function that converts a typed value into environment variables.
 *
 * @template T - The type of value this resolver handles (without the `type` key)
 * @param key - The key name from the input record
 * @param value - The value to resolve (without the `type` key)
 * @returns A record of environment variable names to their values
 */
export type EnvironmentResolver<T = any> = (key: string, value: T) => EnvRecord;

/**
 * A map of type discriminator strings to their resolver functions.
 */
export type Resolvers = Record<string, EnvironmentResolver<any>>;

/**
 * Options for configuring the EnvironmentBuilder.
 */
export interface EnvironmentBuilderOptions {
  /**
   * Handler called when a value's type doesn't match any registered resolver.
   * Defaults to console.warn.
   */
  onUnmatchedValue?: (key: string, value: unknown) => void;
}

/**
 * Input value type - either a string or an object with a `type` discriminator.
 */
export type InputValue = string | { type: string; [key: string]: unknown };

/**
 * Base type for typed input values with a specific type discriminator.
 */
export type TypedInputValue<TType extends string = string> = {
  type: TType;
  [key: string]: unknown;
};

/**
 * Extracts the `type` string value from an input value.
 */
type ExtractType<T> = T extends { type: infer U extends string } ? U : never;

/**
 * Removes the `type` key from an object type.
 */
type OmitType<T> = T extends { type: string } ? Omit<T, 'type'> : never;

/**
 * Extracts all unique `type` values from a record (excluding plain strings).
 */
type AllTypeValues<TRecord extends Record<string, InputValue>> = {
  [K in keyof TRecord]: ExtractType<TRecord[K]>;
}[keyof TRecord];

/**
 * For a given type value, finds the corresponding value type (without `type` key).
 */
type ValueForType<
  TRecord extends Record<string, InputValue>,
  TType extends string,
> = {
  [K in keyof TRecord]: TRecord[K] extends { type: TType }
    ? OmitType<TRecord[K]>
    : never;
}[keyof TRecord];

/**
 * Generates typed resolvers based on the input record.
 * Keys are the `type` values, values are resolver functions receiving the value without `type`.
 */
export type TypedResolvers<TRecord extends Record<string, InputValue>> = {
  [TType in AllTypeValues<TRecord>]: EnvironmentResolver<
    ValueForType<TRecord, TType>
  >;
};

/**
 * A generic, extensible class for building environment variables from
 * objects with type-discriminated values.
 *
 * @template TRecord - The input record type for type inference
 * @template TResolvers - The resolvers type (defaults to TypedResolvers<TRecord>)
 *
 * @example
 * ```typescript
 * const env = new EnvironmentBuilder(
 *   {
 *     apiKey: { type: 'secret', value: 'xyz' },
 *     appName: 'my-app'
 *   },
 *   {
 *     // `value` is typed as { value: string } (without `type`)
 *     secret: (key, value) => ({ [key]: value.value }),
 *   }
 * ).build();
 * // { API_KEY: 'xyz', APP_NAME: 'my-app' }
 * ```
 */
export class EnvironmentBuilder<
  TRecord extends Record<string, InputValue> = Record<string, InputValue>,
  TResolvers extends Resolvers = TypedResolvers<TRecord>,
> {
  private readonly record: TRecord;
  private readonly resolvers: TResolvers;
  private readonly options: Required<EnvironmentBuilderOptions>;

  constructor(
    record: TRecord,
    resolvers: TResolvers,
    options: EnvironmentBuilderOptions = {},
  ) {
    this.record = record;
    this.resolvers = resolvers;
    this.options = {
      onUnmatchedValue:
        options.onUnmatchedValue ??
        ((key, value) => {
          console.warn(`No resolver found for key "${key}":`, { value });
        }),
    };
  }

  /**
   * Build environment variables from the input record.
   *
   * - Plain string values are passed through with key transformation
   * - Object values with a `type` property are matched against resolvers
   * - Only root-level keys are transformed to UPPER_SNAKE_CASE
   *
   * @returns A record of environment variables
   */
  build(): EnvRecord {
    const env: EnvRecord = {};

    for (const [key, value] of Object.entries(this.record)) {
      // Handle plain string values
      if (typeof value === 'string') {
        env[environmentCase(key)] = value;
        continue;
      }

      // Handle objects with type discriminator
      const resolver = this.resolvers[value.type];
      if (resolver) {
        const resolved = resolver(key, value);
        // Transform only root-level keys from resolver output
        for (const [resolvedKey, resolvedValue] of Object.entries(resolved)) {
          env[environmentCase(resolvedKey)] = resolvedValue;
        }
      } else {
        this.options.onUnmatchedValue(key, value);
      }
    }

    return env;
  }
}
