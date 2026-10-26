/**
 * Where `gkm dev` serves a file server's processors, on the dev server of the
 * app holding them: named after the file server.
 *
 * One definition for both sides — the dev server mounts it, and the local
 * edge rewrites each processor pattern on the file server's host onto it — so
 * the path the edge sends and the path the server answers cannot drift.
 */
export const PROCESSORS_DEV_PREFIX = '/__gkm/processors/';

/** The base a file server's processors answer under, in `gkm dev`. */
export function processorsDevRoute(fileServerId: string): string {
	return `${PROCESSORS_DEV_PREFIX}${fileServerId}`;
}
