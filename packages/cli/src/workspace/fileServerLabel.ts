import { kebabCase } from '@geekmidas/manifest';

/**
 * The name a file server answers on.
 *
 * `new FileServer('Assets', …)` is two manifest nodes: the bucket, which keeps
 * the id (`Assets`, `ASSETS_URL`), and the surface in front of it,
 * `AssetsServer` (`ASSETS_SERVER_URL`). The suffix keeps the two nodes and
 * their keys apart, and that is all it is for. A host is not a key, so it
 * takes the name the construct was given: `assets.<domain>`, never
 * `assets-server.<domain>`.
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
	return kebabCase(serverId.replace(/Server$/, ''));
}
