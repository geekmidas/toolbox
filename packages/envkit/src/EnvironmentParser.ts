import get from 'lodash.get';
import set from 'lodash.set';
import { z } from 'zod/v4';

/**
 * Parses and validates configuration objects against Zod schemas.
 * Handles nested configurations and aggregates validation errors.
 *
 * @template TResponse - The shape of the configuration object
 */
export class ConfigParser<TResponse extends EmptyObject> {
  /**
   * Creates a new ConfigParser instance.
   *
   * @param config - The configuration object to parse
   * @param envVars - Set of environment variable names that were accessed
   */
  constructor(
    private readonly config: TResponse,
    private readonly envVars: Set<string> = new Set(),
  ) {}
  /**
   * Parses the config object and validates it against the Zod schemas
   * @returns The parsed config object
   */
  parse(): InferConfig<TResponse> {
    const errors: z.core.$ZodIssue[] = [];

    const parseDeep = <T>(config: T, path: string[] = []) => {
      const result: EmptyObject = {};

      if (config && typeof config !== 'object') {
        return config;
      }

      for (const key in config) {
        const schema = config[key];
        const currentPath = [...path, key];

        if (schema instanceof z.ZodType) {
          const parsed = schema.safeParse(undefined);
          if (parsed.success) {
            set(result, key, parsed.data);
          } else {
            // If the schema is invalid, assign the error
            errors.push(
              ...parsed.error.issues.map((issue) => ({
                ...issue,
                path: [...currentPath, ...(issue.path as string[])],
              })),
            );
          }
        } else if (schema) {
          set(result, key, parseDeep(schema as EmptyObject, currentPath));
        }
      }

      return result;
    };

    const parsedConfig = parseDeep(
      this.config,
    ) as unknown as InferConfig<TResponse>;

    if (errors.length > 0) {
      // If there are errors, throw them
      throw new z.ZodError(errors);
    }

    return parsedConfig;
  }

  /**
   * Returns an array of environment variable names that were accessed during config creation.
   * This is useful for deployment and configuration management to know which env vars are required.
   *
   * @returns Array of environment variable names, sorted alphabetically
   *
   * @example
   * ```typescript
   * const config = envParser.create((get) => ({
   *   dbUrl: get('DATABASE_URL').string(),
   *   port: get('PORT').number()
   * }));
   *
   * config.getEnvironmentVariables(); // ['DATABASE_URL', 'PORT']
   * ```
   */
  getEnvironmentVariables(): string[] {
    return Array.from(this.envVars).sort();
  }
}

/**
 * Parses environment variables with type-safe validation using Zod schemas.
 * Provides a fluent API for defining environment variable schemas with automatic
 * error context enrichment.
 *
 * @template T - The type of the configuration object (typically process.env)
 *
 * @example
 * ```typescript
 * const config = new EnvironmentParser(process.env)
 *   .create((get) => ({
 *     port: get('PORT').string().transform(Number).default(3000),
 *     database: {
 *       url: get('DATABASE_URL').string().url()
 *     }
 *   }))
 *   .parse();
 * ```
 */
export class EnvironmentParser<T extends EmptyObject> {
  /**
   * Set to track which environment variable names have been accessed
   */
  private readonly accessedVars: Set<string> = new Set();

  /**
   * Creates a new EnvironmentParser instance.
   *
   * @param config - The configuration object to parse (typically process.env)
   */
  constructor(private readonly config: T) {}

