import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'tsdown';

/**
 * The packages to build: every directory under `packages/` that is one.
 *
 * Not the bare `packages/*` glob: a package removed from git leaves its
 * untracked `dist` and `node_modules` behind in every existing checkout, and
 * tsdown resolves such a directory to the root package and stops with
 * "Cannot find entry".
 */
const root = import.meta.dirname;
const packages = readdirSync(join(root, 'packages'), { withFileTypes: true })
	.filter(
		(entry) =>
			entry.isDirectory() &&
			existsSync(join(root, 'packages', entry.name, 'package.json')),
	)
	.map((entry) => `packages/${entry.name}`);

/**
 * The commit a release is built from, which `scripts/release.sh publish` sets:
 * written into the CLI so `gkm init` pins the stages action to it. Only then —
 * a local build's commit may exist nowhere but this checkout.
 */
const releaseCommit = process.env.GKM_RELEASE_COMMIT;

export default defineConfig({
	workspace: packages,
	...(releaseCommit
		? {
				define: {
					'process.env.GKM_RELEASE_COMMIT': JSON.stringify(releaseCommit),
				},
			}
		: {}),
	clean: true,
	outDir: 'dist',
	// Every file under `src/`, as `'src/'` meant before tsdown 0.23 stopped
	// taking a directory as an entry.
	entry: [
		'src/**/*',
		'!**/__tests__/**',
		'!**/*.spec.*',
		'!**/__benchmarks__/**',
	],
	format: ['cjs', 'esm'],
	deps: { neverBundle: ['vitest'] },
	sourcemap: true,
	dts: true,
	// `.mjs`/`.cjs` whatever a package's `"type"`, which is what every
	// `exports` map names.
	fixedExtension: true,
});
