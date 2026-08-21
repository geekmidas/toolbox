/**
 * Email URL errors.
 *
 * Every provider is reached over SMTP, so there are only two problems a URL can
 * have: it is not a URL, or it names a scheme this transport cannot speak. Both
 * carry the offending value as a field.
 *
 * Messages state the rule, which is constant, and never interpolate the value.
 * An interpolated message cannot be matched on, reads differently every time it
 * is thrown, and carries user input into every log line that touches it — and a
 * mail URL's userinfo is a credential, which makes that leak a real one here.
 */

/** Base for anything wrong with an email URL, so callers may catch broadly. */
export abstract class EmailUrlError extends Error {
	/** The URL that could not be used. Carries credentials — do not log it. */
	readonly url: string;

	constructor(url: string, message: string) {
		super(message);
		this.url = url;
		this.name = new.target.name;
	}
}

/** The string is not a URL at all. */
export class MalformedEmailUrl extends EmailUrlError {
	constructor(url: string) {
		super(url, 'Not a valid URL');
	}
}

/**
 * A URL, but naming a scheme that is not SMTP.
 *
 * Almost always `ses://` or `resend://` — a provider written where a protocol
 * belongs. Mail is delivered over SMTP whoever is delivering it, so the provider
 * shows up as the URL's host and credentials, never as its scheme.
 */
export class UnsupportedEmailScheme extends EmailUrlError {
	/** The scheme the URL carried, e.g. `'ses:'`. */
	readonly actual: string;
	/** The schemes this transport speaks. */
	readonly expected: readonly string[] = ['smtp:', 'smtps:'];

	constructor(url: string, actual: string) {
		super(url, 'Email URL scheme must be smtp: or smtps:');
		this.actual = actual;
	}
}
