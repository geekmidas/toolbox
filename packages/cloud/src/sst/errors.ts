/**
 * Adapter errors.
 *
 * Messages state the rule, which is constant; the specifics are fields. An
 * interpolated message cannot be matched on, reads differently every time it is
 * thrown, and carries values into every log line that touches it.
 */

/** A manifest declared a kind this adapter cannot provision. */
export class UnknownDeclarationKind extends Error {
	/** The kind that had no provisioner. */
	readonly kind: string;
	/** What this adapter can provision — the actionable half of the failure. */
	readonly supported: readonly string[];

	constructor(kind: string, supported: readonly string[]) {
		super('No provisioner for this declaration kind');
		this.name = 'UnknownDeclarationKind';
		this.kind = kind;
		this.supported = supported;
	}
}

/**
 * What the app declared a construct provides and what the component actually
 * supplies have diverged.
 *
 * Caught at synth rather than as a missing environment variable at runtime,
 * which is the failure it replaces.
 */
export class ProvidesMismatch extends Error {
	/** The construct whose contract was broken. */
	readonly id: string;
	/** Declared by the app, not supplied by infra. */
	readonly missing: readonly string[];
	/** Supplied by infra, not declared by the app. */
	readonly extra: readonly string[];

	constructor(
		id: string,
		missing: readonly string[],
		extra: readonly string[],
	) {
		super('Declared and supplied env keys do not match');
		this.name = 'ProvidesMismatch';
		this.id = id;
		this.missing = missing;
		this.extra = extra;
	}
}

/** A dependency edge pointed at a construct the manifest does not contain. */
export class UnresolvedDependency extends Error {
	/** The id the edge named. */
	readonly target: string;
	/** What the manifest does contain, so a typo is obvious. */
	readonly available: readonly string[];

	constructor(target: string, available: readonly string[]) {
		super('Dependency target is not in the manifest');
		this.name = 'UnresolvedDependency';
		this.target = target;
		this.available = available;
	}
}

/**
 * A site declared `subdomain: '*'`, which the AWS target cannot serve yet: a
 * distribution answers on the hosts it was given, and a tenant's host is
 * created by the running app.
 */
export class WildcardSiteNotSupported extends Error {
	constructor(readonly id: string) {
		super(
			`'${id}' answers on every subdomain, which the AWS target cannot ` +
				`serve yet. Give it a subdomain of its own to deploy it here.`,
		);
		this.name = 'WildcardSiteNotSupported';
	}
}
