/**
 * A storage client with no bucket behind it: what a frontend's plain edge to
 * a bucket registers, as it holds where the bucket's links are signed and
 * nothing that writes to it.
 */

import type { StorageClient } from '@geekmidas/storage';

/** Names asked of any object, which a read-only client must not answer. */
const INTROSPECTED = new Set([
	'then',
	'toJSON',
	'constructor',
	'asymmetricMatch',
	'$$typeof',
	'nodeType',
	'inspect',
]);

/**
 * A client whose every method throws what `refuse` makes of its name.
 *
 * A proxy rather than a list of stubs, so a method the storage client grows
 * later refuses the same way. What a runtime asks of any object is left
 * alone: `then`, because a client is resolved from a promise, and the names a
 * serialiser or a test's printer looks for.
 */
export function readOnlyStorage(
	refuse: (method: string) => Error,
): StorageClient {
	return new Proxy({} as StorageClient, {
		get(_target, property) {
			if (typeof property !== 'string' || INTROSPECTED.has(property)) return;
			return () => {
				throw refuse(property);
			};
		},
	});
}
