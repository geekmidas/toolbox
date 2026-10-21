/**
 * How long a bucket keeps the objects under a prefix.
 *
 * Shared by `ObjectStorage` and the bucket a `FileServer` vends, because it is
 * a fact about the bucket rather than about who serves it: a prefix of
 * generated files that nobody reads back grows for ever unless the bucket
 * itself is told to drop them.
 *
 * ```ts
 * new ObjectStorage('Private', { expire: { 'quotes/': { days: 30 } } });
 * ```
 *
 * Whole days, because that is the unit S3's lifecycle — and MinIO's — counts
 * in. Prefixes are literal: a lifecycle rule matches the start of a key and
 * has no globs, so a pattern that looks like one is refused rather than
 * silently matching nothing.
 */
export type ObjectExpiry = Readonly<Record<string, { readonly days: number }>>;

/** An expiry prefix the bucket could not match the way it reads. */
export class ExpiryPrefixInvalid extends Error {
	constructor(
		readonly bucket: string,
		readonly prefix: string,
		readonly reason: string,
	) {
		super(
			`'${bucket}' expires objects under '${prefix}', which ${reason}. ` +
				`Name the start of the keys as they are stored, e.g. 'quotes/'.`,
		);
		this.name = 'ExpiryPrefixInvalid';
	}
}

/** An expiry that is not a whole number of days, one or more. */
export class ExpiryDaysInvalid extends Error {
	constructor(
		readonly bucket: string,
		readonly prefix: string,
		readonly days: unknown,
	) {
		super(
			`'${bucket}' expires '${prefix}' after ${String(days)} days. A bucket ` +
				`counts lifecycle in whole days, so give an integer of 1 or more.`,
		);
		this.name = 'ExpiryDaysInvalid';
	}
}

/**
 * The expiry as the manifest records it — prefix → days — after checking
 * each entry, or nothing when there is none.
 *
 * @throws {ExpiryPrefixInvalid} for an empty, rooted or globbed prefix
 * @throws {ExpiryDaysInvalid} for anything but a positive integer of days
 */
export function expiryDays(
	bucket: string,
	expire: ObjectExpiry | undefined,
): Record<string, number> | undefined {
	if (!expire) return undefined;

	const days: Record<string, number> = {};
	for (const [prefix, { days: count }] of Object.entries(expire)) {
		if (prefix.length === 0) {
			throw new ExpiryPrefixInvalid(bucket, prefix, 'is empty');
		}
		if (prefix.startsWith('/')) {
			throw new ExpiryPrefixInvalid(
				bucket,
				prefix,
				"starts with '/', which no stored key does",
			);
		}
		if (/[*?]/.test(prefix)) {
			throw new ExpiryPrefixInvalid(
				bucket,
				prefix,
				'is a pattern, and a lifecycle prefix is matched literally',
			);
		}
		if (!Number.isInteger(count) || count < 1) {
			throw new ExpiryDaysInvalid(bucket, prefix, count);
		}
		days[prefix] = count;
	}

	return Object.keys(days).length > 0 ? days : undefined;
}
