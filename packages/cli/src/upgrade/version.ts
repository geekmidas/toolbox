/**
 * Just enough semver for `gkm upgrade`: ordering versions, and reading the
 * floor out of a simple range. The same ordering the release pipeline uses to
 * decide what is published (`scripts/release-state.mjs`).
 */

const VERSION = /(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/;

interface Parsed {
	core: [number, number, number];
	ids: (string | number)[];
}

function parse(version: string): Parsed | undefined {
	const match = version.match(VERSION);
	if (!match) return undefined;
	const [, major, minor, patch, pre] = match;
	return {
		core: [Number(major), Number(minor), Number(patch)],
		ids: pre
			? pre.split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id))
			: [],
	};
}

/** Negative, zero or positive, as `a` is below, equal to or above `b`. */
export function compareVersions(a: string, b: string): number {
	const x = parse(a);
	const y = parse(b);
	if (!x || !y) return 0;

	for (let i = 0; i < 3; i++) {
		if (x.core[i] !== y.core[i]) return x.core[i]! - y.core[i]!;
	}
	// A release outranks any prerelease of the same version.
	if (!x.ids.length || !y.ids.length) return y.ids.length - x.ids.length;
	for (let i = 0; i < Math.max(x.ids.length, y.ids.length); i++) {
		const p = x.ids[i];
		const q = y.ids[i];
		if (p === undefined) return -1;
		if (q === undefined) return 1;
		if (p === q) continue;
		if (typeof p === 'number' && typeof q === 'number') return p - q;
		if (typeof p === 'number') return -1;
		if (typeof q === 'number') return 1;
		return p < q ? -1 : 1;
	}
	return 0;
}

/** `alpha` for `10.0.0-alpha.6`; undefined for a release. */
export function prereleaseTag(version: string): string | undefined {
	const id = parse(version)?.ids[0];
	return typeof id === 'string' ? id : undefined;
}

/**
 * A range that is one operator and one version — `~1.2.3`, `^1.2.3`, `>=1.2.3`,
 * `1.2.3` — split into the two. Anything else (`>=8 <10`, `a || b`) is not
 * something to rewrite mechanically.
 */
export function simpleRange(
	range: string,
): { operator: string; version: string } | undefined {
	const match = range
		.trim()
		.match(/^(\^|~|>=|)v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);
	return match ? { operator: match[1]!, version: match[2]! } : undefined;
}
