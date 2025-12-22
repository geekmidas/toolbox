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
 * @template T - The type of value this resolver handles
 * @param key - The key name from the input record
 * @param value - The value to resolve
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
 * A generic, extensible class for building environment variables from
 * objects with type-discriminated values.
 *
 * @template TResolvers - The resolvers map type for type inference
 *
 * @example
 * ```typescript
 * const env = new EnvironmentBuilder(
 *   {
 *     apiKey: { type: 'secret', value: 'xyz' },
 *     appName: 'my-app'
 *   },
 *   {
 *     secret: (key, value) => ({ [key]: value.value }),
 *   }
 * ).build();
 * // { API_KEY: 'xyz', APP_NAME: 'my-app' }
 * ```
 */
export class EnvironmentBuilder<TResolvers extends Resolvers = Resolvers> {
  private readonly record: Record<string, InputValue>;
  private readonly resolvers: TResolvers;
  private readonly options: Required<EnvironmentBuilderOptions>;

  constructor(
    record: Record<string, InputValue>,
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
