#!/usr/bin/env node
/**
 * Every dependency has one range per field, and the ranges come from one list.
 *
 * Tranche 1 (`dce95880`) aligned ninety dependencies this way, and could be
 * re-derived on a new base when it conflicted instead of being merged by hand
 * — but the script and its list were never committed, so the next tranche had
 * nothing to derive from. This is that script; `dependency-versions.json`
 * beside it is the list.
 *
 * The list is keyed by dependency, then by field, because a peer range is a
 * different statement from a dependency range: `hono` is `~4.13.8` where a
 * package installs it and `>=4.13.8` where a package merely works with it.
 * One range per *field*, not per dependency.
 *
 *   node scripts/align-deps.mjs            check: exit 1 on any drift
 *   node scripts/align-deps.mjs --write    rewrite every package.json to the list
 *   node scripts/align-deps.mjs --latest [name…]
 *                                          move list entries to npm's latest,
 *                                          keeping each range's operator
 *
 * `--write` only changes version strings. Which field a dependency sits in —
 * a dependency, an optional peer — is a decision about the package, and the
 * packaging fix that conflicted with tranche 1 was exactly such a decision.
 */

import { globSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const listPath = join(root, 'scripts', 'dependency-versions.json');

const FIELDS = [
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'optionalDependencies',
];

/**
 * Held back from `--latest`, because their version follows something other
 * than npm's `latest` tag. Keep each one justified.
 */
const HOLD = new Set([
	// Tracks an Expo SDK release train, not its own releases.
	'expo-secure-store',
]);

/** Protocols that are not a registry range, and so not this list's business. */
const isRegistryRange = (range) =>
	!/^(workspace|catalog|link|file|npm|git|github|https?):/.test(range);

/** Every workspace member's package.json, plus the root's. */
function workspaceManifests() {
	const yaml = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf-8');
	const patterns = [...yaml.matchAll(/^\s*-\s*["']?([^"'\s#]+)["']?/gm)].map(
		(m) => m[1],
	);

	const paths = new Set([join(root, 'package.json')]);
	for (const pattern of patterns) {
		for (const match of globSync(`${pattern}/package.json`, { cwd: root })) {
			if (!match.includes('node_modules')) paths.add(join(root, match));
		}
	}

	return [...paths].sort();
}

function readManifests() {
	return workspaceManifests().map((path) => {
		const text = readFileSync(path, 'utf-8');
		return { path, text, json: JSON.parse(text) };
	});
}

const readList = () => JSON.parse(readFileSync(listPath, 'utf-8'));

function writeList(list) {
	const sorted = Object.fromEntries(
		Object.keys(list)
			.sort()
			.map((name) => [name, list[name]]),
	);
	writeFileSync(listPath, `${JSON.stringify(sorted, null, '\t')}\n`);
}

const workspacePath = join(root, 'pnpm-workspace.yaml');

/**
 * The `overrides:` entries in pnpm-workspace.yaml, by line.
 *
 * An override pins a transitive copy to the workspace's own version — e.g.
 * `"@docsearch/react>@types/react"` — so its range is not a second list: it
 * must be whatever the workspace installs that package at. Read line by line
 * because the block is flat and the script has no YAML dependency.
 */
function workspaceOverrides() {
	const lines = readFileSync(workspacePath, 'utf-8').split('\n');
	const start = lines.findIndex((line) => line.trim() === 'overrides:');
	if (start === -1) return { lines, entries: [] };

	const entries = [];
	for (let i = start + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) {
		const match = lines[i].match(/^(\s+)"?([^"]+?)"?\s*:\s*"?([^"\s]+)"?\s*$/);
		if (!match) continue;
		const [, indent, selector, range] = match;
		// `a>b@1` → `b`: the package the override versions, without a selector.
		const target = selector
			.split('>')
			.at(-1)
			.replace(/(?<=.)@.*$/, '');
		entries.push({ index: i, indent, selector, target, range });
	}
	return { lines, entries };
}

/** The range an override must hold: the one the workspace installs it at. */
const overrideRange = (list, name) =>
	list[name]?.devDependencies ?? list[name]?.dependencies;

/** Every place a registry range differs from the list, or has no entry. */
function drift(manifests, list) {
	const problems = [];
	const seen = new Set();

	for (const { path, json } of manifests) {
		const where = relative(root, path);
		for (const field of FIELDS) {
			for (const [name, range] of Object.entries(json[field] ?? {})) {
				if (!isRegistryRange(range)) continue;
				seen.add(name);

				const wanted = list[name]?.[field];
				if (wanted === undefined) {
					problems.push(
						`${where}: ${field}.${name} ${range} is not in the list`,
					);
				} else if (wanted !== range) {
					problems.push(`${where}: ${field}.${name} ${range} → ${wanted}`);
				}
			}
		}
	}

	for (const { selector, target, range } of workspaceOverrides().entries) {
		const wanted = overrideRange(list, target);
		if (wanted === undefined) {
			problems.push(
				`pnpm-workspace.yaml: overrides.${selector} ${range} has no workspace range to follow`,
			);
		} else if (wanted !== range) {
			problems.push(
				`pnpm-workspace.yaml: overrides.${selector} ${range} → ${wanted}`,
			);
		}
	}

	// An entry nothing uses is a version nobody is checking.
	for (const name of Object.keys(list)) {
		if (!seen.has(name)) problems.push(`list: ${name} is used by no package`);
	}

	return problems;
}

function write(manifests, list) {
	let changed = 0;

	for (const { path, text, json } of manifests) {
		let touched = false;
		for (const field of FIELDS) {
			for (const [name, range] of Object.entries(json[field] ?? {})) {
				const wanted = list[name]?.[field];
				if (!isRegistryRange(range) || !wanted || wanted === range) continue;
				json[field][name] = wanted;
				touched = true;
			}
		}

		if (touched) {
			const indent = text.match(/^[ \t]+(?=")/m)?.[0] ?? '\t';
			writeFileSync(path, `${JSON.stringify(json, null, indent)}\n`);
			changed += 1;
		}
	}

	const { lines, entries } = workspaceOverrides();
	let overridden = false;
	for (const { index, indent, selector, target, range } of entries) {
		const wanted = overrideRange(list, target);
		if (!wanted || wanted === range) continue;
		lines[index] = `${indent}"${selector}": "${wanted}"`;
		overridden = true;
	}
	if (overridden) {
		writeFileSync(workspacePath, lines.join('\n'));
		changed += 1;
	}

	return changed;
}

/**
 * The same operator on a newer version. A range that is not one operator and
 * one version — `>=8 <10`, `a || b` — is left for a person to rewrite.
 */
function bump(range, version) {
	const match = range.match(/^(\^|~|>=|)(\d+\.\d+\.\d+(?:-[\w.]+)?)$/);
	return match ? `${match[1]}${version}` : undefined;
}

async function latestVersion(name) {
	const res = await fetch(
		`https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`,
	);
	if (!res.ok) throw new Error(`${name}: npm answered ${res.status}`);
	return (await res.json()).version;
}

async function latest(list, names) {
	const unknown = names.filter((name) => !list[name]);
	if (unknown.length) {
		// Adding a dependency is a decision about a package, so it starts in a
		// package.json and reaches the list from there, not the other way round.
		console.error(`Not in the list: ${unknown.join(', ')}`);
		process.exit(1);
	}

	const targets = (names.length ? names : Object.keys(list)).filter(
		(name) => names.includes(name) || !HOLD.has(name),
	);

	const versions = new Map();
	for (let i = 0; i < targets.length; i += 8) {
		const batch = targets.slice(i, i + 8);
		const found = await Promise.all(batch.map(latestVersion));
		batch.forEach((name, j) => versions.set(name, found[j]));
	}

	const moved = [];
	for (const name of targets) {
		for (const [field, range] of Object.entries(list[name])) {
			const next = bump(range, versions.get(name));
			if (next === undefined) {
				moved.push(
					`  ${name} ${field}: ${range} left as is (not a simple range)`,
				);
			} else if (next !== range) {
				list[name][field] = next;
				moved.push(`  ${name} ${field}: ${range} → ${next}`);
			}
		}
	}

	return moved;
}

const args = process.argv.slice(2);
const list = readList();

if (args[0] === '--latest') {
	const moved = await latest(list, args.slice(1));
	writeList(list);
	console.log(
		moved.length
			? `List updated:\n${moved.join('\n')}\n\nRun with --write to apply it.`
			: 'The list is already at latest.',
	);
} else if (args[0] === '--write') {
	const changed = write(readManifests(), list);
	console.log(`Rewrote ${changed} file(s). Run pnpm install.`);
	const left = drift(readManifests(), list);
	if (left.length) {
		console.error(`\nStill not in the list:\n${left.join('\n')}`);
		process.exit(1);
	}
} else {
	const problems = drift(readManifests(), list);
	if (problems.length) {
		console.error(
			`${problems.length} dependency range(s) disagree with scripts/dependency-versions.json:\n\n${problems.join('\n')}\n\nFix the list, then run: node scripts/align-deps.mjs --write`,
		);
		process.exit(1);
	}
	console.log('Every dependency range matches the list.');
}
