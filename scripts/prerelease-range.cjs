/**
 * A `^` or `~` range on a prerelease, capped below the release it precedes.
 *
 * `^10.0.0-alpha.152` admits `10.0.0`: semver ranks a release above every
 * prerelease of it, and a caret or tilde range allows anything above its
 * floor. When a release of that number exists that is not the one the
 * prerelease line leads to — `@geekmidas/*@10.0.0`, published by mistake from
 * the v9 branch (#371) — every such range resolves to it, deprecated or not.
 * `>=10.0.0-alpha.152 <10.0.0` admits every later alpha and not the release.
 *
 * Anything else — a stable version, an exact pin, a range of another shape —
 * is returned as it is.
 *
 * CommonJS, because `.pnpmfile.cjs` requires it.
 */

const PRERELEASE =
	/^([\^~])(\d+\.\d+\.\d+)-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)$/;

function prereleaseRange(range) {
	const match = PRERELEASE.exec(range);
	if (!match) return range;
	const [, , core, pre] = match;
	return `>=${core}-${pre} <${core}`;
}

/** Whether a published range on a prerelease still admits its release. */
function admitsRelease(range) {
	return PRERELEASE.test(range);
}

module.exports = { admitsRelease, prereleaseRange };
