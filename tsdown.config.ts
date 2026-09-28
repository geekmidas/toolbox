import { defineConfig } from 'tsdown';

export default defineConfig({
	workspace: ['packages/*'],
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
