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
	 *
	 * Returns a **request-scoped proxy** that re-resolves the underlying logger
	 * from AsyncLocalStorage on every call. This makes it safe for a singleton
	 * service to capture the logger once (e.g. during `register()`) and reuse it
	 * across requests — each log call routes to the current request's logger
	 * instead of freezing the first request's logger.
	 *
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

	/**
	 * Who the current request is for, once its session was verified
	 * (`identifyRequest`), or `undefined` — before then, for a request with no
	 * session, and outside a request.
	 */
	getUser(): RequestUser | undefined;
}

/**
 * Who a request is for: the identity its session was verified as.
 *
 * An id, never an address: it rides on every log line and span of the
 * request, and both leave the process for wherever telemetry is kept.
 */
export interface RequestUser {
	/** The user's id at the identity provider — Better Auth's `user.id`. */
	id: string;
	/** The session the request was made with. */
	sessionId?: string;
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
