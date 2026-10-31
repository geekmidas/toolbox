import { defineConfig } from 'tsdown';

export default defineConfig({
	deps: {
		neverBundle: ['zod'],
	},
});
