import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

export default defineProject({
	// Pulumi's SDKs are vendored under `.sst/platform/node_modules` — the package
	// depends on nothing from Pulumi at the top level, and a component that
	// creates a resource SST has no wrapper for imports them from there. The
	// tsconfig maps the same two paths; this is the runtime half, so importing a
	// component under test does not fail at its first line.
	resolve: {
		alias: {
			'@pulumi/aws': fileURLToPath(
				new URL('./.sst/platform/node_modules/@pulumi/aws', import.meta.url),
			),
			'@pulumi/random': fileURLToPath(
				new URL('./.sst/platform/node_modules/@pulumi/random', import.meta.url),
			),
		},
	},
	test: {
		name: 'cloud',
		// Components extend ambient `sst.aws.*`, evaluated at module load, so
		// without these no component is even importable from a test.
		setupFiles: ['test/sst-globals.ts'],
	},
});
