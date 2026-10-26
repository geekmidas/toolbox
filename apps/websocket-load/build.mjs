/**
 * Bundle the target and the simulator into one file each, so a container
 * runs them on a stock `node` image with `dist/` mounted — no install, no
 * image to build, and the workspace's own `@geekmidas/constructs` inside.
 */
import { build } from 'esbuild';

await build({
	entryPoints: ['src/target.ts', 'src/simulate.ts'],
	outdir: 'dist',
	outExtension: { '.js': '.mjs' },
	bundle: true,
	platform: 'node',
	target: 'node24',
	format: 'esm',
	// `ws` tries these optional native helpers and falls back without them.
	external: ['bufferutil', 'utf-8-validate'],
	// Bundled CommonJS (ioredis) still calls require.
	banner: {
		js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
	},
	logLevel: 'warning',
});
