/**
 * Manifest errors.
 *
 * Messages state the rule, which is constant; the offending value is a field.
 * An interpolated message cannot be matched on, reads differently every time it
 * is thrown, and carries user input into every log line that touches it.
 */

/** A construct id that cannot survive the names derived from it. */
export class InvalidConstructId extends Error {
	/** What was passed in. */
	readonly input: string;
	/** What canonicalising it produced, which is what failed the rule. */
	readonly canonical: string;

	constructor(input: string, canonical: string) {
		super(
			'A construct id must start with a letter and contain only letters and digits',
		);
		this.name = 'InvalidConstructId';
		this.input = input;
		this.canonical = canonical;
	}
}

/** A derived construct naming a parent the manifest does not contain. */
export class UnknownParent extends Error {
	/** The derived construct. */
	readonly id: string;
	/** The parent it named. */
	readonly of: string;
	/** Ids the manifest does contain, for the caller to match against. */
	readonly available: readonly string[];

	constructor(id: string, of: string, available: readonly string[]) {
		super('A derived construct must name a parent present in the manifest');
		this.name = 'UnknownParent';
		this.id = id;
		this.of = of;
		this.available = available;
	}
}

/**
 * A derived construct naming a parent that may not vend it — a reader of a
 * reader, a schema of a schema.
 */
export class IllegalDerivation extends Error {
	readonly id: string;
	readonly kind: string;
	/** The kind of the parent it named. */
	readonly parentKind: string;
	/** The parent kinds that may vend this one. */
	readonly allowed: readonly string[];

	constructor(
		id: string,
		kind: string,
		parentKind: string,
		allowed: readonly string[],
	) {
		super('A derived construct must name a parent whose kind may vend it');
		this.name = 'IllegalDerivation';
		this.id = id;
		this.kind = kind;
		this.parentKind = parentKind;
		this.allowed = allowed;
	}
}
