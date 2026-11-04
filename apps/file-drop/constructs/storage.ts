import { FileServer } from '@geekmidas/constructs/file-server';

/**
 * The bucket (`Drop`) and the CDN over it (`DropServer`).
 *
 * `public/**` is open, so anything uploaded there is readable without a
 * signature; every other key is refused at the edge with a 403, which is the
 * second thing a production check looks for. Keys are random, so an object
 * is never rewritten, and the CDN may tell browsers to keep it forever.
 */
export const drop = new FileServer('Drop', {
	open: ['public/**'],
	immutable: ['public/**'],
});
