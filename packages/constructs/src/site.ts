/**
 * `StaticSite` — a frontend, declared like anything else.
 *
 * The point is not that a site needs provisioning; it is that a site is the
 * *consumer* whose edges make four hand-maintained lists derivable. Declaring it
 * is what turns "which origins does the API allow" from something a person keeps
 * in step into something the graph already knows.
 *
 * ```ts
 * export const console = new StaticSite('Console', { path: 'apps/console' })
 *   .dependsOn([api, auth]);
 * ```
 *
 * It has no `.service`. A site is not a process that registers clients — it is
 * built, and the values it needs are inlined or fetched by its own framework —
 * so the edge is {@link Declarable} rather than {@link Consumable}, and the
 * asymmetry is the honest one: a site consumes addresses, not connections.
 *
 * Only the static variant ships. SSR deploy shapes are unstable and each one is
 * its own maintenance, so they follow rather than arrive together. A mobile app
 * is not a site — it is reached by a scheme, not a URL — and is its own
 * construct: see `MobileApp`.
 */

import {
	type ConstructName,
	canonicalId,
	type Declaration,
	type Dependency,
	provideKey,
	type SiteDeclaration,
	WILDCARD_SUBDOMAIN,
} from '@geekmidas/manifest';
import { type Declarable, edgeTo } from './construct-interface';
import type { Telemetry } from './telemetry';

/**
 * Where a site's source lives, and the little else a layout can differ by.
 *
 * Only `path` is required: `new StaticSite('Web', { path: 'apps/web' })` is a
 * complete site.
 */
export interface StaticSiteConfig {
	/**
	 * Where its source lives, relative to the workspace root — `'apps/web'`.
	 *
	 * Required, the same field `RestApi` and `BetterAuth` take. It was
	 * inferred from the id, which made a site's home whatever was on disk.
	 */
	path: string;
	/**
	 * The label it answers on under a stage's domain — `api` for
	 * `api.myapp.com`, from `domains` — and under the project locally,
	 * `api.myapp.localhost`. Absent, its id kebab-cased.
	 *
	 * `'*'` answers on every subdomain nothing else does — one host per
	 * tenant, `acme.myapp.com` — and then `hosts` names which of them are
	 * real. Every other app keeps its own host, and a project has at most one
	 * such site.
	 */
	subdomain?: string;
	/**
	 * With `subdomain: '*'`, the route that says which hosts are tenants: an
	 * exported `GET` endpoint the edge asks before it serves a host,
	 * `?domain=<host>`, answering `200` for a tenant and `404` otherwise.
	 *
	 * It runs without a session and belongs to no public API.
	 */
	hosts?: SiteHostsEndpoint;
	/**
	 * The port it answers on locally.
	 *
	 * Normally omitted: ports are assigned in a stable order, so adding a site
	 * does not renumber the ones already running.
	 */
	port?: number;
	/**
	 * Modules to import when sniffing which env vars this site reads.
	 *
	 * A frontend's values are inlined at build time, so the build has to know
	 * which ones it reads before it reads them.
	 */
	config?: { client?: string; server?: string };
	/**
	 * Whether the base domain points at this site.
	 *
	 * A project with one site needs this no more than a project with one
	 * database needs to say which database. It matters when there are several
	 * and none is called `web`: the base domain then belongs to whichever site
	 * says so, rather than to whichever file the glob happened to reach first.
	 */
	root?: boolean;
	/**
	 * Which framework builds it.
	 *
	 * It selects how values are delivered — `VITE_`, `NEXT_PUBLIC_`, a fetched
	 * `config.json` — and never which values there are. One neutral name from the
	 * construct, one serialisation per framework, the same rule as everywhere
	 * else.
	 */
	variant?: SiteDeclaration['variant'];
	/**
	 * What the site emits — the `Telemetry` construct. An edge to the node and
	 * nothing more for now: a site is handed none of its server keys, and the
	 * browser half (propagation from the generated client, then a browser SDK
	 * exporting through the API) builds on this edge.
	 */
	telemetry?: Telemetry;
}

/**
 * The shape of the endpoint `hosts` names — read structurally, so a site
 * module never loads the endpoint machinery to say which route it means.
 */
export interface SiteHostsEndpoint {
	route: string;
	method: string;
	surface: { id: string };
}

