import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';

/**
 * Request context available to services.
 * Methods are guaranteed to return values when called within a request context.
 * Throws if called outside a request context (catches bugs early).
 */
export interface ServiceContext {
	/**
	 * Get the current request's logger.
	 * @throws Error if called outside a request context
	 */
	getLogger(): Logger;

	/**
	 * Get the current request ID.
	 * @throws Error if called outside a request context
	 */
	getRequestId(): string;

	/**
	 * Get the current request's start time (from Date.now()).
	 * Useful for calculating request duration.
	 * @throws Error if called outside a request context
	 */
	getRequestStartTime(): number;

	/**
	 * Check if currently running inside a request context.
	 * Use this to guard calls if you need to handle both cases.
	 */
	hasContext(): boolean;
}

/**
 * Options passed to service register method.
 */
export interface ServiceRegisterOptions {
	/** Environment parser for configuration */
	envParser: EnvironmentParser<{}>;
	/** Request context for logging and tracing */
	context: ServiceContext;
}

/**
 * Service interface for the simplified service pattern.
 * Services are objects with a serviceName and register method.
 *
 * @template TName - The literal string type for the service name
 * @template TInstance - The type of the service instance that will be registered
 *
 * @example
 * ```typescript
 * const databaseService = {
 *   serviceName: 'database' as const,
 *   register({ envParser, context }: ServiceRegisterOptions) {
 *     const config = envParser.create((get) => ({
 *       url: get('DATABASE_URL').string()
 *     })).parse();
 *
 *     return {
 *       async query(sql: string) {
 *         const logger = context.getLogger();
 *         logger.debug({ sql }, 'Executing query');
 *         // ... execute query
 *       }
 *     };
 *   }
 * } satisfies Service<'database', DatabaseInstance>;
 * ```
 */
export interface Service<TName extends string = string, TInstance = unknown> {
	/**
	 * Unique name for the service, used for lookup via services.get()
	 */
	serviceName: TName;
	/**
	 * Register method that returns the actual service instance.
	 * Called once on first access, then cached.
	 *
	 * @param options - Registration options including envParser and context
	 */
	register(options: ServiceRegisterOptions): TInstance | Promise<TInstance>;
}
