/**
 * Database URL errors and redaction — engine-neutral.
 *
 * Nothing here is Postgres-specific: every engine addresses itself as a URL
 * carrying a password, and "must name a host" holds for all of them. The parts
 * that differ — libpq's `options=-c search_path=…`, which no other engine
 * accepts — live under the driver they belong to.
 *
 * Messages state the rule, which is constant; the offending value is a field.
 * An interpolated message cannot be matched on and carries user input into
 * every log line that touches it.
 */

/**
 * Replace the password in a connection string with `***`.
 *
 * A connection string is a secret, and the places it is most likely to be
 * written down — a log line, an error, a crash report shipped to a third party
 * — are the places nobody is reading carefully. This exists so that redacting
 * is the easy thing to do at each of them.
 *
 * Safe on input that is not a URL: it returns a constant rather than throwing,
 * because this runs on paths that must not fail. Anything unparseable is
 * treated as potentially secret and withheld entirely rather than echoed.
 */
export function redactDatabaseUrl(url: string): string {
	try {
		const parsed = new URL(url);
		if (!parsed.password) return url;
		parsed.password = '***';
		return parsed.toString();
	} catch {
		return '<unparseable url>';
	}
}

/**
 * Base for an address that cannot become a connection string.
 *
 * Deliberately carries no URL field: these are thrown while *composing* one, so
 * there is no URL yet — only the parts, which include the password.
 */
export abstract class DatabaseAddressError extends Error {
	constructor(message: string) {
		super(message);
		this.name = new.target.name;
	}
}

/** An address with no host to connect to. */
export class MissingDatabaseHost extends DatabaseAddressError {
	constructor() {
		super('A database address must name a host');
	}
}

/**
 * An address with no database name.
 *
 * Postgres silently falls back to the connecting role's name, so the app
 * connects successfully to the wrong database and fails later with confusing
 * "relation does not exist" errors. Rejecting it here is much cheaper.
 */
export class MissingDatabaseName extends DatabaseAddressError {
	constructor() {
		super('A database address must name a database');
	}
}
