/**
 * pnpm hooks for this workspace. Only `beforePacking`: it rewrites the
 * manifest `pnpm pack` and `pnpm publish` (which `changeset publish` runs)
 * write into the tarball, after the `workspace:` protocol has been turned into
 * a version range.
 *
 * Why: `@geekmidas/*@10.0.0` was published by mistake from the v9 branch, a
 * week before `10.0.0-alpha.148`. It is deprecated, but a deprecated version
 * still satisfies a range, and semver ranks `10.0.0` above every
 * `10.0.0-alpha.N`, so `^10.0.0-alpha.152` and `~10.0.0-alpha.152` both
 * resolve to it. Every published alpha named its siblings with such a range,
 * so installing the newest alpha installed the stray release beneath it
 * (#371).
 *
 * So while a package is a prerelease, each range on a sibling is capped below
 * the release it is a prerelease of: `^10.0.0-alpha.152` is published as
 * `>=10.0.0-alpha.152 <10.0.0`. Newer alphas still satisfy it; `10.0.0` does
 * not. A stable version is published untouched. This is the published
 * manifest only: changesets keeps reading `workspace:` ranges, so how it bumps
 * versions is unchanged.
 */

const { prereleaseRange } = require('./scripts/prerelease-range.cjs');

const FIELDS = [
	'dependencies',
	'peerDependencies',
	'optionalDependencies',
	'devDependencies',
];

function beforePacking(manifest) {
	for (const field of FIELDS) {
		const deps = manifest[field];
		if (!deps) continue;
		for (const [name, range] of Object.entries(deps)) {
			if (!name.startsWith('@geekmidas/')) continue;
			deps[name] = prereleaseRange(range);
		}
	}
	return manifest;
}

module.exports = { hooks: { beforePacking } };
