/**
 * What a processor keeps, and for how long.
 *
 * A processor writes each derivative it makes back into its bucket under one
 * prefix, so the next request is served without running it again. Those
 * copies are a cache, not data: they are remade on demand, so the bucket
 * deletes them after a while — and the expiry is a fact about the manifest,
 * read here once by every target that provisions a bucket.
 */

import type {
	ConstructManifest,
	FileServerDeclaration,
	ObjectsDeclaration,
} from './declaration';

/** Where a processor keeps what it made, in the bucket it reads. */
export const DERIVED_PREFIX = '.gkm-derived/';

/** How long a derivative is kept when its file server does not say. */
export const DEFAULT_DERIVED_DAYS = 30;

/**
 * The days a bucket keeps what is under each prefix: what it declared, and —
 * when a file server over it has processors — the derived prefix, for the
 * longest any of those servers asked. `undefined` when it expires nothing.
 */
export function bucketExpiry(
	manifest: ConstructManifest,
	bucketId: string,
): Record<string, number> | undefined {
	const bucket = manifest[bucketId] as ObjectsDeclaration | undefined;
	const expire: Record<string, number> = { ...(bucket?.expire ?? {}) };

	const processed = Object.values(manifest).filter(
		(d): d is FileServerDeclaration =>
			d.kind === 'file-server' &&
			(d as FileServerDeclaration).of === bucketId &&
			((d as FileServerDeclaration).processors?.length ?? 0) > 0,
	);
	if (processed.length > 0 && expire[DERIVED_PREFIX] === undefined) {
		expire[DERIVED_PREFIX] = Math.max(
			...processed.map((s) => s.derivedDays ?? DEFAULT_DERIVED_DAYS),
		);
	}

	return Object.keys(expire).length > 0 ? expire : undefined;
}
