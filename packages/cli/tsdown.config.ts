import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: [
		'src/index.ts',
		'src/config.ts',
		'src/workspace/index.ts',
		'src/openapi.ts',
		'src/openapi-react-query.ts',
		// Sniffer files need to be standalone for subprocess loading via --import
		'src/deploy/sniffer-loader.ts',
		'src/deploy/sniffer-worker.ts',
		'src/deploy/sniffer-routes-worker.ts',
		'src/deploy/sniffer-hooks.ts',
		'src/deploy/sniffer-envkit-patch.ts',
	],
	dts: true,
	format: ['cjs', 'esm'],
	outExtensions: (ctx) => ({
		js: ctx.format === 'es' ? '.mjs' : '.cjs',
	}),
});
