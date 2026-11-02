/**
 * The range `gkm init` writes for a `@geekmidas/*` package at `version`.
 *
 * A stable version gets `~`: its patches. A prerelease gets every later
 * prerelease of the same release and stops below the release itself:
 * `>=10.0.0-alpha.152 <10.0.0`. Not `~10.0.0-alpha.152`, which semver also
 * satisfies with `10.0.0` — and a `10.0.0`, published by mistake from the v9
 * branch, is on npm. A project scaffolded on the alpha line installed that
 * week-older release instead of the alpha it was scaffolded with (#371).
 */
export function versionRange(version: string): string {
	const prerelease = /^(\d+\.\d+\.\d+)-[0-9A-Za-z.-]+$/.exec(version);
	if (!prerelease) return `~${version}`;
	return `>=${version} <${prerelease[1]}`;
}
