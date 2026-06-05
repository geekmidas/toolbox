import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import {
	runWithRequestContext,
	type Service,
	ServiceDiscovery,
	type ServiceRecord,
} from '@geekmidas/services';
import type {
	TRPCMiddlewareBuilder,
	TRPCMiddlewareFunction,
} from '@trpc/server';

/**
 * Shape of `t.middleware` from `@trpc/server`. We accept this rather than the
 * initialized `t` object so callers retain ownership of their tRPC instance
 * (no double-initialization, no opinion on context/meta shape).
 */
type CreateMiddleware<TContext, TMeta> = <$ContextOverrides>(
	fn: TRPCMiddlewareFunction<
		TContext,
		TMeta,
		object,
		$ContextOverrides,
		unknown
	>,
) => TRPCMiddlewareBuilder<TContext, TMeta, $ContextOverrides, unknown>;

/**
 * Result of `createServicesMiddleware`: a function that accepts a service
 * tuple and returns a tRPC middleware that merges resolved services onto the
 * context.
 */
export type ServicesMiddleware<
	TContext extends object,
	TMeta extends object,
> = <const T extends Service[]>(
	services: [...T],
) => TRPCMiddlewareBuilder<TContext, TMeta, ServiceRecord<T>, unknown>;

/**
 * Context shape required by `createServicesMiddleware` overload 2.
 * Procedures that pull services via context-stored discovery must expose it
 * under `serviceDiscovery`.
 */
export interface ContextWithServiceDiscovery {
	serviceDiscovery: ServiceDiscovery;
}

/**
 * Minimum context required for request-context propagation. `logger` must be
 * present so services can call `serviceContext.getLogger()`. `requestId` and
 * `startTime` are auto-generated if missing.
 */
export interface ContextWithLogger {
	logger: Logger;
	requestId?: string;
	startTime?: number;
}

/**
 * Create a tRPC middleware that:
 *
 * 1. Resolves the requested services via `ServiceDiscovery`.
 * 2. Wraps the downstream call in `runWithRequestContext` so any code reached
 *    by the procedure (including service method implementations) can read the
 *    current logger/request id via `serviceContext`.
 * 3. Merges the resolved services onto the tRPC context so handlers can access
 *    them by service name (`ctx.database`, `ctx.cache`, ...).
 *
 * Two overloads:
 * - Pass an `envParser` to create a per-request `ServiceDiscovery` instance.
 * - Omit `envParser` to read `ctx.serviceDiscovery` from the tRPC context.
 *
 * @example
 * ```ts
 * import { initTRPC } from '@trpc/server';
 * import { createServicesMiddleware } from '@geekmidas/constructs/trpc';
 *
 * const t = initTRPC.context<Context>().create();
 * const withServices = createServicesMiddleware(t.middleware, envParser);
 *
 * export const authedProcedure = t.procedure.use(
 *   withServices([databaseService, cacheService]),
 * );
 * ```
 */
export function createServicesMiddleware<
	TContext extends ContextWithLogger & object,
	TMeta extends object,
>(
	mw: CreateMiddleware<TContext, TMeta>,
	envParser: EnvironmentParser<{}>,
): ServicesMiddleware<TContext, TMeta>;
export function createServicesMiddleware<
	TContext extends ContextWithLogger & ContextWithServiceDiscovery & object,
	TMeta extends object,
>(mw: CreateMiddleware<TContext, TMeta>): ServicesMiddleware<TContext, TMeta>;
export function createServicesMiddleware<
	TContext extends ContextWithLogger & object,
	TMeta extends object,
>(
	mw: CreateMiddleware<TContext, TMeta>,
	envParser?: EnvironmentParser<{}>,
): ServicesMiddleware<TContext, TMeta> {
	return (<const T extends Service[]>(services: [...T]) => {
		const builder = mw(async (opts) => {
			const ctx = opts.ctx as TContext & Partial<ContextWithServiceDiscovery>;

			const discovery =
				ctx.serviceDiscovery ??
				ServiceDiscovery.getInstance(
					envParser ??
						(() => {
							// Hit only if overload 2 was selected but ctx.serviceDiscovery is
							// missing at runtime — surface the mistake immediately rather
							// than letting an undefined env parser fail deep inside register.
							throw new Error(
								'createServicesMiddleware: no `envParser` provided and ' +
									'`ctx.serviceDiscovery` is missing. Pass an EnvironmentParser ' +
									'to createServicesMiddleware(), or attach a ServiceDiscovery ' +
									'instance to the tRPC context.',
							);
						})(),
				);

			const requestId = ctx.requestId ?? crypto.randomUUID();
			const startTime = ctx.startTime ?? Date.now();

			return runWithRequestContext(
				{ logger: ctx.logger, requestId, startTime },
				async () => {
					const resolved = await discovery.register(services);
					return opts.next({
						ctx: { ...opts.ctx, ...resolved } as typeof opts.ctx &
							ServiceRecord<T>,
					});
				},
			);
		});

		// Tag the inner middleware function with the requested services so external
		// tooling (e.g. detect-procedures route generators) can introspect a
		// procedure's service dependencies without re-executing middleware.
		const middlewares = (
			builder as unknown as { _middlewares?: Array<{ _services?: Service[] }> }
		)._middlewares;
		if (middlewares?.length) {
			const last = middlewares[middlewares.length - 1];
			if (last) last._services = services as unknown as Service[];
		}

		return builder as TRPCMiddlewareBuilder<
			TContext,
			TMeta,
			ServiceRecord<T>,
			unknown
		>;
	}) as ServicesMiddleware<TContext, TMeta>;
}

/**
 * Create a tRPC middleware that establishes a request context for downstream
 * code without resolving any services. Useful when services aren't needed on
 * a procedure but the handler (or libraries it calls) still wants to read
 * `serviceContext.getLogger()` / `getRequestId()` / `getRequestStartTime()`.
 *
 * `requestId` and `startTime` are pulled from the tRPC context when present,
 * otherwise generated (`crypto.randomUUID()` and `Date.now()`).
 *
 * @example
 * ```ts
 * const withRequestContext = createRequestContextMiddleware(t.middleware);
 * export const baseProcedure = t.procedure.use(withRequestContext);
 * ```
 */
export function createRequestContextMiddleware<
	TContext extends ContextWithLogger & object,
	TMeta extends object,
>(
	mw: CreateMiddleware<TContext, TMeta>,
): TRPCMiddlewareBuilder<TContext, TMeta, object, unknown> {
	return mw(async (opts) => {
		const ctx = opts.ctx as TContext;
		const requestId = ctx.requestId ?? crypto.randomUUID();
		const startTime = ctx.startTime ?? Date.now();
		return runWithRequestContext(
			{ logger: ctx.logger, requestId, startTime },
			() => opts.next(),
		);
	});
}
