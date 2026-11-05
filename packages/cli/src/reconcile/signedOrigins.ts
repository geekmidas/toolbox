/**
 * Where each bucket's presigned links point, derived from its connection.
 *
 * Not stored and not provisioned: the origin is a function of the connection
 * string (`s3Url.signedOrigin`), so it is computed wherever the connection is
 * resolved — a stage's secrets, MinIO locally — and can never disagree with
 * the links the bucket's client signs.
 */

import { providedKeyFor } from '@geekmidas/manifest';
import * as s3Url from '@geekmidas/storage/s3-url';

/**
 * `<ID>_SIGNED_ORIGIN` for each bucket whose connection `lookup` resolves to
 * an `s3://` URL with a knowable host. A bucket with none, or another scheme,
 * gets nothing rather than a guess.
 */
export function signedOrigins(
	buckets: Iterable<string>,
	lookup: (key: string) => string | undefined,
): Record<string, string> {
	const origins: Record<string, string> = {};
	for (const id of buckets) {
		const connection = lookup(
			providedKeyFor(id, 'objects', 'connectionString'),
		);
		if (!connection?.startsWith('s3:')) continue;
		let origin: string | undefined;
		try {
			origin = s3Url.signedOrigin(s3Url.parse(connection));
		} catch {
			continue;
		}
		if (origin) origins[providedKeyFor(id, 'objects', 'signedOrigin')] = origin;
	}
	return origins;
}
