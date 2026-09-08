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
 *   default: 'session',
 * });
 * ```
 */

import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { DEFAULT_LOGGER } from '@geekmidas/logger/console';
import {
	type AppSpec,
	type ConstructName,
	canonicalId,
	type Declaration,
	type Dependency,
	provideKey,
} from '@geekmidas/manifest';
import { type Declarable, edgeTo } from './construct-interface';
import { EndpointFactory } from './endpoints/EndpointFactory';
import { envParserFor } from './endpoints/surfaceEnv';

export interface RestApiConfig {
	/**
	 * The app that serves this surface: where its source lives, which globs
	 * find its code, how it is run.
	 *
	 * What makes a surface a deploy unit rather than something a deploy has to
	 * be told about separately: one `RestApi` is one server. A `StaticSite` says
	 * the same thing, and the two are the same kind of statement.
	 *
	 * Omit it and this surface has no process of its own — it is served by the
	 * surface that named it as its authenticator. An auth server usually wants
	 * exactly that until it is worth its own container, at which point giving it
	 * an `app` is the whole change.
	 */
	app?: AppSpec;
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
	authorizers?: readonly string[];
	/**
	 * The authorizer applied to an endpoint that names none.
	 *
	 * Required, and `'none'` is a valid answer that has to be typed out. The
	 * alternative is an API that ships open because a field was left off, which
	 * is the one default worth refusing to have.
	 */
	default: string;
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
	envParser?: unknown;
}

/**
 * What is *not* here, and why.
 *
 * `dependsOn`, `database`, `auditor` and `publisher` all inject a capability
 * into a handler. Putting one on the surface hands it to every route the
 * surface serves — a health check gets the database because a report needed it
 * — which is the thing least privilege forbids and the reason `.calls()` is not
 * spelled `dependsOn`. They belong to the endpoint, or to a factory branched
 * from `api.endpoints` for a group of endpoints that genuinely share them.
 *
 * `auth` is not here either: `.auth(construct)` already declares it, and a
 * second way to say the same thing is the duplication this whole model removes.
 *
 * What is left is what the *process* is rather than what a route may reach.
 */

export class RestApi<TName extends string = string>
	implements Declarable<TName>
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

	constructor(
		id: ConstructName<TName>,
		private readonly config: RestApiConfig,
		/** Internal: how `.calls()` carries edges into the copy it returns. */
		private readonly dependencies: readonly Dependency[] = [],
		/** Internal: how `.auth()` carries the authenticator into its copy. */
		private readonly authenticator?: string,
	) {
		const canonical = canonicalId(id as string);

		this.id = canonical as TName;

		this.keys = {
			url: provideKey(canonical, 'url'),
			trustedOrigins: provideKey(canonical, 'trustedOrigins'),
			cookieDomain: provideKey(canonical, 'cookieDomain'),
		};

		this.logger = config.logger ?? DEFAULT_LOGGER;
		this.envParser = envParserFor(
			config.envParser
				? { id: canonical, envParser: config.envParser }
				: undefined,
		);

		this.endpoints = new EndpointFactory({
			defaultLogger: this.logger,
			...(config.authorizers
				? {
						availableAuthorizers: config.authorizers.map((name) => ({ name })),
					}
				: {}),
			...(config.default && config.default !== 'none'
				? { defaultAuthorizerName: config.default }
				: {}),
			surface: { id: this.id, envParser: this.envParser },
		});
	}

	/**
	 * This surface's endpoint factory.
	 *
	 * `api.get('/users')` is the short form and covers most routes. Reach for
	 * this one when a *group* of endpoints shares something a single route would
	 * otherwise repeat — a database, an auditor, a publisher:
	 *
	 * ```ts
	 * const audited = api.endpoints.database(db).auditor(AuditStore);
	 * export const createUser = audited.post('/users').handle(...);
	 * ```
	 *
	 * A factory branched from here keeps the surface, so its endpoints still
	 * know which API serves them. That is deliberately narrower than putting the
	 * same thing in the surface's own config: a group opts in, where a surface
	 * would grant it to every route it serves.
	 */
	readonly endpoints: EndpointFactory<[], '', Logger>;

	/** `api.get('/users')` — sugar for `api.endpoints.get('/users')`. */
	get<TPath extends string>(path: TPath) {
		return this.endpoints.get(path);
	}

	post<TPath extends string>(path: TPath) {
		return this.endpoints.post(path);
	}

	put<TPath extends string>(path: TPath) {
		return this.endpoints.put(path);
	}

	patch<TPath extends string>(path: TPath) {
		return this.endpoints.patch(path);
	}

	delete<TPath extends string>(path: TPath) {
		return this.endpoints.delete(path);
	}

	options<TPath extends string>(path: TPath) {
		return this.endpoints.options(path);
	}

	/**
	 * What authenticates this surface.
	 *
	 * An edge like `.calls()` — the auth server learns this origin, and the two
	 * share a cookie domain — but a named one, because *who authenticates me* is
	 * a different fact from *who I happen to call*, and only one of them decides
	 * what a request is allowed to be. A surface with two of the first is a
	 * mistake; two of the second is Tuesday.
	 *
	 * It records the id, not a client. Every endpoint consumes the same thing —
	 * `verify(request) → Session | null` — and that is what every provider
	 * shares, whether the server is mounted in this process, deployed beside it,
	 * or an OIDC issuer somebody else runs.
	 */
	auth(construct: Declarable): RestApi<TName> {
		return new RestApi<TName>(
			this.id as ConstructName<TName>,
			this.config,
			[...this.dependencies, edgeTo(construct)],
			construct.id,
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
	calls(constructs: readonly Declarable[]): RestApi<TName> {
		return new RestApi<TName>(
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
				...(this.config.app ? { app: this.config.app } : {}),
				...(this.config.cors ? { cors: this.config.cors } : {}),
				...(this.authenticator ? { auth: this.authenticator } : {}),
				// Filled by the build, which already generates one handler per
				// endpoint and knows the path it wrote it to. A surface that
				// enumerates its own routes statically — an auth server's single
				// wildcard — puts them here instead.
				endpoints: [],
				...(this.dependencies.length ? { calls: this.dependencies } : {}),
				...(this.config.authorizers?.length
					? { authorizers: this.config.authorizers }
					: {}),
				defaultAuthorizer: this.config.default,
				provides: [
					this.keys.url,
					this.keys.trustedOrigins,
					this.keys.cookieDomain,
				],
			},
		];
	}
}
