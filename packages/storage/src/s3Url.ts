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

import {
	IncompleteStorageCredentials,
	MalformedStorageUrl,
	MissingStorageBucket,
	UnexpectedStorageScheme,
} from './errors';

/**
 * What an S3 URL addresses, and optionally who it calls as.
 *
 * Credentials are optional and come as a pair. With them, the URL is a key
 * scoped to this one bucket (`s3://KEY:SECRET@uploads`); without them the AWS
 * SDK resolves its own chain — an execution role when deployed,
 * `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` otherwise. The URL's pair wins
 * over that chain.
 */
export interface S3Address {
	bucket: string;
	/** Read off the bucket, never inherited: a bucket may live in another region. */
	region?: string;
	/** Set for S3-compatible backends such as MinIO. */
	endpoint?: string;
	/** MinIO and most S3-compatible servers need path-style addressing. */
	forcePathStyle?: boolean;
	/** The URL's own access key; always paired with `secretAccessKey`. */
	accessKeyId?: string;
	/** The URL's own secret; always paired with `accessKeyId`. */
	secretAccessKey?: string;
}

const SCHEME = 's3:';

/**
 * Compose an address into a URL.
 *
 * Credentials appear only when the address carries them, percent-encoded —
 * AWS secrets routinely contain `/` and `+`. An address without them builds a
 * URL with no userinfo, which leaves the caller to the SDK's own chain.
 */
export function build(address: S3Address): string {
	const {
		bucket,
		region,
		endpoint,
		forcePathStyle,
		accessKeyId,
		secretAccessKey,
	} = address;
	if (!bucket) throw new MissingStorageBucket('');

	const url = new URL(`${SCHEME}//${bucket}`);
	if (accessKeyId || secretAccessKey) {
		if (!accessKeyId) {
			throw new IncompleteStorageCredentials(url.toString(), 'accessKeyId');
		}
		if (!secretAccessKey) {
			throw new IncompleteStorageCredentials(url.toString(), 'secretAccessKey');
		}
		url.username = encodeURIComponent(accessKeyId);
		url.password = encodeURIComponent(secretAccessKey);
	}
	if (region) url.searchParams.set('region', region);
	if (endpoint) url.searchParams.set('endpoint', endpoint);
	if (forcePathStyle) url.searchParams.set('forcePathStyle', 'true');
	return url.toString();
}

/**
 * Parse a URL back into an address. Throws if it is not an `s3://` URL, or if
 * its userinfo carries only one half of a key pair.
 */
export function parse(url: string): S3Address {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new MalformedStorageUrl(url);
	}

	if (parsed.protocol !== SCHEME) {
		throw new UnexpectedStorageScheme(url, SCHEME, parsed.protocol);
	}

	const bucket = parsed.hostname;
	if (!bucket) throw new MissingStorageBucket(url);

	const region = parsed.searchParams.get('region') ?? undefined;
	const endpoint = parsed.searchParams.get('endpoint') ?? undefined;
	const forcePathStyle =
		parsed.searchParams.get('forcePathStyle') === 'true' ? true : undefined;
	const credentials = credentialsOf(url, parsed);

	return {
		bucket,
		...(region ? { region } : {}),
		...(endpoint ? { endpoint } : {}),
		...(forcePathStyle ? { forcePathStyle } : {}),
		...credentials,
	};
}

/** The URL's userinfo as a key pair: both halves, or nothing. */
function credentialsOf(
	url: string,
	parsed: URL,
): Pick<S3Address, 'accessKeyId' | 'secretAccessKey'> {
	const accessKeyId = decode(url, parsed.username);
	const secretAccessKey = decode(url, parsed.password);
	if (!accessKeyId && !secretAccessKey) return {};
	if (!accessKeyId) {
		throw new IncompleteStorageCredentials(url, 'accessKeyId');
	}
	if (!secretAccessKey) {
		throw new IncompleteStorageCredentials(url, 'secretAccessKey');
	}
	return { accessKeyId, secretAccessKey };
}

function decode(url: string, value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		throw new MalformedStorageUrl(url);
	}
}
