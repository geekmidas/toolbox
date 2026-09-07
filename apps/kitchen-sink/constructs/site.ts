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
	// Relative to the workspace root, which is now a real place rather than
	// whichever app happened to hold the constructs. It used to be
	// `../kitchen-sink-web` — a construct escaping its own app to point at a
	// sibling, which is the shape this layout removes.
	path: 'apps/web',
}).dependsOn([api, auth, uploads.server]);

/**
 * The admin console — the second site, and the second *variant*.
 *
 * `Web` is Vite and this is Next, deliberately. A `site` declaration carries a
 * `variant`, and the deploy reads it to pick a Dockerfile template and an env
 * prefix: `VITE_` there, `NEXT_PUBLIC_` here. One neutral name from the
 * construct, one serialisation per framework — which is only proven with two.
 *
 * It also settles which site holds the base domain. `Web` is named `web`, so
 * the convention gives it `example.com` and this one becomes `admin.` — from
 * the construct id, with no hostname written down. Were neither called `web`,
 * one of them would have to say `root: true` rather than the deploy guessing.
 */
export const admin = new StaticSite('Admin', {
	path: 'apps/admin',
	variant: 'next',
}).dependsOn([api, auth]);
