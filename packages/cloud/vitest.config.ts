import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'cloud',
		// Components extend ambient `sst.aws.*`, evaluated at module load, so
		// without these no component is even importable from a test.
		setupFiles: ['test/sst-globals.ts'],
	},
});
