import { StaticSite } from '@geekmidas/constructs/site';
import { api } from './api.js';
import { drop } from './storage.js';

/**
 * The upload page. `drop.server`, not `drop`: the CDN's address is the half
 * that is safe to inline into a bundle, and the edge to it is what puts this
 * site's origin on the bucket's CORS rule — the browser PUTs straight to S3.
 */
export const web = new StaticSite('Web', { path: 'apps/web' }).dependsOn([
	api,
	drop.server,
]);
