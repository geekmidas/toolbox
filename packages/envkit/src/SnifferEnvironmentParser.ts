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
export class SnifferEnvironmentParser<_T extends EmptyObject = EmptyObject> {
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
					// @ts-expect-error
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
class SnifferConfigParser<
	TResponse extends EmptyObject,
> extends ConfigParser<TResponse> {
	override parse(): any {
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
				result[key] = parsed.success
					? parsed.data
					: this.getDefaultForSchema(schema);
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

/**
 * Result of sniffing with fire-and-forget handling.
 */
export interface SniffResult {
	/** Environment variables that were accessed during sniffing */
	envVars: string[];
	/** Error thrown during sniffing (env vars may still be captured) */
	error?: Error;
	/** Unhandled promise rejections captured during sniffing */
	unhandledRejections: Error[];
}

/**
 * Options for sniffing with fire-and-forget handling.
 */
export interface SniffOptions {
	/**
	 * Time in milliseconds to wait for fire-and-forget promises to settle.
	 * Some libraries like better-auth create async operations that may reject
	 * after the initial event loop tick.
	 * @default 100
	 */
	settleTimeMs?: number;
}

/**
 * Executes a sniffing operation with fire-and-forget handling.
 *
 * This function:
 * 1. Captures unhandled promise rejections during the operation
 * 2. Waits for async operations to settle before returning
 * 3. Gracefully handles errors without throwing
 *
 * Use this when sniffing environment variables from code that may:
 * - Throw synchronous errors
 * - Create fire-and-forget promises that reject
 * - Have async initialization that may fail
 *
 * @param sniffer - The SnifferEnvironmentParser instance to use
 * @param operation - The async operation to execute (e.g., service.register)
 * @param options - Optional configuration
 * @returns SniffResult with env vars and any errors encountered
 *
 * @example
 * ```typescript
 * const sniffer = new SnifferEnvironmentParser();
 * const result = await sniffWithFireAndForget(sniffer, async () => {
 *   await service.register({ envParser: sniffer });
 * });
 * console.log('Env vars:', result.envVars);
 * console.log('Error:', result.error);
 * console.log('Unhandled rejections:', result.unhandledRejections);
 * ```
 */
export async function sniffWithFireAndForget(
	sniffer: SnifferEnvironmentParser,
	operation: () => unknown | Promise<unknown>,
	options: SniffOptions = {},
): Promise<SniffResult> {
	const { settleTimeMs = 100 } = options;
	const unhandledRejections: Error[] = [];

	// Capture unhandled rejections during sniffing (fire-and-forget promises)
	// Libraries like better-auth create async operations that may reject after
	// the initial event loop tick
	const captureRejection = (reason: unknown) => {
		const err = reason instanceof Error ? reason : new Error(String(reason));
		unhandledRejections.push(err);
	};
	process.on('unhandledRejection', captureRejection);

	let error: Error | undefined;

	try {
		const result = operation();

		// Handle async result
		if (result && typeof result === 'object' && 'then' in result) {
			await Promise.resolve(result).catch((e) => {
				error = e instanceof Error ? e : new Error(String(e));
			});
		}
	} catch (e) {
		error = e instanceof Error ? e : new Error(String(e));
	} finally {
		// Wait for fire-and-forget promises to settle
		await new Promise((resolve) => setTimeout(resolve, settleTimeMs));
		process.off('unhandledRejection', captureRejection);
	}

	return {
		envVars: sniffer.getEnvironmentVariables(),
		error,
		unhandledRejections,
	};
}
