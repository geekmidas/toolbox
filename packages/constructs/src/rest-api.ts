/**
 * `RestApi` — the application's own HTTP surface, declared.
 *
 * Everything an app serves already existed; what did not exist was a *node* for
 * it. Without one, three things that are properties of the graph had to be
 * written down somewhere else: which origins the API accepts, which origins the
 * auth server trusts, and which URL a frontend is built against. All three were
 * being derived by walking the workspace config for ports — a second mechanism,
 * running beside the graph and answering the same question worse, since it can
 * only ever describe what this repo happens to run.
 *
 * With the surface declared, all three become one edge read backwards: a
 * consumer depends on the API, and *that* is the CORS entry, the trusted origin,
 * and the build-time URL. Nothing enumerates its own callers.
 *
 * ```ts
 * export const api = new RestApi('Api', {
 *   authorizers: ['session'],
 *   defaultAuthorizer: 'session',
 * });
 * ```
 */

import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { DEFAULT_LOGGER } from '@geekmidas/logger/console';
import {
	type ConstructName,
	canonicalId,
	type Declaration,
	type Dependency,
	provideKey,
} from '@geekmidas/manifest';
import type { Telescope } from '@geekmidas/telescope';
import {
	type Authenticator,
	type Declarable,
	edgeTo,
} from './construct-interface';

export type { Authenticator } from './construct-interface';

import {
	type BuiltInSecuritySchemeId,
	getSecurityScheme,
} from './endpoints/Authorizer';
import { EndpointFactory } from './endpoints/EndpointFactory';
import { envParserFor } from './endpoints/surfaceEnv';

/** The factory a surface builds its endpoints from. */
type Endpoints = EndpointFactory<[], '', Logger>;

export interface RestApiConfig<
	// `readonly []` rather than `readonly string[]`: a surface that declares no
	// authorizers of its own should narrow `defaultAuthorizer` to the built-ins
	// and `'none'`, not widen it back to any string.
	TAuthorizers extends readonly string[] = readonly [],
> {
	/**
	 * The app that serves this surface, relative to the workspace root —
	 * `'apps/api'`, or `'.'` in a single-app project.
	 *
	 * Required. It was inferred from the id (`apps/<kebab-id>`, or the root
	 * when no such directory existed), which meant a surface's home was
	 * whatever happened to be on disk. It is where the app's `package.json`
	 * and base `tsconfig.json` are, and which build serves this surface. It
	 * does not change discovery: constructs still load from the workspace's
	 * `constructs` glob.
	 */
	path: string;
	/**
	 * The label it answers on under a stage's domain — `api` for
	 * `api.myapp.com`, from `deploy.domains` — and under the project locally,
	 * `api.myapp.localhost`. Absent, its id kebab-cased.
	 */
	subdomain?: string;
	/**
	 * CORS tunables. The *origins* are never here — they are read off the
	 * constructs that declared an edge to this surface, which is the whole point
	 * of declaring one. These are the parts a graph cannot answer.
	 */
	cors?: {
		maxAge?: number;
		credentials?: boolean;
		allowHeaders?: readonly string[];
		exposeHeaders?: readonly string[];
	};
	/**
	 * The authorizer names this surface exposes. Names only — what verifies a
	 * request legitimately differs between local and deployed, so the mechanism
	 * belongs to the target and never to portable code.
	 */
	authorizers?: TAuthorizers;
	/**
	 * The authorizer applied to an endpoint that names none.
	 *
	 * Required, and `'none'` is a valid answer that has to be typed out. The
	 * alternative is an API that ships open because a field was left off, which
	 * is the one default worth refusing to have.
	 *
	 * It was called `default`, which said what it was to the type and nothing
	 * to the reader: next to `authorizers: ['iam']`, a bare `default: 'none'`
	 * could be defaulting the runtime or the target. The manifest has always
	 * called it `defaultAuthorizer` and the factory `defaultAuthorizerName`;
	 * this is the same fact under the same name.
	 *
	 * Typed from `authorizers`, so it can only name one this surface exposes —
	 * plus a built-in scheme, and `'none'`. It was a bare `string`, which let
	 * `defaultAuthorizer: 'jwtt'` compile and every endpoint on the surface
	 * default to an authorizer that does not exist.
	 */
	defaultAuthorizer: TAuthorizers[number] | BuiltInSecuritySchemeId | 'none';
	/**
	 * The logger every endpoint on this surface runs with.
	 *
	 * The actual logger, not a path to one. It used to be named in config as
	 * `logger: './config/logger'`, because the build wrote an import into each
	 * generated handler and a generator can print a specifier but not an object.
	 * Endpoints built from the surface carry it, so there is nothing to print
	 * and nothing to keep in step with a moved file.
	 */
	logger?: Logger;
	/**
	 * The environment parser every endpoint on this surface runs with.
	 *
	 * Same reason as `logger`, and the same field it replaces —
	 * `envParser: './config/env#envParser'`, a module path with an export name
	 * appended, parsed by us, checked by nothing.
	 */
	envParser?: EnvironmentParser<{}>;
	/**
	 * The Telescope instance this surface's entry mounts.
	 *
	 * The actual instance, for the reason `logger` is: it used to be named as
	 * `telescope: './config/telescope#telescope'`, a module path the build
	 * printed an import for. The entry already imports the surface.
	 */
	telescope?: Telescope;
}

