import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/index.ts'],
	clean: true,
	outDir: 'dist',
	format: ['cjs', 'esm'],
	sourcemap: true,
	dts: true,
	outExtensions: (ctx) => ({
		js: ctx.format === 'es' ? '.mjs' : '.cjs',
	}),
	// Not hoisted to the workspace root, so it would fail to resolve when a
	// consumer loads dist from the root context.
	noExternal: ['lodash.snakecase'],
});
