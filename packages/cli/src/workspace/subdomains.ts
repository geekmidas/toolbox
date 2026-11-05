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
	hostLabels,
	isHostedDeclaration,
	isWildcardSite,
	type SiteDeclaration,
	WILDCARD_SUBDOMAIN,
} from '@geekmidas/manifest';
import { GkmError } from '../errors';
import { fileServerLabel } from './fileServerLabel.js';

/** A `protectedSubdomains` entry an app already answers on. */
export class ProtectedSubdomainIsAnApp extends GkmError {
	constructor(
		readonly subdomain: string,
		readonly app: string,
	) {
		super(
			`protectedSubdomains lists '${subdomain}', which '${app}' already ` +
				`answers on — a construct's own subdomain, aliases and redirects ` +
				`are protected without being listed. Remove it from ` +
				`protectedSubdomains.`,
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

/**
 * A file server whose host another construct already answers on.
 *
 * A file server answers on its own name — `FileServer('Assets')` on
 * `assets.<domain>` — so an app named `Assets` beside it would claim the same
 * host, and whichever deployed second would take it from the first.
 */
export class FileServerHostTaken extends GkmError {
	constructor(
		readonly fileServer: string,
		readonly subdomain: string,
		readonly app: string,
	) {
		super(
			`'${fileServer}' answers on '${subdomain}', which '${app}' answers on ` +
				`too, and two constructs cannot share a host. Rename one of them, ` +
				`or give '${app}' a subdomain of its own.`,
		);
		this.name = 'FileServerHostTaken';
	}
}

/**
 * Two apps that both answer on one label — an alias or a redirect of one is
 * the other's own label, or both list it. Found before anything is
 * deployed, rather than as the edge refusing the second host.
 */
export class HostLabelTaken extends GkmError {
	constructor(
		readonly label: string,
		readonly first: string,
		readonly second: string,
	) {
		super(
			`'${first}' and '${second}' both answer on '${label}', and two ` +
				`constructs cannot share a host. Remove it from one's aliases or ` +
				`redirects, or give one a subdomain of its own.`,
		);
		this.name = 'HostLabelTaken';
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
 * puts under the stage's domain: a surface's or site's `hostLabels` — its
 * own, its aliases and its redirects — each file server and its processors' origin, and each worker,
 * which SNS may push to on a host of its own.
 *
 * The root site's is kept although it answers on the domain itself: which
 * site is the root can change without a tenant's slug changing meaning. The
 * wildcard site has none — its labels are whatever is left.
 */
export function appSubdomains(
	manifest: ConstructManifest,
): Map<string, string> {
	return new Map(claimedLabels(manifest));
}

/** Each label a construct answers on, with that construct's id, in manifest order. */
function* claimedLabels(
	manifest: ConstructManifest,
): Generator<[label: string, id: string]> {
	for (const [id, declaration] of Object.entries(manifest)) {
		switch (declaration.kind) {
			case 'rest-api':
			case 'websocket-api':
			case 'site': {
				const labels = hostLabels(declaration);
				if (labels.primary !== WILDCARD_SUBDOMAIN) yield [labels.primary, id];
				for (const label of [...labels.aliases, ...labels.redirects]) {
					yield [label, id];
				}
				break;
			}
			case 'file-server':
				yield [fileServerLabel(id), id];
				if (declaration.processors?.length) {
					yield [`${fileServerLabel(id)}-processors`, id];
				}
				break;
			case 'worker':
				yield [appKey(id), id];
				break;
			// Its log UI's host, where a stage serves it publicly — claimed on
			// every stage, so no app or tenant takes it on one that does.
			case 'telemetry':
				yield [hostLabels(declaration).primary, id];
				break;
		}
	}
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
 * @throws {FileServerHostTaken} when a file server's host is another construct's
 * @throws {HostLabelTaken} when two apps answer on one label
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
		// Every endpoint is in the surface's node, as discovery nested it.
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

	assertLabelsUnique(manifest);

	const labels = appSubdomains(manifest);
	for (const subdomain of configured) {
		const app = labels.get(subdomain);
		if (app) throw new ProtectedSubdomainIsAnApp(subdomain, app);
	}
}

/**
 * Every label is one construct's. {@link appSubdomains} keeps one owner per
 * label, so the clash it would hide is found here, before either is
 * deployed: a file server's host — its own and its processors' origin — and
 * an app's aliases and redirects, against every other construct's labels.
 */
function assertLabelsUnique(manifest: ConstructManifest): void {
	const owners = new Map<string, string>();
	for (const [label, id] of claimedLabels(manifest)) {
		const other = owners.get(label);
		owners.set(label, id);
		if (other === undefined || other === id) continue;
		// Every `Telemetry` node is served by the stack's one log UI.
		if (
			manifest[id]?.kind === 'telemetry' &&
			manifest[other]?.kind === 'telemetry'
		) {
			continue;
		}
		if (manifest[id]?.kind === 'file-server') {
			throw new FileServerHostTaken(id, label, other);
		}
		if (manifest[other]?.kind === 'file-server') {
			throw new FileServerHostTaken(other, label, id);
		}
		// Two apps on one label: only an alias or a redirect can make one,
		// since each own label is the construct's id or a subdomain it chose —
		// or a log UI's, which no app's own label may be.
		if (
			aliased(manifest, id, label) ||
			aliased(manifest, other, label) ||
			manifest[id]?.kind === 'telemetry' ||
			manifest[other]?.kind === 'telemetry'
		) {
			throw new HostLabelTaken(label, other, id);
		}
	}
}

/** Whether a construct lists a label among its aliases or redirects. */
function aliased(
	manifest: ConstructManifest,
	id: string,
	label: string,
): boolean {
	const declaration = manifest[id];
	if (!isHostedDeclaration(declaration)) return false;
	const { aliases, redirects } = hostLabels(declaration);
	return aliases.includes(label) || redirects.includes(label);
}
