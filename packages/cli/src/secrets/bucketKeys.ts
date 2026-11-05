/**
 * The keys a bucket and a file server used to be stored under, moved to the
 * ones they are read from now.
 *
 * A bucket's connection was `<ID>_URL` and is `<ID>_CONNECTION_STRING`; a file
 * server's public address was `<ID>_SERVER_URL` and is `<ID>_URL`. A deployed
 * stage still holds the old names: written there by its provider, or set by
 * hand on an `external` one. Both are moved, in that order, the first time
 * the stage is deployed after the rename — the bucket's first, because the
 * name it leaves is the one the file server's address moves into.
 *
 * Moved rather than reissued: the provider reads its access key back out of
 * the stored connection, so finding nothing under the new name would issue
 * the bucket a second key.
 */

import {
	type ConstructManifest,
	providedKeyFor,
	provideKey,
} from '@geekmidas/manifest';

/** One stored key moved to its new name. */
export interface MovedKey {
	from: string;
	to: string;
}

/**
 * `custom` with each old bucket and file-server key moved to its new name,
 * and what was moved. A key whose new name is already set is left where it
 * is: the new one is what is read, and the old one is somebody's to delete.
 */
export function moveBucketKeys(
	manifest: ConstructManifest,
	custom: Readonly<Record<string, string>>,
): { custom: Record<string, string>; moved: MovedKey[] } {
	const next = { ...custom };
	const moved: MovedKey[] = [];
	const move = (from: string, to: string, when = (_: string) => true) => {
		const value = next[from];
		if (from === to || value === undefined || next[to] !== undefined) return;
		if (!when(value)) return;
		next[to] = value;
		delete next[from];
		moved.push({ from, to });
	};

	const entries = Object.entries(manifest);
	for (const [id, declaration] of entries) {
		if (declaration.kind !== 'objects') continue;
		// Only a connection: an `https://` value under the old name is already
		// a file server's address, written by hand ahead of the move.
		move(
			provideKey(id, 'url'),
			provideKey(id, 'connectionString'),
			(value) => !/^https?:\/\//i.test(value),
		);
	}
	for (const [id, declaration] of entries) {
		if (declaration.kind !== 'file-server') continue;
		move(provideKey(id, 'url'), providedKeyFor(id, 'file-server', 'url'));
	}

	return { custom: next, moved };
}
