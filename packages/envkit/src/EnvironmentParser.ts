import get from 'lodash.get';
import set from 'lodash.set';
import { z } from 'zod/v4';

export class ConfigParser<TResponse extends EmptyObject> {
  constructor(private readonly config: TResponse) {}
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
}

export class EnvironmentParser<T extends EmptyObject> {
  constructor(private readonly config: T) {}

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

  private getZodGetter = (name: string) => {
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
   * Creates a new JordConfigParser object that can be used to parse the config object
   *
   * @param builder - A function that takes a getter function and returns a config object
   * @returns A JordConfigParser object that can be used to parse the config object
   */
  create<TReturn extends EmptyObject>(
    builder: (get: EnvFetcher) => TReturn,
  ): ConfigParser<TReturn> {
    const config = builder(this.getZodGetter);
    return new ConfigParser(config);
  }
}

export type InferConfig<T extends EmptyObject> = {
  [K in keyof T]: T[K] extends z.ZodSchema
    ? z.infer<T[K]>
    : T[K] extends Record<string, unknown>
      ? InferConfig<T[K]>
      : T[K];
};

export type EnvFetcher<TPath extends string = string> = (
  name: TPath,
) => typeof z;

export type EnvironmentBuilder<TResponse extends EmptyObject> = (
  get: EnvFetcher,
) => TResponse;

export type EmptyObject = Record<string | number | symbol, unknown>;
