import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: [
		'src/index.ts',
		'src/config.ts',
		// Reachable from an `sst.config.ts`, so a deploy builds the manifest the
		// same way `gkm dev` does rather than reimplementing discovery.
		'src/reconcile/public.ts',
		// `deploy()` for hosts that deploy a project without a terminal.
		'src/deploy/public.ts',
		// `defineTarget` and the target interface, for a deploy target package.
		'src/target/public.ts',
		'src/workspace/index.ts',
		'src/openapi.ts',
		// A Vitest global setup: `globalSetup: ['@geekmidas/cli/vitest']`.
		'src/vitest.ts',
		// Sniffer files need to be standalone for subprocess loading via --import
		'src/deploy/sniffer-loader.ts',
		'src/deploy/sniffer-worker.ts',
		'src/deploy/sniffer-routes-worker.ts',
		'src/deploy/sniffer-hooks.ts',
		'src/deploy/sniffer-envkit-patch.ts',
		'src/deploy/sniffer-envparser-worker.ts',
		// Run as their own processes inside a sandbox, like the sniffers.
		'src/sandbox/config-worker.ts',
		'src/sandbox/credentials-worker.ts',
		'src/sandbox/discover-worker.ts',
		'src/sandbox/migrate-worker.ts',
	],
	dts: true,
	format: ['cjs', 'esm'],
	outExtensions: (ctx) => ({
		js: ctx.format === 'es' ? '.mjs' : '.cjs',
	}),
});
