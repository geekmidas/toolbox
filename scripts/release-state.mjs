#!/usr/bin/env node
/**
 * Whether there is something to publish — and whether publishing is stuck.
 *
 * Every package shares one version, so the CLI's stands for all of them. It
 * is compared with the dist-tag this branch publishes to — `alpha` while
 * `.changeset/pre.json` has the branch in prerelease mode (main, 10.x),
 * `latest` otherwise (v9) — so each line is judged against its own release
 * and not against the other's:
 *
 *   git > npm            a release is pending: publish it
 *   git = npm            released, nothing to do — unless this run bumped the
 *                        version, in which case the bump landed on a version
 *                        that already exists and can never be published
 *   git < npm            git is behind the registry: every later bump lands on
 *                        or below what is out
 *
 * The last two are why this exists. Asking only "is this version on npm?"
 * answers both of them with "yes, nothing to do", and the pipeline goes green
 * while nothing is ever released again.
 *
 *   node scripts/release-state.mjs              decide; writes `publish=` to
 *                                               $GITHUB_OUTPUT when it is set
 *   node scripts/release-state.mjs --bumped     this run consumed changesets
 *   node scripts/release-state.mjs --released   fail unless git = npm: for pull
 *                                               requests, so a main that never
 *                                               published is visible on every
 *                                               one of them
 *   node scripts/release-state.mjs --check-line fail unless every version
 *                                               belongs on this branch's line
 *                                               (see `lineFaults`); run before
 *                                               every publish
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = '@geekmidas/cli';

/** `10.0.0-alpha.8` → `[10, 0, 0, ['alpha', 8]]`; enough of semver for this. */
function parse(version) {
	const [core, pre] = version.split('-', 2);
	const [major, minor, patch] = core.split('.').map(Number);
	const ids = pre
		? pre.split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id))
		: [];
	return { core: [major, minor, patch], ids };
}

