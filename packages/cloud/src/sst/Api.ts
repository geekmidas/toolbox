import path from 'node:path';
import { EnvValidationError } from '@geekmidas/envkit/sst';
import {
	flattenManifestField,
	type ManifestField,
	type RouteInfo,
} from '@geekmidas/manifest';
import type { Function } from './Function';
import { type GkmLinkable, ResourceType } from './Linkable';
import { LinkedEnvironment } from './LinkedEnvironment';
import type { StackType } from './Stack';

/**
 * `Api` — wraps SST's `sst.aws.ApiGatewayV2` (HTTP API) with a typed route
 * table and per-route environment validation that fails at synth time (before
 * deploy) when a route requires variables its links cannot provide. Native
 * `ApiGatewayV2Args` (CORS, domain, …) pass through untouched.
 *
 * NOTE: this module is distributed as raw TypeScript source. It extends the
 * ambient `sst.aws.*` globals that only exist inside an `sst install`ed app, so
 * it cannot be type-checked or built in this repo (see docs §2). It targets
 * SST v4 (ion); the route/auth shape follows the v3 reference and should be
 * verified against v4 in a consuming app.
 */
export class Api<
		TAuthorizers extends Record<string, unknown> = {},
		TStage extends string = string,
		TDomain extends string = string,
	>
	extends sst.aws.ApiGatewayV2
	implements GkmLinkable
{
	readonly _id!: string;

	get _type() {
		return ResourceType.ApiGatewayV2;
	}

	constructor(
		stack: StackType<TStage, TDomain>,
		id: string,
		props: ApiProps<TAuthorizers>,
	) {
		const {
			links = [],
			routes,
			root = process.cwd(),
			vpc,
			environment: apiEnvironment,
			runtime: apiRuntime = 'nodejs24.x',
			authorizers,
			...apiArgs
		} = props;

		// Pass the consumer's native `ApiGatewayV2Args` straight through — CORS,
		// domain, access logs, etc. are entirely the consumer's call.
		super(id, apiArgs);

		this._id = id;

		// Register each declared authorizer and map its name to the created id.
		// The reserved `jwt` entry is a JWT authorizer; any other name is a Lambda
		// authorizer (enforced by the `ApiAuthorizers` type via the `handler`).
		const authorizerIds = new Map<string, $util.Output<string>>();
		for (const [name, config] of Object.entries(authorizers ?? {}) as [
			string,
			JwtAuthorizer | LambdaAuthorizer,
		][]) {
			const authorizer =
				'handler' in config
					? this.addAuthorizer({
							name,
							lambda: {
								// Accept a handler path, function args, or one of our
								// `Function` constructs (passed through as its `arn`).
								function:
									typeof config.handler === 'object' && 'arn' in config.handler
										? config.handler.arn
										: config.handler,
								identitySources: config.identitySources,
								payload: config.payload,
							},
						})
					: this.addAuthorizer({
							name,
							jwt: {
								issuer: config.issuer,
								audiences: config.audiences,
								identitySource: config.identitySource,
							},
						});
			authorizerIds.set(name, authorizer.id);
		}

		const relativeRoot = path.relative(process.cwd(), root);

		const environment = {
			...LinkedEnvironment.createBaseEnvironment(stack),
			...apiEnvironment,
		};

		// Same links + whitelist for every route, so build the linker once; the
		// failing route is identified via the per-route error context below.
		const linked = new LinkedEnvironment(links, {
			whitelist: Object.keys(environment),
		});

		const failures: EnvValidationError[] = [];

		for (const route of routes) {
			const routeKey = `${route.method} ${route.path}`;
			const names = route.environment ?? [];

			const result = linked.validator.validate(names);
			if (!result.valid) {
				failures.push(
					new EnvValidationError({
						missing: result.invalidVars,
						available: linked.validator.availableVars,
						linkVars: linked.validator.linkVars,
						suggestions: result.suggestions,
						context: `${id} ${routeKey}`,
					}),
				);
			}

			const link = linked.resolveLink(names);

			const auth = Api.buildRouteAuth(
				route,
				authorizers as
					| Record<string, JwtAuthorizer | LambdaAuthorizer>
					| undefined,
				authorizerIds,
			);

			this.route(
				routeKey,
				{
					handler: path.join(relativeRoot, route.handler),
					vpc,
					environment,
					link,
					runtime: route.runtime ?? apiRuntime,
					nodejs: route.nodejs,
					timeout: route.timeout,
					memory: route.memory,
				},
				auth,
			);
		}

		// Fail the whole synth if any route is misconfigured, with one actionable
		// message per offending route.
		if (failures.length) {
			throw new Error(failures.map((f) => f.message).join('\n\n'));
		}
	}

	/**
	 * Build an `Api` from a `gkm build` manifest's `routes` field (flat or
	 * partitioned): each `RouteInfo` becomes a route (env vars, authorizer,
	 * timeout/memory mapped). Supply `authorizers` (JWT/Lambda settings),
	 * `links`, and any native args via `props`.
	 *
	 * ```ts
	 * import { manifest } from './.gkm/manifest/aws';
	 * Api.fromManifest(stack, 'Api', manifest.routes, { links: [db] });
	 * ```
	 */
	static fromManifest<
		TAuthorizers extends Record<string, unknown> = {},
		TStage extends string = string,
		TDomain extends string = string,
	>(
		stack: StackType<TStage, TDomain>,
		id: string,
		routes: ManifestField<RouteInfo>,
		props: Omit<ApiProps<TAuthorizers>, 'routes'> = {},
	): Api<TAuthorizers, TStage, TDomain> {
		const routeTable = flattenManifestField(routes).map(
			(route): Route<AuthorizerName<TAuthorizers>> => ({
				method: route.method as Route['method'],
				path: route.path,
				handler: route.handler,
				environment: route.environment,
				authorizer: route.authorizer as AuthorizerName<TAuthorizers>,
				timeout: route.timeout ? `${route.timeout} seconds` : undefined,
				memory: route.memorySize ? `${route.memorySize} MB` : undefined,
			}),
		);
		return new Api(stack, id, {
			...props,
			routes: routeTable,
		} as ApiProps<TAuthorizers>);
	}

	/** Resolves a route's `authorizer` name to the SST `auth` option. */
	private static buildRouteAuth(
		route: Route<string>,
		authorizers: Record<string, JwtAuthorizer | LambdaAuthorizer> | undefined,
		authorizerIds: Map<string, $util.Output<string>>,
	) {
		const name = route.authorizer;
		if (!name || name === 'none') return undefined;
		if (name === 'iam') return { auth: { iam: true } };

		const authorizerId = authorizerIds.get(name);
		if (!authorizerId) return undefined;

		const config = authorizers?.[name];
		if (config && 'handler' in config) {
			return { auth: { lambda: authorizerId } };
		}
		const jwt = config as JwtAuthorizer | undefined;
		return {
			auth: {
				jwt: {
					authorizer: authorizerId,
					scopes: route.scopes ?? jwt?.scopes,
				},
			},
		};
	}
}