  /**
   * Wraps a Zod schema to intercept parse/safeParse calls and enrich error messages
   * with environment variable context.
   *
   * @param schema - The Zod schema to wrap
   * @param name - The environment variable name for error context
   * @returns A wrapped Zod schema with enhanced error reporting
   */
  private wrapSchema = (schema: z.ZodType, name: string): z.ZodType => {
    // Create a proxy that intercepts all method calls on the schema
    return new Proxy(schema, {
      get: (target, prop) => {
        if (prop === 'parse') {
          return () => {
            const value = get(this.config, name);
            try {
              return target.parse(value);
            } catch (error) {
              if (error instanceof z.ZodError) {
                // Modify the error to include the environment variable name
                const modifiedIssues = error.issues.map((issue) => ({
                  ...issue,
                  message: `Environment variable "${name}": ${issue.message}`,
                  path: [name, ...issue.path],
                }));
                throw new z.ZodError(modifiedIssues);
              }
              throw error;
            }
          };
        }

        if (prop === 'safeParse') {
          return () => {
            const value = get(this.config, name);
            const result = target.safeParse(value);

            if (!result.success) {
              // Modify the error to include the environment variable name
              const modifiedIssues = result.error.issues.map(
                (issue: z.core.$ZodIssue) => ({
                  ...issue,
                  message: `Environment variable "${name}": ${issue.message}`,
                  path: [name, ...issue.path],
                }),
              );
              return {
                success: false as const,
                error: new z.ZodError(modifiedIssues),
              };
            }

            return result;
          };
        }

        // For any method that returns a new schema (like transform, optional, etc.),
        // wrap the result as well
        const originalProp = target[prop as keyof typeof target];
        if (typeof originalProp === 'function') {
          return (...args: any[]) => {
            const result = originalProp.apply(target, args);
            // If the result is a ZodType, wrap it too
            if (result && typeof result === 'object' && 'parse' in result) {
              return this.wrapSchema(result, name);
            }
            return result;
          };
        }

        return originalProp;
      },
    });
  };

  /**
   * Creates a proxied version of the Zod object that wraps all schema creators
   * to provide enhanced error messages with environment variable context.
   *
   * @param name - The environment variable name
   * @returns A proxied Zod object with wrapped schema creators
   */
  private getZodGetter = (name: string) => {
    // Track that this environment variable was accessed
    this.accessedVars.add(name);

    // Return an object that has all Zod schemas but with our wrapper
    return new Proxy(
      { ...z },
      {
        get: (target, prop) => {
          // deno-lint-ignore ban-ts-comment
          // @ts-ignore
          const value = target[prop];

          if (typeof value === 'function') {
            // Return a wrapper around each Zod schema creator
            return (...args: any[]) => {
              const schema = value(...args);
              return this.wrapSchema(schema, name);
            };
          }

          // Handle objects like z.coerce
          if (value && typeof value === 'object') {
            return new Proxy(value, {
              get: (nestedTarget, nestedProp) => {
                const nestedValue =
                  nestedTarget[nestedProp as keyof typeof nestedTarget];
                if (typeof nestedValue === 'function') {
                  return (...args: any[]) => {
                    const schema = nestedValue(...args);
                    return this.wrapSchema(schema, name);
                  };
                }
                return nestedValue;
              },
            });
          }

          return value;
        },
      },
    );
  };

  /**
   * Creates a new ConfigParser object that can be used to parse the config object
   *
   * @param builder - A function that takes a getter function and returns a config object
   * @returns A ConfigParser object that can be used to parse the config object
   */
  create<TReturn extends EmptyObject>(
    builder: (get: EnvFetcher) => TReturn,
  ): ConfigParser<TReturn> {
    const config = builder(this.getZodGetter);
    return new ConfigParser(config, this.accessedVars);
  }
}

/**
 * Infers the TypeScript type of a configuration object based on its Zod schemas.
 * Recursively processes nested objects and extracts types from Zod schemas.
 *
 * @template T - The configuration object type
 */
export type InferConfig<T extends EmptyObject> = {
  [K in keyof T]: T[K] extends z.ZodSchema
    ? z.infer<T[K]>
    : T[K] extends Record<string, unknown>
      ? InferConfig<T[K]>
      : T[K];
};

/**
 * Function type for fetching environment variables with Zod validation.
 * Returns a Zod object scoped to a specific environment variable.
 *
 * @template TPath - The environment variable path type
 * @param name - The environment variable name
 * @returns A Zod object for defining the schema
 */
export type EnvFetcher<TPath extends string = string> = (
  name: TPath,
) => typeof z;

/**
 * Function type for building environment configuration objects.
 * Takes an EnvFetcher and returns a configuration object with Zod schemas.
 *
 * @template TResponse - The response configuration object type
 * @param get - The environment variable fetcher function
 * @returns The configuration object with Zod schemas
 */
export type EnvironmentBuilder<TResponse extends EmptyObject> = (
  get: EnvFetcher,
) => TResponse;

/**
 * Type alias for a generic object with unknown values.
 * Used as a constraint for configuration objects.
 */
export type EmptyObject = Record<string | number | symbol, unknown>;
