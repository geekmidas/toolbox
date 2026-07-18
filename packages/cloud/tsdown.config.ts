import { defineConfig } from 'tsdown';

export default defineConfig({
	// `src/sst/**` is distributed as raw TypeScript source (it extends SST's
	// ambient `.sst/platform` globals, which only exist inside a consuming SST
	// app), so it is intentionally NOT built here. List entries explicitly to
	// keep it out of the dist build — which also means the format/dts/extension
	// defaults (otherwise inferred from `exports`) must be set explicitly.
	entry: ['src/index.ts', 'src/utils/index.ts'],
	clean: true,
	format: ['cjs', 'esm'],
	dts: true,
	sourcemap: true,
	outExtensions: (ctx) => ({ js: ctx.format === 'es' ? '.mjs' : '.cjs' }),
});
