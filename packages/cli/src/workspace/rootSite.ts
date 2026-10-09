/**
 * Which site the base domain points at — deployed and locally alike.
 *
 * Three rules, in order, and the last one is the point:
 *
 * 1. **One site** — it is the root. Unambiguous, so nothing has to be said.
 * 2. **Named `web`** — the convention wins, because people already rely on it.
 * 3. **Declared `root: true`** — the site says so itself.
 *
 * Anything else throws. It used to take the *first* site it iterated, and that
 * order came from the manifest, which is built in glob traversal order — so two
 * sites with neither named `web` meant renaming a file could move the root
 * domain, silently.
 *
 * One rule for both targets: deployed the root site gets the base domain, and
 * locally it gets the project's bare host behind the edge. Before this was
 * shared, the local edge put every site on a subdomain, so what a developer
 * browsed was not the shape production served.
 *
 * @returns the root site's name, or `undefined` when there are no sites
 * @throws {AmbiguousRootSite} when several sites could be the root and none says it is
 */

import { GkmError } from '../errors';
export function rootSite(
	sites: readonly { name: string; root?: boolean }[],
): string | undefined {
	if (sites.length === 0) return undefined;

	// 1. The only site there is.
	if (sites.length === 1) return sites[0]!.name;

	// 2. The convention.
	if (sites.some(({ name }) => name === 'web')) return 'web';

	// 3. What a site declared about itself.
	const declared = sites.filter(({ root }) => root === true);
	if (declared.length === 1) return declared[0]!.name;

	throw new AmbiguousRootSite(
		sites.map(({ name }) => name),
		declared.length > 1,
	);
}

/** Several sites could hold the base domain, and none of them says it does. */
export class AmbiguousRootSite extends GkmError {
	constructor(
		readonly sites: readonly string[],
		readonly tooMany = false,
	) {
		super(
			tooMany
				? `More than one site declares \`root: true\` — ${sites.join(', ')}. ` +
						`The base domain points at one of them.`
				: `${sites.length} sites and nothing says which holds the base ` +
						`domain: ${sites.join(', ')}. Name one of them \`web\`, or ` +
						`declare \`root: true\` on the one the base domain points at. ` +
						`It used to be whichever the glob reached first, which is not a ` +
						`thing to decide a hostname.`,
		);
		this.name = 'AmbiguousRootSite';
	}
}
