import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// `@app/client/<surface>` is the workspace root's `.gkm/client/<surface>.ts`,
// as a site's tsconfig paths map it.
export default defineConfig({
	resolve: {
		alias: {
			'@app/client': fileURLToPath(
				new URL('../../.gkm/client', import.meta.url),
			),
		},
	},
});
