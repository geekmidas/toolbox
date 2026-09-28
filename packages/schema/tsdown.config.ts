import { defineConfig } from 'tsdown';

export default defineConfig({
	deps: {
		neverBundle: ['@valibot/to-json-schema', 'zod', 'zod-to-json-schema'],
	},
});
