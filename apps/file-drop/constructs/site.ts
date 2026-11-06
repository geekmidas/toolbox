import { StaticSite } from '@geekmidas/constructs/site';
import { api } from './api.js';
import { drop } from './storage.js';

/**
 * The upload page. A site's plain edge to a file server is to the CDN's
 * address, the half that is safe to inline into a bundle, and nothing that
 * writes to the bucket. The edge is also what puts this site's origin on the
 * bucket's CORS rule: the browser PUTs straight to S3, through links the API
 * signs.
 */
export const web = new StaticSite('Web', { path: 'apps/web' }).dependsOn([
	api,
	drop,
]);
