/**
 * The subdomains of a stage's domain, as a wildcard site sees them.
 *
 * A site declared `subdomain: '*'` answers on every label nothing else does,
 * so the labels something else does answer on are the ones a tenant can never
 * take. They come from two places and from nowhere else: every app's own
 * label, read off the constructs and never listed by hand, and the names no
 * construct declares (`www`, `mail`, `status`), listed once in the workspace
 * config as `protectedSubdomains`.
 */

import {
	kebabCase as appKey,
	type ConstructManifest,
	isWildcardSite,
	type SiteDeclaration,
	WILDCARD_SUBDOMAIN,
} from '@geekmidas/manifest';
import { GkmError } from '../errors';

/** A `protectedSubdomains` entry an app already answers on. */
export class ProtectedSubdomainIsAnApp extends GkmError {
	constructor(
		readonly subdomain: string,
		readonly app: string,
	) {
		super(
			`protectedSubdomains lists '${subdomain}', which '${app}' already ` +
				`answers on — a construct's own subdomain is protected without ` +
				`being listed. Remove it from protectedSubdomains.`,
		);
		this.name = 'ProtectedSubdomainIsAnApp';
	}
}

/** Two sites that both answer on every subdomain. */
export class SecondWildcardSite extends GkmError {
	constructor(readonly sites: readonly string[]) {
		super(
			`${sites.join(' and ')} both declare subdomain: '*', and two sites ` +
				`cannot share the same hosts. Keep one wildcard site per project; ` +
				`give the other a subdomain of its own.`,
		);
		this.name = 'SecondWildcardSite';
	}
}

/** A wildcard site whose `hosts` route is on no surface the project declares. */
export class SiteHostsEndpointMissing extends GkmError {
	constructor(
		readonly site: string,
		readonly surface: string,
		readonly path: string,
	) {
		super(
			`'${site}' checks its hosts with GET ${path} on '${surface}', but ` +
				`'${surface}' serves no such route. Export the endpoint from the ` +
				`surface's endpoints, or point \`hosts\` at one it serves.`,
		);
		this.name = 'SiteHostsEndpointMissing';
	}
}

/** The project's one wildcard site, or `undefined` when it has none. */
export function wildcardSite(
	manifest: ConstructManifest,
): SiteDeclaration | undefined {
	return Object.values(manifest).find(isWildcardSite);
}

/**
 * Every label an app answers on, by the app it belongs to — what a deploy
 * puts under the stage's domain: a surface's or site's `subdomain` (or its id
 * kebab-cased), each file server and its processors' origin, and each worker,
 * which SNS may push to on a host of its own.
 *
 * The root site's is kept although it answers on the domain itself: which
 * site is the root can change without a tenant's slug changing meaning. The
 * wildcard site has none — its labels are whatever is left.
 */
export function appSubdomains(
	manifest: ConstructManifest,
): Map<string, string> {
	const labels = new Map<string, string>();
	for (const [id, declaration] of Object.entries(manifest)) {
		switch (declaration.kind) {
			case 'rest-api':
			case 'websocket-api':
				labels.set(declaration.subdomain ?? appKey(id), id);
				break;
			case 'site':
				if (declaration.subdomain === WILDCARD_SUBDOMAIN) break;
				labels.set(declaration.subdomain ?? appKey(id), id);
				break;
			case 'file-server':
				labels.set(appKey(id), id);
				if (declaration.processors?.length) {
					labels.set(`${appKey(id)}-processors`, id);
				}
				break;
			case 'worker':
				labels.set(appKey(id), id);
				break;
		}
	}
	return labels;
}

/**
 * The labels no tenant may take: every app's own and the workspace's
 * `protectedSubdomains`, sorted.
 */
export function protectedSubdomains(
	manifest: ConstructManifest,
	configured: readonly string[] = [],
): string[] {
	return [
		...new Set([...appSubdomains(manifest).keys(), ...configured]),
	].sort();
}

/**
 * What a project's subdomains have to satisfy before anything is derived
 * from them.
 *
 * @throws {SecondWildcardSite} when two sites declare `subdomain: '*'`
 * @throws {SiteHostsEndpointMissing} when the wildcard site's `hosts` route is not served
 * @throws {ProtectedSubdomainIsAnApp} when `protectedSubdomains` repeats an app's own
 */
export function assertSubdomains(
	manifest: ConstructManifest,
	configured: readonly string[] = [],
): void {
	const wildcards = Object.values(manifest).filter(isWildcardSite);
	if (wildcards.length > 1) {
		throw new SecondWildcardSite(wildcards.map((site) => site.id).sort());
	}

	const site = wildcards[0];
	if (site?.hosts) {
		const surface = manifest[site.hosts.surface];
		const served =
			surface?.kind === 'rest-api' &&
			surface.endpoints.some(
				(endpoint) =>
					endpoint.method.toUpperCase() === 'GET' &&
					endpoint.path === site.hosts?.path,
			);
		if (!served) {
			throw new SiteHostsEndpointMissing(
				site.id,
				site.hosts.surface,
				site.hosts.path,
			);
		}
	}

	const labels = appSubdomains(manifest);
	for (const subdomain of configured) {
		const app = labels.get(subdomain);
		if (app) throw new ProtectedSubdomainIsAnApp(subdomain, app);
	}
}