/** `subdomain: '*'` without `hosts`: nothing would say which hosts are tenants. */
export class WildcardSiteNeedsHosts extends Error {
	constructor(readonly id: string) {
		super(
			`'${id}' answers on every subdomain, so it has to say which of them ` +
				`are tenants: pass \`hosts\`, a GET endpoint answering 200 for a ` +
				`host it serves and 404 otherwise.`,
		);
		this.name = 'WildcardSiteNeedsHosts';
	}
}

/** `hosts` on a site with one host, where there is nothing to check. */
export class SiteHostsNeedsWildcard extends Error {
	constructor(readonly id: string) {
		super(
			`'${id}' names a \`hosts\` check but answers on one host. ` +
				`Declare \`subdomain: '*'\` to serve every subdomain, or drop \`hosts\`.`,
		);
		this.name = 'SiteHostsNeedsWildcard';
	}
}

/** A `hosts` endpoint that is not a `GET`: the edge only ever asks with one. */
export class SiteHostsNotGet extends Error {
	constructor(
		readonly id: string,
		readonly method: string,
		readonly route: string,
	) {
		super(
			`'${id}' checks its hosts with ${method} ${route}, but the edge asks ` +
				`with GET ${route}?domain=<host>. Make it a GET endpoint.`,
		);
		this.name = 'SiteHostsNotGet';
	}
}

/** A wildcard site that says it holds the base domain. */
export class WildcardSiteCannotBeRoot extends Error {
	constructor(readonly id: string) {
		super(
			`'${id}' answers on every subdomain, so it cannot also hold the base ` +
				`domain. Drop \`root: true\`, and declare the site the base domain ` +
				`points at separately.`,
		);
		this.name = 'WildcardSiteCannotBeRoot';
	}
}

export class StaticSite<TName extends string = string>
	implements Declarable<TName>
{
	readonly id: TName;
	readonly keys: { url: string };

	constructor(
		id: ConstructName<TName>,
		private readonly config: StaticSiteConfig,
		/**
		 * Internal: how `.dependsOn()` carries edges into the copy it returns.
		 * Written as a parameter rather than a mutable field so the builder can
		 * stay immutable without a clone method, the same shape
		 * `KyselyDatabase` uses for its derived forms.
		 */
		private readonly dependencies: readonly Dependency[] = [],
	) {
		this.id = canonicalId(id as string) as TName;
		this.keys = { url: provideKey(this.id, 'url') };

		const wildcard = config.subdomain === WILDCARD_SUBDOMAIN;
		if (wildcard && !config.hosts) throw new WildcardSiteNeedsHosts(this.id);
		if (!wildcard && config.hosts) throw new SiteHostsNeedsWildcard(this.id);
		if (wildcard && config.root) throw new WildcardSiteCannotBeRoot(this.id);
		if (config.hosts && config.hosts.method.toUpperCase() !== 'GET') {
			throw new SiteHostsNotGet(
				this.id,
				config.hosts.method,
				config.hosts.route,
			);
		}
	}

	/**
	 * What this site calls.
	 *
	 * Immutable, like every other builder here: it returns a new site rather than
	 * mutating this one, so a module that exports both a base and a variant of it
	 * cannot have the second silently change the first.
	 *
	 * Takes {@link Declarable} rather than {@link Consumable} because a site's
	 * edge is a build-time link and not a service injection — requiring a client
	 * would exclude exactly the surfaces a frontend actually depends on.
	 */
	dependsOn(constructs: readonly Declarable[]): StaticSite<TName> {
		return new StaticSite<TName>(this.id as ConstructName<TName>, this.config, [
			...this.dependencies,
			...constructs.map(edgeTo),
		]);
	}

	declare(): Declaration[] {
		const { hosts } = this.config;
		return [
			{
				kind: 'site',
				id: this.id,
				variant: this.config.variant ?? 'static',
				...(this.config.subdomain ? { subdomain: this.config.subdomain } : {}),
				...(hosts
					? {
							hosts: {
								surface: canonicalId(hosts.surface.id),
								path: hosts.route,
							},
						}
					: {}),
				app: {
					path: this.config.path,
					...(this.config.port ? { port: this.config.port } : {}),
					...(this.config.config ? { config: this.config.config } : {}),
				},
				...(this.config.root ? { root: true } : {}),
				dependencies: this.dependencies,
				...(this.config.telemetry
					? { telemetry: this.config.telemetry.id }
					: {}),
				provides: [
					this.keys.url,
					...(hosts
						? [
								provideKey(this.id, 'domain'),
								provideKey(this.id, 'protectedSubdomains'),
							]
						: []),
				],
			},
		];
	}
}
