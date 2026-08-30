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
 * Note what is *not* inlined: `uploads` is depended on, but only its **server's**
 * address reaches the bundle. The bucket's own URL presigns, and a presigner in
 * a bundle is a credential in a bundle — which `PUBLIC` is what enforces.
 */
export const web = new StaticSite('Web', {
	path: 'apps/kitchen-sink-web',
}).dependsOn([api, auth, uploads]);
