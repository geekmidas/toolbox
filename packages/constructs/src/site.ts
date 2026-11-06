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
 * A site consumes addresses, not connections: it is built, and the values it
 * needs are inlined or fetched by its own framework, so its own edges take any
 * {@link Declarable}. Its `.service` is its public address — what a worker's
 * cron or an endpoint that builds links to it reads:
 *
 * ```ts
 * export const digest = worker
 *   .cron('rate(1 day)')
 *   .dependsOn([web])
 *   .handle(async ({ services }) => link(services.web, '/inbox'));
 * ```
 *
 * Only the static variant ships. SSR deploy shapes are unstable and each one is
 * its own maintenance, so they follow rather than arrive together. A mobile app
 * is not a site — it is reached by a scheme, not a URL — and is its own
 * construct: see `MobileApp`.
 */

import {
	assertHostLabels,
	type ConstructName,
	canonicalId,
	type Declaration,
	type Dependency,
	providedKeyFor,
	type SiteDeclaration,
	serviceKey,
	WILDCARD_SUBDOMAIN,
} from '@geekmidas/manifest';

/** Thrown at construction for an alias or redirect that cannot be a host label. */
export {
	HostLabelBothAliasAndRedirect,
	InvalidHostLabel,
	WildcardSiteCannotHaveAliases,
} from '@geekmidas/manifest';

import type { Service } from '@geekmidas/services';
import {
	type Construct,
	type Declarable,
	frontendEdgeTo,
	publicUrl,
} from './construct-interface';
import type { RandomPassword } from './random-password';
import type { DeployedStage } from './stages';
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
	 * More labels it answers on under the stage's domain, exactly as on its
	 * own: each a host the site really serves, and an origin every surface it
	 * depends on trusts. Its own host stays canonical (`<ID>_URL`).
	 */
	aliases?: readonly string[];
	/**
	 * Labels that answer with a permanent (301) redirect to its own host,
	 * path and query kept — `['www']` sends `www.myapp.com` to `myapp.com`.
	 * Nothing answers on a host unless a construct names it, so there is no
	 * automatic `www`. Sites only: an API client does not reliably follow a
	 * redirect on a `POST`.
	 */
	redirects?: readonly string[];
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
	/**
	 * A login the site is served behind on the stages named, so a staging
	 * build is not public while it is tried.
	 *
	 * ```ts
	 * export const sitePassword = new RandomPassword('SitePassword');
	 *
	 * export const web = new StaticSite('Web', {
	 *   path: 'apps/web',
	 *   password: { secret: sitePassword, stages: ['staging'] },
	 * });
	 * ```
	 *
	 * The edge asks for it with HTTP basic auth before a request reaches the
	 * site: the user is the stage's name, the password the `RandomPassword`'s
	 * value on that stage. Like any `RandomPassword` it is generated on the
	 * first deploy and kept, and one set by hand wins. It is not an edge — the
	 * site is handed none of it — so export it from a constructs file of its
	 * own, as any construct is.
	 *
	 * The compose target alone serves it so far; another refuses the stage
	 * rather than serving it publicly.
	 */
	password?: {
		secret: RandomPassword;
		stages: readonly [DeployedStage, ...DeployedStage[]];
	};
	/**
	 * `'stage'` for a `static` site that pre-renders data at build time
	 * (vite-ssg and similar): its build fetches from the APIs it
	 * `.dependsOn()`, and bakes their answers into its files.
	 *
	 * ```ts
	 * new StaticSite('Web', {
	 *   path: 'apps/web',
	 *   variant: 'static',
	 *   prerender: 'stage',
	 * }).dependsOn([api]);
	 * ```
	 *
	 * The deploy then builds the site only once those APIs are up and
	 * healthy on the stage, and the build reaches them at their public
	 * addresses, as a browser would. Without it, a site is built offline,
	 * before its stage runs (`GKM_BUILD_OFFLINE=1`), and nothing at runtime
	 * can fill a page built without its data.
	 *
	 * Opt-in, because the image then holds that stage's data: the same commit
	 * builds a different image per stage, and `gkm compose --build --push`
	 * needs the stage it builds for already running.
	 */
	prerender?: 'stage';
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