export function compare(a, b) {
	const x = parse(a);
	const y = parse(b);
	for (let i = 0; i < 3; i++) {
		if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
	}
	// A release outranks any prerelease of the same version.
	if (!x.ids.length || !y.ids.length) return y.ids.length - x.ids.length;
	for (let i = 0; i < Math.max(x.ids.length, y.ids.length); i++) {
		const [p, q] = [x.ids[i], y.ids[i]];
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

/** The dist-tag this branch publishes to. */
function releaseTag() {
	try {
		const pre = JSON.parse(
			readFileSync(join(root, '.changeset/pre.json'), 'utf-8'),
		);
		if (pre.mode === 'pre') return pre.tag;
	} catch {
		// Not in prerelease mode.
	}
	return 'latest';
}

/**
 * One field of the CLI's registry entry. npm 12 answers `npm view <pkg>
 * <field> --json` with the value wrapped in a one-element array, where npm 11
 * answered with the value itself; read as an object, the wrapped dist-tags had
 * no `alpha`, and every release looked like a line that had never published.
 * Both shapes are read the same way.
 */
function npmView(field) {
	const value = JSON.parse(
		execFileSync('npm', ['view', PACKAGE, field, '--json'], {
			encoding: 'utf-8',
		}),
	);
	return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

/** Every public package's manifest. */
function publicPackages() {
	const packages = join(root, 'packages');
	return readdirSync(packages)
		.map((dir) => join(packages, dir, 'package.json'))
		.filter((file) => existsSync(file))
		.map((file) => JSON.parse(readFileSync(file, 'utf-8')))
		.filter((pkg) => !pkg.private);
}

/**
 * Why these versions may not be published from this branch, if they may not.
 *
 * `@geekmidas/*@10.0.0` reached npm from the v9 branch: a peer range pushed a
 * changeset to major there, and nothing asked whether a v9 branch publishing
 * a 10 made sense. A release outranks every prerelease of it, so each
 * `^10.0.0-alpha.N` range on the alpha line resolved to that week-older build
 * (#371). Two rules, checked before anything is uploaded:
 *
 *   - in prerelease mode (`.changeset/pre.json`), every version is a
 *     prerelease on that tag — a release can only come from leaving it;
 *   - on a branch named for a major (`v9`), every version is in that major.
 */
export function lineFaults({ pre, branch, packages }) {
	const faults = [];
	const major = /^v(\d+)$/.exec(branch ?? '')?.[1];
	for (const { name, version } of packages) {
		const { core, ids } = parse(version);
		if (pre?.mode === 'pre' && ids[0] !== pre.tag) {
			faults.push(
				`${name}@${version} is not a "${pre.tag}" prerelease, and the packages are in prerelease mode. Leave it with \`changeset pre exit\` to release.`,
			);
		}
		if (major !== undefined && String(core[0]) !== major) {
			faults.push(
				`${name}@${version} is not a ${major}.x version, and this is the ${branch} branch.`,
			);
		}
	}
	return faults;
}

function checkLine() {
	let pre;
	try {
		pre = JSON.parse(readFileSync(join(root, '.changeset/pre.json'), 'utf-8'));
	} catch {
		// Not in prerelease mode.
	}
	// A pull request is judged by the branch it merges into.
	const branch = process.env.GITHUB_BASE_REF || process.env.GITHUB_REF_NAME;
	const faults = lineFaults({ pre, branch, packages: publicPackages() });
	if (faults.length > 0) {
		for (const fault of faults) {
			console.error(`::error title=Wrong release line::${fault}`);
		}
		process.exit(1);
	}
	console.log(
		`Every version belongs on ${branch ?? 'this branch'}${pre?.mode === 'pre' ? ` ("${pre.tag}" prereleases)` : ''}.`,
	);
}

/** The public packages whose version in git npm does not have. */
function unpublished() {
	const packages = join(root, 'packages');
	return readdirSync(packages)
		.map((dir) => join(packages, dir, 'package.json'))
		.filter((file) => existsSync(file))
		.map((file) => JSON.parse(readFileSync(file, 'utf-8')))
		.filter((pkg) => !pkg.private)
		.filter((pkg) => {
			try {
				execFileSync('npm', ['view', `${pkg.name}@${pkg.version}`, 'version'], {
					encoding: 'utf-8',
					stdio: ['ignore', 'pipe', 'ignore'],
				});
				return false;
			} catch {
				// `npm view` exits non-zero for a version the registry lacks.
				return true;
			}
		})
		.map((pkg) => `${pkg.name}@${pkg.version}`);
}

/** How long a pull request waits for a release main has just versioned. */
const WAIT_MINUTES = 10;

/** npm's version on `tag`, polled until it reaches `version` or time runs out. */
function waitForNpm(version, tag) {
	const deadline = Date.now() + WAIT_MINUTES * 60_000;
	let current = npmView('dist-tags')[tag];
	while (compare(version, current) > 0 && Date.now() < deadline) {
		console.log(
			`npm's "${tag}" is ${current}; waiting for ${version} to publish…`,
		);
		// Synchronous on purpose: the script is otherwise synchronous, and this
		// is a CI job with nothing else to do.
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000);
		current = npmView('dist-tags')[tag];
	}
	return current;
}

function main() {
	const args = process.argv.slice(2);
	if (args.includes('--check-line')) return checkLine();
	const bumped = args.includes('--bumped');
	const expectReleased = args.includes('--released');

	const inGit = JSON.parse(
		readFileSync(join(root, 'packages/cli/package.json'), 'utf-8'),
	).version;
	const fail = (message) => {
		console.error(`::error title=Release stuck::${message}`);
		process.exit(1);
	};
	const decide = (publish, message) => {
		console.log(message);
		if (process.env.GITHUB_OUTPUT) {
			appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\n`);
		}
	};

	const tag = releaseTag();
	const onNpm = npmView('dist-tags')[tag];
	if (!onNpm) {
		// A line that has never published: anything in git is pending.
		return decide(!expectReleased, `npm has no "${tag}" release yet.`);
	}
	const order = compare(inGit, onNpm);

	// On a pull request, behind npm only means main has released since the
	// branch was cut — update the branch; nothing is stuck. On main it means
	// every bump from here lands on or below a published version.
	if (order < 0 && expectReleased) {
		return decide(
			false,
			`npm's "${tag}" (${onNpm}) is ahead of this branch (${inGit}): main has released since; update the branch.`,
		);
	}
	if (order < 0) {
		fail(
			`git is at ${inGit} but npm's "${tag}" is already ${onNpm}. Every bump from here lands on or below a published version, so nothing will publish until the versions in git are moved past ${onNpm}.`,
		);
	}

	if (expectReleased) {
		// Ahead can mean in flight: main's release job pushes the version bump
		// a few minutes before its publish lands, and a pull request checked in
		// that window would read as stuck. So wait for npm before calling it.
		const published = order > 0 ? waitForNpm(inGit, tag) : onNpm;
		if (compare(inGit, published) > 0) {
			fail(
				`This branch is at ${inGit} but npm's "${tag}" is still ${published} after ${WAIT_MINUTES} minutes: that release never published. Check the "Publish packages" step of the latest run on main.`,
			);
		}
		return decide(false, `${inGit} is on npm.`);
	}

	if (order === 0) {
		if (bumped) {
			fail(
				`This run versioned the packages to ${inGit}, which npm already has. It cannot be published; move the versions in git past ${onNpm}.`,
			);
		}
		// The CLI stands for the release, but a publish that failed partway
		// leaves it out while others are missing — and nothing would ever
		// publish them, since the CLI says "released". `changeset publish`
		// skips what npm has, so publishing again finishes the release.
		const missing = unpublished();
		if (missing.length > 0) {
			return decide(
				true,
				`${inGit} is on npm, but not for ${missing.join(', ')}: a publish stopped partway; publishing the rest.`,
			);
		}
		return decide(false, `${inGit} is on npm; nothing to publish.`);
	}

	decide(true, `${inGit} is not on npm ("${tag}": ${onNpm}); publishing.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