/** JWT authorizer settings — `issuer` and `audiences` are required. */
export interface JwtAuthorizer {
	issuer: $util.Input<string>;
	audiences: $util.Input<$util.Input<string>[]>;
	identitySource?: $util.Input<string>;
	/** Default OAuth scopes required by routes that use this authorizer. */
	scopes?: string[];
}

/**
 * Lambda (request) authorizer — requires a `handler`: a handler path, full
 * function args, or one of our `Function` constructs.
 */
export interface LambdaAuthorizer {
	handler: string | sst.aws.FunctionArgs | Function;
	identitySources?: $util.Input<$util.Input<string>[]>;
	payload?: '1.0' | '2.0';
}

/**
 * Authorizer config map. The reserved `jwt` key must be {@link JwtAuthorizer}
 * settings; every other named authorizer must be a {@link LambdaAuthorizer}
 * (enforced via the required `handler`).
 */
export type ApiAuthorizers<T> = {
	[K in keyof T]: K extends 'jwt' ? JwtAuthorizer : LambdaAuthorizer;
};

/** Valid `authorizer` values for a route: the built-ins plus declared names. */
export type AuthorizerName<T> = 'iam' | 'none' | (keyof T & string);

export interface Route<TAuthorizer extends string = 'iam' | 'none'> {
	method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ALL';
	path: string;
	/** Handler entrypoint, resolved relative to `root` (default `cwd`). */
	handler: string;
	/** Required env vars for this route; validated against `links`. */
	environment?: readonly string[];
	/**
	 * Authorization for this route:
	 * - `iam` — AWS SigV4 signed requests
	 * - `none` (default) — public
	 * - a declared authorizer name (`jwt`, or a custom Lambda authorizer)
	 */
	authorizer?: TAuthorizer;
	/** OAuth scopes for a `jwt` route (overrides the authorizer's defaults). */
	scopes?: string[];
	nodejs?: { install?: string[]; externals?: string[] };
	/** Lambda runtime for this route. Overrides the API default (`nodejs24.x`). */
	runtime?: sst.aws.FunctionArgs['runtime'];
	/** Lambda timeout for this route, e.g. `30 seconds`. */
	timeout?: sst.aws.FunctionArgs['timeout'];
	/** Lambda memory for this route, e.g. `1024 MB`. */
	memory?: sst.aws.FunctionArgs['memory'];
}

/**
 * `ApiProps` extends SST's native `sst.aws.ApiGatewayV2Args`, so every native
 * option (`cors`, `domain`, `accessLog`, `transform`, …) passes straight
 * through untouched. We only add the route table, authorizers, and the
 * linking/validation inputs on top.
 */
export interface ApiProps<TAuthorizers extends Record<string, unknown> = {}>
	extends sst.aws.ApiGatewayV2Args {
	routes: Route<AuthorizerName<TAuthorizers>>[];
	/**
	 * Named authorizers. The reserved `jwt` key configures a JWT authorizer; any
	 * other name configures a Lambda authorizer (requires a `handler`). Route
	 * `authorizer` values are constrained to these names plus `iam`/`none`.
	 */
	authorizers?: ApiAuthorizers<TAuthorizers>;
	/** Pool of linkable resources routes may draw on. */
	links?: GkmLinkable[];
	/** Base directory for resolving route `handler` paths. Defaults to `cwd`. */
	root?: string;
	/** Env vars applied to every route, merged over the API defaults. */
	environment?: Record<string, string>;
	/** VPC to place each route's Lambda in. */
	vpc?: sst.aws.Vpc;
	/** Default Lambda runtime for every route. Defaults to `nodejs24.x`; a route
	 * may override it. */
	runtime?: sst.aws.FunctionArgs['runtime'];
}
