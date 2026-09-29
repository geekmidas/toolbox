import { Credentials } from '@geekmidas/envkit/credentials';
import { defineConfig } from 'vite';

/**
 * The frontend half of kitchen-sink.
 *
 * It exists to make four already-built derivations observable rather than
 * merely tested: the site → API edge, the `VITE_` keys inlined from it, the
 * API's CORS origins, and the cookie domain. All four come from one line —
 * `.dependsOn([api, auth])` in `src/constructs/site.ts` — and none of them
 * appear in this file, which is the property worth demonstrating.
 */
export default defineConfig({
	// `VITE_*` is the contract: the target resolves `API_URL` once and this
	// build inlines it under the name the bundler expects. Nothing here names
	// a host.
	envPrefix: 'VITE_',
	// The port the workspace provisioned for this app, which `gkm exec` injects
	// — the one every other app's `WEB_URL` and the API's CORS origins name.
	// Strict, because Vite drifting to the next free port serves the site
	// somewhere nothing points at.
	server: {
		port: Number(Credentials.PORT),
		strictPort: true,
	},
});
