import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/index.ts', 'src/context.ts', 'src/trpc.ts', 'src/middy.ts'],
	clean: true,
	outDir: 'dist',
	format: ['cjs', 'esm'],
	sourcemap: true,
	dts: true,
	outExtensions: (ctx) => ({
		js: ctx.format === 'es' ? '.mjs' : '.cjs',
	}),
});
