import { fileServerName, kebabCase } from '@geekmidas/manifest';

/**
 * The name a file server answers on.
 *
 * `new FileServer('Assets', …)` is two manifest nodes: the bucket, which keeps
 * the id (`Assets`, `ASSETS_CONNECTION_STRING`), and the surface in front of
 * it, `AssetsServer`. The suffix keeps the two nodes apart, and that is all it
 * is for: the surface's key (`ASSETS_URL`) and its host both take the name the
 * construct was given — `assets.<domain>`, never `assets-server.<domain>`.
 *
 * Read off the surface's id rather than its `of`: with `{ origin }` the bucket
 * is another construct's, and its id is not this file server's name.
 *
 * Every host a file server has — its CDN alias and certificate, its edge
 * route, its local `*.localhost` address, its processors' origin and unit —
 * is built from this one label, so no two of them can disagree.
 *
 * @example fileServerLabel('AssetsServer') // 'assets'
 * @example fileServerLabel('UserUploadsServer') // 'user-uploads'
 */
export function fileServerLabel(serverId: string): string {
	return kebabCase(fileServerName(serverId));
}

/**
 * Where a file server answers on a deployed stage: its label on the stage's
 * domain, `assets.example.com` for `AssetsServer`. The CDN in front of a
 * bucket on S3 is issued its certificate for it, the stack's edge routes it
 * over its MinIO, and a site's build inlines it — all read off this one name,
 * so a domain change moves every one of them at once.
 */
export function fileServerHost(serverId: string, domain: string): string {
	return `${fileServerLabel(serverId)}.${domain}`.toLowerCase();
}