/**
 * `prerender: 'stage'` on a site that renders its pages on a server, where a
 * page renders on its first request — which the deploy's warm-up makes — and
 * needs no data at build.
 */
export class PrerenderNeedsStaticSite extends Error {
	constructor(
		readonly id: string,
		readonly variant: SiteDeclaration['variant'],
	) {
		super(
			`'${id}' is a '${variant}' site, which renders its pages on its own ` +
				`server, so it never needs its APIs at build: drop \`prerender\`, ` +
				`and render data-backed pages on request (the deploy warms them). ` +
				`\`prerender: 'stage'\` is for a 'static' site that bakes data into ` +
				`its files.`,
		);
		this.name = 'PrerenderNeedsStaticSite';
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
	implements Declarable<TName>, Construct<TName, string>
{
	readonly id: TName;
	readonly keys: { url: string };

	/**
	 * Its public address, `https://web.example.com` — a string, no await. The
	 * same `<ID>_URL` on every command and stage, so a link built from it opens
	 * in a browser.
	 */
	readonly service: Service<Uncapitalize<TName>, string>;

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
		this.keys = { url: providedKeyFor(this.id, 'site', 'url') };
		// A field, not a getter: consumers cache services by object identity.
		this.service = {
			serviceName: serviceKey(this.id) as Uncapitalize<TName>,
			register: (options) => publicUrl(options, this.keys.url),
		};

		const wildcard = config.subdomain === WILDCARD_SUBDOMAIN;
		if (wildcard && !config.hosts) throw new WildcardSiteNeedsHosts(this.id);
		if (!wildcard && config.hosts) throw new SiteHostsNeedsWildcard(this.id);
		if (wildcard && config.root) throw new WildcardSiteCannotBeRoot(this.id);
		assertHostLabels({
			id: this.id,
			...(config.subdomain ? { subdomain: config.subdomain } : {}),
			...(config.aliases ? { aliases: config.aliases } : {}),
			...(config.redirects ? { redirects: config.redirects } : {}),
		});
		const variant = config.variant ?? 'static';
		if (config.prerender && variant !== 'static') {
			throw new PrerenderNeedsStaticSite(this.id, variant);
		}
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
	 *
	 * A plain edge to a `FileServer` is to its public face: the site is built
	 * with the address its objects are served on, and handed nothing that
	 * writes to the bucket. A plain edge to an `ObjectStorage` is to where its
	 * links are signed (`<PREFIX><T>_SIGNED_ORIGIN`), and to nothing else of
	 * it. `.dependsOn([assets.server])` or `.dependsOn([documents.server])`
	 * asks for the bucket and its credentials too, for a server half that
	 * uploads or presigns.
	 */
	dependsOn(constructs: readonly Declarable[]): StaticSite<TName> {
		return new StaticSite<TName>(this.id as ConstructName<TName>, this.config, [
			...this.dependencies,
			...constructs.map(frontendEdgeTo),
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
				...(this.config.aliases?.length
					? { aliases: [...this.config.aliases] }
					: {}),
				...(this.config.redirects?.length
					? { redirects: [...this.config.redirects] }
					: {}),
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
				...(this.config.password
					? {
							password: {
								secret: this.config.password.secret.id,
								stages: [...this.config.password.stages],
							},
						}
					: {}),
				...(this.config.prerender ? { prerender: this.config.prerender } : {}),
				provides: [
					this.keys.url,
					...(hosts
						? [
								providedKeyFor(this.id, 'site', 'domain'),
								providedKeyFor(this.id, 'site', 'protectedSubdomains'),
							]
						: []),
				],
			},
		];
	}
}
