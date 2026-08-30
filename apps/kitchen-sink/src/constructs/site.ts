import { StaticSite } from '@geekmidas/constructs/site';
import { api } from './api.js';
import { auth } from './auth.js';
import { uploads } from './storage.js';

/**
 * The frontend, declared — which is what removes the last mechanism running
 * beside the graph.
 *
 * Four things derive from the one edge below, all of which were hand-maintained
 * lists before:
 *
 * - `VITE_API_URL`, `VITE_AUTH_URL` and `VITE_UPLOADS_SERVER_URL` at build time
 * - the API's CORS origins
 * - the auth server's trusted origins
 * - the cookie domain the two share
 *
 * Note the edge is `uploads.server`, not `uploads`. Depending on the file server
 * itself points at the *bucket*, which is right for a handler that presigns and
 * wrong here: a bucket's URL is never public, so the site would get nothing
 * inlined. `PUBLIC` is what makes that distinction, and `.server` is how you ask
 * for the half that is safe to ship.
 */
export const web = new StaticSite('Web', {
	// Relative to the app, not the workspace: the deploy target resolves it from
	// wherever the config runs, and the local target matches a workspace app by
	// the same string.
	path: '../kitchen-sink-web',
}).dependsOn([api, auth, uploads.server]);
