import { defineConfig } from 'tsdown';

export default defineConfig({
	workspace: ['packages/*'],
	clean: true,
	outDir: 'dist',
	entry: ['src/', '!**/__tests__/**', '!**/*.spec.*', '!**/__benchmarks__/**'],
	format: ['cjs', 'esm'],
	external: ['vitest'],
	sourcemap: true,
	dts: true,
	// `.mjs`/`.cjs` whatever a package's `"type"`, which is what every
	// `exports` map names.
	fixedExtension: true,
});
