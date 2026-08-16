/**
 * The `s3://` URL codec — how an S3 bucket is addressed as a single string.
 *
 * It lives beside the client rather than in a neutral package because `bucket`,
 * `region`, and `forcePathStyle` are S3's vocabulary. The neutral layer only
 * knows that a construct provides *one URL*; what that URL says is between the
 * component that composes it and the client that parses it. A `gs://` codec
 * would sit beside its own client and share nothing with this one.
 *
 * Both directions live here so they cannot drift: `parse(build(x))` is `x`.
 */

/** What an S3 URL addresses. Credentials are deliberately absent — see below. */
export interface S3Address {
	bucket: string;
	/** Read off the bucket, never inherited: a bucket may live in another region. */
	region?: string;
	/** Set for S3-compatible backends such as MinIO. */
	endpoint?: string;
	/** MinIO and most S3-compatible servers need path-style addressing. */
	forcePathStyle?: boolean;
}

const SCHEME = 's3:';

/**
 * Compose an address into a URL.
 *
 * Credentials never appear. The AWS SDK resolves them from its own chain — an
 * execution role when deployed, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`
 * locally — so the URL stays safe to log and identical across environments that
 * differ only in who is calling.
 */
export function build(address: S3Address): string {
	const { bucket, region, endpoint, forcePathStyle } = address;
	if (!bucket) throw new Error('An s3 URL needs a bucket');

	const url = new URL(`${SCHEME}//${bucket}`);
	if (region) url.searchParams.set('region', region);
	if (endpoint) url.searchParams.set('endpoint', endpoint);
	if (forcePathStyle) url.searchParams.set('forcePathStyle', 'true');
	return url.toString();
}

/** Parse a URL back into an address. Throws if it is not an `s3://` URL. */
export function parse(url: string): S3Address {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`Not a valid URL: ${JSON.stringify(url)}`);
	}

	if (parsed.protocol !== SCHEME) {
		throw new Error(
			`Expected an ${SCHEME}// URL, got ${JSON.stringify(parsed.protocol)}`,
		);
	}

	const bucket = parsed.hostname;
	if (!bucket) throw new Error(`No bucket in ${JSON.stringify(url)}`);

	const region = parsed.searchParams.get('region') ?? undefined;
	const endpoint = parsed.searchParams.get('endpoint') ?? undefined;
	const forcePathStyle =
		parsed.searchParams.get('forcePathStyle') === 'true' ? true : undefined;

	return {
		bucket,
		...(region ? { region } : {}),
		...(endpoint ? { endpoint } : {}),
		...(forcePathStyle ? { forcePathStyle } : {}),
	};
}
