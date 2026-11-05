/**
 * `@geekmidas/cli/next` — what a Next.js site's `next.config.ts` builds from
 * the workspace instead of from hand-kept lists.
 *
 * ```ts
 * import { imageRemotePatterns } from '@geekmidas/cli/next';
 *
 * export default {
 *   images: { remotePatterns: [...imageRemotePatterns(), // third parties ] },
 * };
 * ```
 *
 * Read from the environment `gkm dev`, `gkm exec` and a compose or AWS site
 * build hand the site, so it imports nothing of the workspace and runs
 * wherever `next.config` does.
 */

import { IMAGE_ORIGINS_KEY, PUBLIC_PREFIX } from '@geekmidas/manifest';

/**
 * One entry of `images.remotePatterns`, as Next takes it. Stated here rather
 * than imported, so this module needs no `next` to load.
 */
export interface RemotePattern {
	protocol?: 'http' | 'https';
	hostname: string;
	port?: string;
	pathname?: string;
}

/**
 * A `RemotePattern` for every origin the site's pages load files from: each
 * file server it has an edge to, and the host each bucket it reaches signs
 * its links on — for the stage being built, as gkm resolved them.
 *
 * Under `gkm dev` those are the local ones: the file server's `*.localhost`
 * host and MinIO's address, on the ports this machine assigned. An empty list
 * where nothing handed the site its origins (a plain `next build`), rather
 * than a throw: the config still loads, and `next/image` refuses the hosts it
 * was not told about, as it would have.
 *
 * Every path on each host: a file server answers signed paths and open ones,
 * and a signed link may point at any key.
 */
export function imageRemotePatterns(
	env: Readonly<Record<string, string | undefined>> = process.env,
): RemotePattern[] {
	const listed =
		env[`${PUBLIC_PREFIX.next}${IMAGE_ORIGINS_KEY}`] ?? env[IMAGE_ORIGINS_KEY];
	if (!listed) return [];

	const patterns: RemotePattern[] = [];
	for (const origin of listed.split(',')) {
		let url: URL;
		try {
			url = new URL(origin.trim());
		} catch {
			continue;
		}
		const protocol = url.protocol.slice(0, -1);
		if (protocol !== 'http' && protocol !== 'https') continue;
		patterns.push({
			protocol,
			hostname: url.hostname,
			...(url.port ? { port: url.port } : {}),
			pathname: '/**',
		});
	}
	return patterns;
}
