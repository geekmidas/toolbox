import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from '@geekmidas/logger';
import type { ServiceContext } from './types';

/**
 * Internal storage for request context data.
 * Not exported - services use ServiceContext interface.
 */
export interface RequestContextData {
	logger: Logger;
	requestId: string;
	startTime: number;
}

/**
 * Internal AsyncLocalStorage instance for request context.
 * Not exported - use runWithRequestContext() to establish context
 * and serviceContext to access it.
 */
const requestContextStorage = new AsyncLocalStorage<RequestContextData>();

/**
 * Resolve the logger for the current request, or throw if there is none.
 */
function resolveRequestLogger(): Logger {
	const store = requestContextStorage.getStore();
	if (!store) {
		throw new Error(
			'ServiceContext.getLogger() called outside request context. ' +
				'Ensure code runs within runWithRequestContext().',
		);
	}
	return store.logger;
}

/**
 * Create a Logger that re-resolves its underlying logger on every call instead
 * of capturing it once.
 *
 * This is what makes it safe for a **singleton** service to grab the logger a
 * single time (e.g. during `register()`, which `ServiceDiscovery` only runs
 * once and then caches) and reuse that reference for every request: each log
 * call resolves the *current* request's logger from `AsyncLocalStorage`, so
 * requests no longer inherit the first request's logger (and its `requestId`,
 * user bindings, etc.).
 *
 * Implemented as a `Proxy` rather than a fixed list of methods so it forwards
 * the *entire* surface of whatever logger is supplied — including members
 * beyond the base `Logger` interface (e.g. a richer pino-backed logger's
 * `flush()` or `level`) and any methods added to `Logger` in the future.
 *
 * @param bindings - `child()` bindings applied, in order, on top of the
 *   resolved logger before each call.
 */
function createRequestScopedLogger(bindings: object[] = []): Logger {
	// Memoise the resolved (optionally child) logger per underlying base logger
	// so we don't rebuild the child chain on every access within a request.
	// Recomputed whenever the current request's logger changes — there is no
	// await between the check and use, so this is safe under concurrency.
	let cachedBase: Logger | undefined;
	let cachedResolved: Logger | undefined;

	const resolve = (): Logger => {
		const base = resolveRequestLogger();
		if (base !== cachedBase) {
			cachedBase = base;
			cachedResolved = bindings.reduce<Logger>(
				(log, obj) => log.child(obj),
				base,
			);
		}
		return cachedResolved as Logger;
	};

	return new Proxy({} as Logger, {
		get(_target, prop) {
			// `child()` must stay request-scoped: return a new proxy carrying the
			// extra binding, NOT the underlying logger's child (which would freeze
			// to the current request).
			if (prop === 'child') {
				return (obj: object) => createRequestScopedLogger([...bindings, obj]);
			}
			// Never look like a thenable, and don't answer symbol/inspection probes
			// (util.inspect, Symbol.toPrimitive, etc.) with bound functions.
			if (prop === 'then' || typeof prop === 'symbol') {
				return undefined;
			}
			const value = (resolve() as unknown as Record<string, unknown>)[prop];
			// Functions are re-resolved at *call* time so detached references
			// (`const info = logger.info`) still target the current request's
			// logger. Non-function members (e.g. `level`) forward as their live
			// value on the current request's logger.
			return typeof value === 'function'
				? (...args: unknown[]) => {
						const fn = (resolve() as unknown as Record<string, unknown>)[
							prop
						] as (...a: unknown[]) => unknown;
						return fn(...args);
					}
				: value;
		},
		// Keep `'prop' in logger` / hasOwnProperty truthful against the underlying
		// logger so feature-detection works.
		has(_target, prop) {
			if (prop === 'child') return true;
			if (prop === 'then' || typeof prop === 'symbol') return false;
			return prop in (resolve() as object);
		},
	});
}

/**
 * Stable, process-wide request-scoped logger proxy. Shared across requests on
 * purpose — it carries no request state itself, delegating to the current
 * `AsyncLocalStorage` store on each call.
 */
const requestScopedLogger = createRequestScopedLogger();

/**
 * ServiceContext implementation.
 * Singleton that reads from AsyncLocalStorage.
 * Methods throw if called outside a request context (catches bugs early).
 */
export const serviceContext: ServiceContext = {
	getLogger() {
		// Throw eagerly if there is no context, preserving the "catch bugs early"
		// contract for callers that read the logger at an unexpected time.
		resolveRequestLogger();
		// Return the shared proxy rather than the raw `store.logger`. A service
		// that captures this once still logs against the correct per-request
		// logger because the proxy re-resolves on every call.
		return requestScopedLogger;
	},

	getRequestId() {
		const store = requestContextStorage.getStore();
		if (!store) {
			throw new Error(
				'ServiceContext.getRequestId() called outside request context. ' +
					'Ensure code runs within runWithRequestContext().',
			);
		}
		return store.requestId;
	},

	getRequestStartTime() {
		const store = requestContextStorage.getStore();
		if (!store) {
			throw new Error(
				'ServiceContext.getRequestStartTime() called outside request context. ' +
					'Ensure code runs within runWithRequestContext().',
			);
		}
		return store.startTime;
	},

	hasContext() {
		return requestContextStorage.getStore() !== undefined;
	},
};

/**
 * Run a function with request context.
 * Used by endpoint/function/subscriber adaptors.
 *
 * @param data - Request context data (logger, requestId, startTime)
 * @param fn - Function to run with context
 * @returns Result of the function
 *
 * @example
 * ```typescript
 * const result = await runWithRequestContext(
 *   { logger, requestId, startTime: Date.now() },
 *   async () => {
 *     // Inside here, serviceContext.getLogger() returns `logger`
 *     // serviceContext.getRequestId() returns `requestId`
 *     return await handleRequest();
 *   }
 * );
 * ```
 */
export function runWithRequestContext<T>(
	data: RequestContextData,
	fn: () => T | Promise<T>,
): T | Promise<T> {
	return requestContextStorage.run(data, fn);
}

/**
 * Mutate the current async task's store so that subsequent code in this task
 * (and any descendants) sees the supplied request context.
 *
 * Unlike `runWithRequestContext`, this does not scope the context to a
 * callback — useful when the caller can't wrap a function, for example in a
 * Vitest fixture that suspends on `use()` and yields control to the test
 * runner before the test body executes.
 *
 * **Test setup only.** In production handlers, prefer `runWithRequestContext`
 * so the frame is automatically cleaned up.
 */
export function enterRequestContext(data: RequestContextData): void {
	requestContextStorage.enterWith(data);
}

/**
 * Clear the request context for the current async task. Pairs with
 * `enterRequestContext`. After calling, `serviceContext.hasContext()` returns
 * false for the remainder of the current async resource.
 */
export function exitRequestContext(): void {
	// AsyncLocalStorage<T>.enterWith requires T, but Node accepts undefined at
	// runtime — passing it resets getStore() back to undefined.
	(requestContextStorage as unknown as AsyncLocalStorage<unknown>).enterWith(
		undefined,
	);
}
