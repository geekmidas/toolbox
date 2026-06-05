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
 * ServiceContext implementation.
 * Singleton that reads from AsyncLocalStorage.
 * Methods throw if called outside a request context (catches bugs early).
 */
export const serviceContext: ServiceContext = {
	getLogger() {
		const store = requestContextStorage.getStore();
		if (!store) {
			throw new Error(
				'ServiceContext.getLogger() called outside request context. ' +
					'Ensure code runs within runWithRequestContext().',
			);
		}
		return store.logger;
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
