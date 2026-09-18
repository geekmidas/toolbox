#!/usr/bin/env node
/**
 * Every path a package's `package.json` points at must exist after a build.
 *
 * Two of them did not, and nothing said so. `@geekmidas/ui` listed four entries
 * in its tsdown config that named directories nobody had written — tsdown drops
 * a missing entry without a word — and `@geekmidas/client` declared a root
 * export with no `src/index.ts` behind it, so `import from '@geekmidas/client'`
 * resolved to nothing. Both were published that way.
 *
 * This runs after the build, before anything is published.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Collects every literal file path a conditional-exports subtree points at. */
function targets(node, out = []) {
	if (typeof node === 'string') {
		out.push(node);
	} else if (node && typeof node === 'object') {
		for (const value of Object.values(node)) targets(value, out);
	}
	return out;
}

const failures = [];

for (const directory of readdirSync(join(root, 'packages'))) {
	const packagePath = join(root, 'packages', directory, 'package.json');
	if (!existsSync(packagePath)) continue;

	const manifest = JSON.parse(readFileSync(packagePath, 'utf-8'));
	if (manifest.private) continue;

	const declared = [];
	for (const [subpath, node] of Object.entries(manifest.exports ?? {})) {
		// A wildcard subpath names a pattern, not a file.
		if (subpath.includes('*')) continue;
		declared.push(...targets(node).map((file) => [subpath, file]));
	}
	for (const field of ['main', 'module', 'types', 'bin']) {
		const value = manifest[field];
		if (typeof value === 'string') declared.push([field, value]);
	}

	for (const [subpath, file] of declared) {
		if (file.includes('*')) continue;
		if (existsSync(join(root, 'packages', directory, file))) continue;
		failures.push(`${manifest.name}  ${subpath}  ->  ${file}`);
	}
}

if (failures.length > 0) {
	console.error(
		`\n${failures.length} declared export${
			failures.length === 1 ? '' : 's'
		} resolve to nothing:\n`,
	);
	for (const failure of failures) console.error(`  ${failure}`);
	console.error(
		"\nBuild the workspace first; if it is built, the entry is missing\nfrom that package's tsdown config.\n",
	);
	process.exit(1);
}

console.log('Every declared export resolves.');
