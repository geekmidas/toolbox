import {
	type ConstructManifest,
	type MobileAppDeclaration,
	PUBLIC_PREFIX,
	providedKeyFor,
	provideKey,
	publicEnvFor,
	type SiteDeclaration,
} from '@geekmidas/manifest';
import { appKey } from '../workspace/derive.js';

/**
 * What a site's image is built with — or a mobile app's EAS build: every
 * value its build reads, resolved for the stage, and so every `ARG` a site's
 * Dockerfile declares.
 *
 * - **Its edges' public values and its own address**, under the variant's
 *   public prefix (`publicEnvFor`): what the bundler inlines.
 * - **Its own address under its own name** (`WEB_URL`). Server code runs at
 *   build too — `next build` prerenders, and a page's `metadataBase` is read
 *   then — and `gkm exec -- next build` has it locally, so the image build
 *   must, or a site that builds locally fails in CI. A mobile app has no
 *   address: its own value is its scheme (`APP_SCHEME`), which its
 *   `app.config.ts` reads when EAS builds it.
 * - **Every stage secret already named for the bundle**: a key carrying the
 *   variant's public prefix (`NEXT_PUBLIC_APP_STORE_URL` on a `next` site) was
 *   declared public by whoever named it, so it is passed. Anything else is
 *   not: a secret without the prefix never reaches a site's build.
 *
 * A value the stage resolves to nothing is left out rather than passed empty.
 * A derived value wins over a stage secret of the same name: the site's
 * addresses are the construct's, not a copy someone set.
 */
export function publicBuildValues(
	site: SiteDeclaration | MobileAppDeclaration,
	manifest: ConstructManifest,
	resolve: (key: string) => string | undefined,
	secrets: Readonly<Record<string, string>>,
): Record<string, string> {
	const args: Record<string, string> = {};

	const own = provideKey(site.id, site.kind === 'site' ? 'url' : 'scheme');
	const ownValue = resolve(own);
	if (ownValue) args[own] = ownValue;

	for (const [key, source] of Object.entries(publicEnvFor(site, manifest))) {
		const value = resolve(source);
		if (value) args[key] = value;
	}

	const prefix = PUBLIC_PREFIX[site.variant];
	for (const [key, value] of Object.entries(secrets)) {
		if (key.startsWith(prefix) && args[key] === undefined && value) {
			args[key] = value;
		}
	}

	return args;
}

/**
 * Where a site's own hosts point during its image build: this loopback
 * address, on which nothing in a build container listens — so a request to
 * one is refused at once instead of waiting on a host that is not up yet.
 */
export const OFFLINE_BUILD_ADDRESS = '127.0.0.1';

/**
 * The hosts a site's image build must not wait on: its own and those of the
 * constructs its `.dependsOn()` names, as this stage serves them.
 *
 * None of them answers while the image is built — the stack the site belongs
 * to is started after it — and a fetch to a public host that does not answer
 * yet can stall until the framework's prerender limit (Next's 60s). Mapped to
 * {@link OFFLINE_BUILD_ADDRESS} in the build's `/etc/hosts`, each is refused
 * at once, and the page renders on its first request instead.
 *
 * The mapping is the build's only: the URLs the bundle inlines are the real
 * ones, and the running container resolves them as anything else does. A
 * stage secret named for the bundle is someone else's host (an analytics
 * service, a store) and is left alone, as are `localhost` and an address.
 *
 * None for a site that pre-renders against its stage (`prerender: 'stage'`):
 * it is built once those hosts answer, and has to reach them.
 */
export function offlineBuildHosts(
	site: SiteDeclaration,
	manifest: ConstructManifest,
	resolve: (key: string) => string | undefined,
): string[] {
	if (site.prerender === 'stage') return [];
	const sources = [
		provideKey(site.id, 'url'),
		...Object.values(publicEnvFor(site, manifest)),
	];
	const hosts = new Set<string>();
	for (const source of sources) {
		const host = hostOf(resolve(source));
		if (host) hosts.add(host);
	}
	return [...hosts].sort();
}

/** A URL's host, where it is a name `/etc/hosts` can map. */
function hostOf(value: string | undefined): string | undefined {
	if (!value || !URL.canParse(value)) return undefined;
	const { protocol, hostname } = new URL(value);
	if (!/^(https?|wss?):$/.test(protocol)) return undefined;
	// A wildcard is no one name: `/etc/hosts` maps names, not patterns.
	if (hostname === 'localhost' || hostname.includes('*')) return undefined;
	// An address is reached as it is; only a name is looked up.
	if (/^[\d.]+$/.test(hostname) || hostname.startsWith('[')) return undefined;
	return hostname;
}

/**
 * {@link offlineBuildHosts} for a target that knows each app's public URL by
 * its app key rather than by construct key — the site's own, and each app it
 * calls. None, for an app that declares no site.
 */
export function siteOfflineHosts(
	manifest: ConstructManifest,
	appName: string,
	ownUrl: string,
	urls: Readonly<Record<string, string>>,
): string[] {
	const entries = Object.entries(manifest);
	const site = entries.find(
		([id, d]) => d.kind === 'site' && appKey(id) === appName,
	)?.[1];
	if (site?.kind !== 'site') return [];

	const byKey = new Map<string, string>();
	for (const [id] of entries) {
		const name = appKey(id);
		const url = name === appName ? ownUrl : urls[name];
		if (url) byKey.set(providedKeyFor(id, manifest[id]!.kind, 'url'), url);
	}
	return offlineBuildHosts(site, manifest, (key) => byKey.get(key));
}

/**
 * Whether a site runs a server of its own — Next's, TanStack Start's — which
 * reads an environment at runtime as a backend does: its edges' public URLs
 * and the stage's secrets. A `static` site is a finished bundle, and reads
 * nothing once it is built.
 */
export function runsServer(site: Pick<SiteDeclaration, 'variant'>): boolean {
	return site.variant !== 'static';
}
