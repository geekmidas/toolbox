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
