import { randomUUID } from 'node:crypto';
import type { Logger } from '@geekmidas/logger';
import { ConsoleLogger } from '@geekmidas/logger/console';
import {
	enterRequestContext,
	exitRequestContext,
	runWithRequestContext,
	type ServiceContext,
	serviceContext,
} from '@geekmidas/services';
import type { TestAPI } from 'vitest';

/**
 * Options for setting up a request context in tests. Any field omitted
 * is filled with a test-friendly default (ConsoleLogger, random UUID,
 * Date.now()).
 */
export interface RequestContextOptions {
	/** Logger exposed via serviceContext.getLogger(). */
	logger?: Logger;
	/** Request id exposed via serviceContext.getRequestId(). */
	requestId?: string;
	/** Start time exposed via serviceContext.getRequestStartTime(). */
	startTime?: number;
}

function resolveContext(opts: RequestContextOptions = {}) {
	return {
		logger: opts.logger ?? new ConsoleLogger({ app: 'test' }),
		requestId: opts.requestId ?? randomUUID(),
		startTime: opts.startTime ?? Date.now(),
	};
}

/**
 * Run a function inside a request context with test-friendly defaults.
 * Useful when you need `serviceContext` to be available for a single call
 * (e.g. invoking `Service.register({ context })` outside a wrapped test).
 *
 * @example
 * ```ts
 * await runInRequestContext(() =>
 *   discovery.register([databaseService]),
 * );
 * ```
 */
export function runInRequestContext<T>(
	fn: () => T | Promise<T>,
	opts: RequestContextOptions = {},
): T | Promise<T> {
	return runWithRequestContext(resolveContext(opts), fn);
}

/**
 * Vitest fixture creator. Spread the result into `.extend()` and every test
 * runs inside `runWithRequestContext`, even tests that don't destructure
 * `requestContext` directly (the fixture is registered as `auto`).
 *
 * @example
 * ```ts
 * const it = test.extend({ ...requestContextFixture() });
 *
 * it('registers services with context', async ({ requestContext }) => {
 *   await discovery.register([databaseService]);
 *   expect(requestContext.getRequestId()).toBeDefined();
 * });
 * ```
 */
export function requestContextFixture(opts: RequestContextOptions = {}) {
	return {
		requestContext: [
			async (
				// biome-ignore lint/correctness/noEmptyPattern: vitest fixture signature
				{}: {},
				use: (value: ServiceContext) => Promise<void>,
			) => {
				// Vitest suspends the fixture on `await use(...)` and runs the test
				// body in a continuation of the runner's async context. A scoped
				// `runWithRequestContext` callback ends as soon as we hand control
				// to the runner, so the test body would see no context. Instead,
				// mutate the current task's store with `enterRequestContext` —
				// async/await preserves that store across the suspension, so the
				// test body sees it. We restore on the way out so subsequent tests
				// don't inherit the value.
				enterRequestContext(resolveContext(opts));
				try {
					await use(serviceContext);
				} finally {
					exitRequestContext();
				}
			},
			{ auto: true },
		] as const,
	};
}

/**
 * Wrap any Vitest `TestAPI` (including the one returned by
 * `wrapVitestKyselyTransaction`) so every test runs inside
 * `runWithRequestContext`. Compose with the transaction wrappers:
 *
 * @example
 * ```ts
 * import { wrapVitestKyselyTransaction } from '@geekmidas/testkit/kysely';
 * import { withRequestContext } from '@geekmidas/testkit/request-context';
 *
 * const baseIt = wrapVitestKyselyTransaction<DB>(it, { connection: db });
 * const itWithCtx = withRequestContext(baseIt);
 *
 * itWithCtx('runs inside trx + context', async ({ trx, requestContext }) => {
 *   // serviceContext is set up; Service.register({ context }) works here.
 * });
 * ```
 */
export function withRequestContext<
	T extends TestAPI | ReturnType<TestAPI['extend']>,
>(testApi: T, opts: RequestContextOptions = {}): T {
	return (testApi as any).extend(requestContextFixture(opts));
}
