/**
 * Storage errors — shared by every implementation, not just S3.
 *
 * A `gs://` or Azure client hits the same three problems as the S3 one: the
 * string is not a URL, it is a URL for a different provider, or it addresses no
 * bucket. Each carries the provider-specific detail as a field, so the type is
 * common while the specifics stay accurate.
 *
 * Messages state the rule, which is constant, and never interpolate the value.
 * An interpolated message cannot be matched on, reads differently every time it
 * is thrown, and carries user input into every log line that touches it.
 */

/** Base for anything wrong with a storage URL, so callers may catch broadly. */
export abstract class StorageUrlError extends Error {
	/** The URL that could not be used. */
	readonly url: string;

	constructor(url: string, message: string) {
		super(message);
		this.url = url;
		this.name = new.target.name;
	}
}

/** The string is not a URL at all. */
export class MalformedStorageUrl extends StorageUrlError {
	constructor(url: string) {
		super(url, 'Not a valid URL');
	}
}

/**
 * A URL, but for a different provider — a `gs://` URL reaching the S3 client,
 * or the reverse. The usual cause is a construct resolving against the wrong
 * target, which is worth distinguishing from a malformed string.
 */
export class UnexpectedStorageScheme extends StorageUrlError {
	/** The scheme this client handles, e.g. `'s3:'`. */
	readonly expected: string;
	/** The scheme the URL actually carried, e.g. `'gs:'`. */
	readonly actual: string;

	constructor(url: string, expected: string, actual: string) {
		super(url, 'Storage URL is for a different provider');
		this.expected = expected;
		this.actual = actual;
	}
}

/**
 * A well-formed URL that addresses no bucket.
 *
 * "Bucket" is the term S3 and GCS share; Azure calls the same thing a
 * container. One error covers all three — the word in the message is the
 * common one rather than a new abstraction nobody uses.
 */
export class MissingStorageBucket extends StorageUrlError {
	constructor(url: string) {
		super(url, 'Storage URL must address a bucket');
	}
}

/**
 * No driver is registered for the URL's scheme.
 *
 * Usually means the build pinned a driver for a different target, or an entry
 * point registered nothing at all — so the registered schemes are carried
 * alongside, since "what *is* available" is the actionable half.
 */
export class UnregisteredStorageScheme extends StorageUrlError {
	/** The scheme that had no driver, e.g. `'gs:'`. */
	readonly scheme: string;
	/** What is registered, so the caller can see what was pinned instead. */
	readonly registered: readonly string[];

	constructor(url: string, scheme: string, registered: readonly string[]) {
		super(url, 'No storage driver is registered for this URL scheme');
		this.scheme = scheme;
		this.registered = registered;
	}
}