/**
 * What is *not* here, and why.
 *
 * `dependsOn`, `database`, `auditor` and `.event(topic, …)` all inject a capability
 * into a handler. Putting one on the surface hands it to every route the
 * surface serves — a health check gets the database because a report needed it
 * — which is the thing least privilege forbids and the reason `.calls()` is not
 * spelled `dependsOn`. They belong to the endpoint, or to a branch —
 * `api.database(db)` — for a group of endpoints that genuinely share them. A
 * branch is a new factory; the surface config stays free of grants.
 *
 * `auth` is not here either: `.auth(construct)` already declares it, and a
 * second way to say the same thing is the duplication this whole model removes.
 *
 * What is left is what the *process* is rather than what a route may reach.
 */

export class RestApi<
	TName extends string = string,
	const TAuthorizers extends readonly string[] = readonly [],
> implements Declarable<TName>
{
	readonly id: TName;

	/**
	 * Declared once and read by both `declare()` and anything that consumes this
	 * surface, so what the target publishes and what a consumer reads cannot
	 * drift.
	 */
	readonly keys: {
		url: string;
		trustedOrigins: string;
		cookieDomain: string;
	};

	/**
	 * The logger every endpoint on this surface runs with.
	 *
	 * Always defined — the surface's own if it was given one, the console
	 * logger otherwise — so nothing downstream has to decide what to do about a
	 * missing one. The generated entry reads it from here.
	 */
	readonly logger: Logger;

	/**
	 * The environment parser every endpoint on this surface runs with.
	 *
	 * Always defined, and normally the default: `process.env` merged with the
	 * credentials `gkm dev`/`gkm exec` injected. That is what every
	 * application's own `config/env.ts` was — boilerplate identical in every
	 * project, and mandatory, which is a poor combination.
	 */
	readonly envParser: EnvironmentParser<{}>;

	/** The Telescope instance, when this surface was given one. */
	readonly telescope?: Telescope;

	constructor(
		id: ConstructName<TName>,
		private readonly config: RestApiConfig<TAuthorizers>,
		/** Internal: how `.calls()` carries edges into the copy it returns. */
		private readonly dependencies: readonly Dependency[] = [],
		/** Internal: how `.auth()` carries the authenticator into its copy. */
		private readonly authenticator?: Authenticator,
	) {
		const canonical = canonicalId(id as string);

		this.id = canonical as TName;

		this.keys = {
			url: provideKey(canonical, 'url'),
			trustedOrigins: provideKey(canonical, 'trustedOrigins'),
			cookieDomain: provideKey(canonical, 'cookieDomain'),
		};

		this.logger = config.logger ?? DEFAULT_LOGGER;
		this.telescope = config.telescope;
		this.envParser = envParserFor(
			config.envParser
				? { id: canonical, envParser: config.envParser }
				: undefined,
		);

		this.#endpoints = new EndpointFactory({
			defaultLogger: this.logger,
			...(config.authorizers
				? {
						// With the scheme a built-in name stands for, as the factory's own
						// `.authorizers()` resolves it. Bare names reached the OpenAPI
						// document with no scheme, so a guarded endpoint read as public.
						availableAuthorizers: config.authorizers.map((name) => {
							const securityScheme = getSecurityScheme(name);
							return securityScheme ? { name, securityScheme } : { name };
						}),
					}
				: {}),
			// `'none'` reaches the factory as no default at all, which is what
			// public means to an endpoint that names no authorizer.
			...(config.defaultAuthorizer && config.defaultAuthorizer !== 'none'
				? { defaultAuthorizerName: config.defaultAuthorizer }
				: {}),
			surface: {
				id: this.id,
				envParser: this.envParser,
				...(authenticator ? { auth: authenticator } : {}),
			},
		});

		const endpoints = this.#endpoints;
		this.get = endpoints.get.bind(endpoints);
		this.post = endpoints.post.bind(endpoints);
		this.put = endpoints.put.bind(endpoints);
		this.patch = endpoints.patch.bind(endpoints);
		this.delete = endpoints.delete.bind(endpoints);
		this.options = endpoints.options.bind(endpoints);
		this.database = endpoints.database.bind(endpoints);
		this.session = endpoints.session.bind(endpoints);
		this.auditor = endpoints.auditor.bind(endpoints);
		this.actor = endpoints.actor.bind(endpoints);
		this.authorizer = endpoints.authorizer.bind(endpoints);
		this.authorize = endpoints.authorize.bind(endpoints);
		this.rls = endpoints.rls.bind(endpoints);
		this.route = endpoints.route.bind(endpoints);
	}

	/**
	 * This surface's endpoint factory, which every method below starts from.
	 *
	 * Private: a surface *is* where endpoints are built, so there is no second
	 * object to reach through first. `api.database(db)` said the same
	 * thing as `api.database(db)` with one more word to learn.
	 */
	readonly #endpoints: Endpoints;

	/** `api.get('/users')` — one route on this surface. */
	readonly get: Endpoints['get'];
	readonly post: Endpoints['post'];
	readonly put: Endpoints['put'];
	readonly patch: Endpoints['patch'];
	readonly delete: Endpoints['delete'];
	readonly options: Endpoints['options'];

	/**
	 * A branch for a *group* of endpoints that shares what a single route would
	 * otherwise repeat — a database, an auditor, a publisher, a session:
	 *
	 * ```ts
	 * export const router = api.database(database);
	 * export const createUser = router.post('/users').handle(({ db }) => …);
	 * ```
	 *
	 * Each returns a new factory and leaves the surface as it was. That is the
	 * whole difference from putting the same thing in the surface's config: a
	 * group opts in, where the surface would grant it to every route it serves —
	 * a health check handed the database because a profile endpoint needed it.
	 *
	 * `dependsOn` is deliberately not here. It is per endpoint, and on the
	 * surface it would read as the API depending on something, which is what
	 * `.calls()` and `.auth()` say instead.
	 */
	readonly database: Endpoints['database'];
	readonly session: Endpoints['session'];
	readonly auditor: Endpoints['auditor'];
	readonly actor: Endpoints['actor'];
	readonly authorizer: Endpoints['authorizer'];
	readonly authorize: Endpoints['authorize'];
	readonly rls: Endpoints['rls'];
	readonly route: Endpoints['route'];

	/**
	 * What authenticates this surface.
	 *
	 * An edge like `.calls()` — the auth server learns this origin, and the two
	 * share a cookie domain — but a named one, because *who authenticates me* is
	 * a different fact from *who I happen to call*, and only one of them decides
	 * what a request is allowed to be. A surface with two of the first is a
	 * mistake; two of the second is Tuesday.
	 *
	 * It declares the id, and keeps the construct: a session callback reads from
	 * it as `auth` — `session(async ({ auth }) => auth.getSession())` — which
	 * calls the construct's `verify(headers)`. That is the one thing every
	 * provider shares, whether the server is mounted in this process, deployed
	 * beside it, or an OIDC issuer somebody else runs.
	 */
	auth(construct: Authenticator): RestApi<TName, TAuthorizers> {
		return new RestApi<TName, TAuthorizers>(
			this.id as ConstructName<TName>,
			this.config,
			[...this.dependencies, edgeTo(construct)],
			construct,
		);
	}

	/**
	 * Other surfaces this one calls.
	 *
	 * **Not `.dependsOn()`, and the difference matters.** An endpoint's
	 * `.dependsOn()` injects a client into that handler and grants it exactly
	 * what it named. This grants nothing and injects nothing: it records that
	 * this API calls another surface, which is what puts this API's origin on
	 * that surface's trusted-origin list.
	 *
	 * Spelling it `dependsOn` would invite the thing least privilege forbids —
	 * every route on the surface receiving whatever the surface named.
	 *
	 * Immutable, like every other builder here.
	 */
	calls(constructs: readonly Declarable[]): RestApi<TName, TAuthorizers> {
		return new RestApi<TName, TAuthorizers>(
			this.id as ConstructName<TName>,
			this.config,
			[...this.dependencies, ...constructs.map(edgeTo)],
			this.authenticator,
		);
	}

	/**
	 * One surface node, with its endpoints left to the build.
	 *
	 * The three provided keys are one fact about this surface and two about its
	 * callers. Declaring the caller-derived pair here rather than having the
	 * target invent them is what makes the contract checkable: a target that
	 * resolves no origins is caught against this list instead of being noticed
	 * when a browser is refused in production.
	 */
	declare(): Declaration[] {
		return [
			{
				kind: 'rest-api',
				id: this.id,
				path: this.config.path,
				...(this.config.subdomain ? { subdomain: this.config.subdomain } : {}),
				...(this.config.telescope ? { telescope: true } : {}),
				...(this.config.cors ? { cors: this.config.cors } : {}),
				...(this.authenticator ? { auth: this.authenticator.id } : {}),
				// Filled by the build, which already generates one handler per
				// endpoint and knows the path it wrote it to. A surface that
				// enumerates its own routes statically — an auth server's single
				// wildcard — puts them here instead.
				endpoints: [],
				...(this.dependencies.length ? { calls: this.dependencies } : {}),
				...(this.config.authorizers?.length
					? { authorizers: this.config.authorizers }
					: {}),
				defaultAuthorizer: this.config.defaultAuthorizer,
				provides: [
					this.keys.url,
					this.keys.trustedOrigins,
					this.keys.cookieDomain,
				],
			},
		];
	}
}
