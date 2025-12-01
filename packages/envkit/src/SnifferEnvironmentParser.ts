import { z } from 'zod/v4';
import {
  ConfigParser,
  type EmptyObject,
  type EnvFetcher,
} from './EnvironmentParser';

/**
 * A specialized EnvironmentParser for build-time analysis that tracks
 * which environment variables are accessed without requiring actual values.
 *
 * Unlike the regular EnvironmentParser, the sniffer:
 * - Always returns mock values from .parse() and .safeParse()
 * - Never throws validation errors
 * - Tracks all accessed environment variable names
 *
 * This allows service registration to succeed during build-time analysis
 * even when environment variables are not set.
 *
 * @example
 * ```typescript
 * const sniffer = new SnifferEnvironmentParser();
 * await service.register(sniffer); // Always succeeds
 * const envVars = sniffer.getEnvironmentVariables(); // ['DATABASE_URL', 'API_KEY']
 * ```
 */
export class SnifferEnvironmentParser<
  T extends EmptyObject = EmptyObject,
> {
  private readonly accessedVars: Set<string> = new Set();

  /**
   * Wraps a Zod schema to always return mock values.
   * This ensures .parse() and .safeParse() never fail.
   */
  private wrapSchema = (schema: z.ZodType, name: string): z.ZodType => {
    return new Proxy(schema, {
      get: (target, prop) => {
        if (prop === 'parse') {
          return () => this.getMockValue(target);
        }

        if (prop === 'safeParse') {
          return () => ({
            success: true as const,
            data: this.getMockValue(target),
          });
        }

        const originalProp = target[prop as keyof typeof target];
        if (typeof originalProp === 'function') {
          return (...args: any[]) => {
            const result = originalProp.apply(target, args);
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
   * Returns a mock value based on the Zod schema type.
   */
  private getMockValue(schema: z.ZodType): unknown {
    // Return type-appropriate mock values
    if (schema instanceof z.ZodString) return '';
    if (schema instanceof z.ZodNumber) return 0;
    if (schema instanceof z.ZodBoolean) return false;
    if (schema instanceof z.ZodArray) return [];
    if (schema instanceof z.ZodOptional) return undefined;
    if (schema instanceof z.ZodNullable) return null;

    // For object schemas, build mock object from shape
    if (schema instanceof z.ZodObject && schema.shape) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(schema.shape)) {
        if (value instanceof z.ZodType) {
          result[key] = this.getMockValue(value);
        }
      }
      return result;
    }

    return '';
  }

  /**
   * Creates a proxied Zod getter that tracks environment variable access.
   */
  private getZodGetter = (name: string) => {
    this.accessedVars.add(name);

    return new Proxy(
      { ...z },
      {
        get: (target, prop) => {
          // @ts-ignore
          const value = target[prop];

          if (typeof value === 'function') {
            return (...args: any[]) => {
              const schema = value(...args);
              return this.wrapSchema(schema, name);
            };
          }

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
   * Creates a ConfigParser that will return mock values when parsed.
   */
  create<TReturn extends EmptyObject>(
    builder: (get: EnvFetcher) => TReturn,
  ): ConfigParser<TReturn> {
    const config = builder(this.getZodGetter);
    return new SnifferConfigParser(config, this.accessedVars);
  }

  /**
   * Returns all environment variable names that were accessed.
   */
  getEnvironmentVariables(): string[] {
    return Array.from(this.accessedVars).sort();
  }
}

/**
 * A ConfigParser that always succeeds with mock values.
 */
class SnifferConfigParser<TResponse extends EmptyObject> extends ConfigParser<TResponse> {
  parse(): any {
    return this.parseWithMocks(this.getConfig());
  }

  private getConfig(): TResponse {
    // Access the private config via any cast
    return (this as any).config;
  }

  private parseWithMocks<T>(config: T): any {
    const result: EmptyObject = {};

    if (config && typeof config !== 'object') {
      return config;
    }

    for (const key in config) {
      const schema = config[key];

      if (schema instanceof z.ZodType) {
        // Use safeParse which will return mock values from our wrapped schema
        const parsed = schema.safeParse(undefined);
        result[key] = parsed.success ? parsed.data : this.getDefaultForSchema(schema);
      } else if (schema && typeof schema === 'object') {
        result[key] = this.parseWithMocks(schema as EmptyObject);
      }
    }

    return result;
  }

  private getDefaultForSchema(schema: z.ZodType): unknown {
    if (schema instanceof z.ZodString) return '';
    if (schema instanceof z.ZodNumber) return 0;
    if (schema instanceof z.ZodBoolean) return false;
    if (schema instanceof z.ZodArray) return [];
    if (schema instanceof z.ZodOptional) return undefined;
    if (schema instanceof z.ZodNullable) return null;

    if (schema instanceof z.ZodObject && schema.shape) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(schema.shape)) {
        if (value instanceof z.ZodType) {
          result[key] = this.getDefaultForSchema(value);
        }
      }
      return result;
    }

    return '';
  }
}
