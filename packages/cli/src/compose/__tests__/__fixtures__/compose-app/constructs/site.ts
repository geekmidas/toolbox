import { StaticSite } from '@geekmidas/constructs/site';
import { api } from './api.js';
import { auth } from './auth.js';

/** A Vite site that signs in through the auth server and calls the API. */
export const web = new StaticSite('Web', { path: 'apps/web' }).dependsOn([
	api,
	auth,
]);
