import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: [
		'src/index.ts',
		'src/types.ts',
		'src/endpoints/index.ts',
		'src/functions/index.ts',
		'src/crons/index.ts',
		'src/subscribers/index.ts',
		'src/adaptors/hono.ts',
		'src/adaptors/aws.ts',
		'src/adaptors/testing.ts',
	],
	clean: true,
	outDir: 'dist',
	format: ['cjs', 'esm'],
	sourcemap: true,
	dts: true,
	outExtensions: (ctx) => ({
		js: ctx.format === 'es' ? '.mjs' : '.cjs',
	}),
	// Bundle lodash utilities — they are not hoisted to the workspace root
	// and would fail to resolve when consumers load the dist from the root context.
	noExternal: [
		'lodash.compact',
		'lodash.get',
		'lodash.pick',
		'lodash.set',
		'lodash.uniqby',
	],
});
