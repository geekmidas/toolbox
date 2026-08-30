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
 *   routes: 'src/routes/**\/*.ts',
 *   authorizers: ['session'],
 *   default: 'session',
 * });
 * ```
 */

import {
	type ConstructName,
	canonicalId,
	type Declaration,
	type Dependency,
	provideKey,
} from '@geekmidas/manifest';
import { type Declarable, edgeTo } from './construct-interface';

export interface RestApiConfig {
	/**
	 * Where this surface's routes live, as globs relative to the app root.
	 *
	 * A glob rather than an array of endpoints because the construct cannot
	 * import them: route modules import services, which import clients, which is
	 * a runtime graph the build has no business evaluating in order to answer
	 * "what paths exist". The build already walks these files; this says which
	 * surface they belong to.
	 */
	routes?: string | readonly string[];
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
}

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

	private readonly routes: readonly string[];

	constructor(
		id: ConstructName<TName>,
		private readonly config: RestApiConfig,
		/** Internal: how `.calls()` carries edges into the copy it returns. */
		private readonly dependencies: readonly Dependency[] = [],
	) {
		const canonical = canonicalId(id as string);

		this.id = canonical as TName;
		this.routes =
			typeof config.routes === 'string'
				? [config.routes]
				: (config.routes ?? []);

		this.keys = {
			url: provideKey(canonical, 'url'),
			trustedOrigins: provideKey(canonical, 'trustedOrigins'),
			cookieDomain: provideKey(canonical, 'cookieDomain'),
		};
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
		return new RestApi<TName>(this.id as ConstructName<TName>, this.config, [
			...this.dependencies,
			...constructs.map(edgeTo),
		]);
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
				endpoints: [],
				...(this.dependencies.length ? { calls: this.dependencies } : {}),
				...(this.routes.length ? { routes: this.routes } : {}),
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
