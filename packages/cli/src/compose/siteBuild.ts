import {
	type ConstructManifest,
	type MobileAppDeclaration,
	PUBLIC_PREFIX,
	provideKey,
	publicEnvFor,
	type SiteDeclaration,
} from '@geekmidas/manifest';

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
