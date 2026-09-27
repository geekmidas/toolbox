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
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
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

function npmView(field) {
	return JSON.parse(
		execFileSync('npm', ['view', PACKAGE, field, '--json'], {
			encoding: 'utf-8',
		}),
	);
}

function main() {
	const args = process.argv.slice(2);
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

	if (order < 0) {
		fail(
			`git is at ${inGit} but npm's "${tag}" is already ${onNpm}. Every bump from here lands on or below a published version, so nothing will publish until the versions in git are moved past ${onNpm}.`,
		);
	}

	if (expectReleased) {
		if (order > 0) {
			fail(
				`This branch is at ${inGit} but npm's "${tag}" is ${onNpm}: that release never published. Check the "Publish packages" step of the latest run on main.`,
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
		return decide(false, `${inGit} is on npm; nothing to publish.`);
	}

	decide(true, `${inGit} is not on npm ("${tag}": ${onNpm}); publishing.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
