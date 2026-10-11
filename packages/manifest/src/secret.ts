/**
 * What a generated secret looks like, and the one way every stage draws it.
 *
 * A server deploy draws from `crypto`, `gkm dev` and `gkm test` from a hash of
 * the project, stage and id, and an AWS deploy asks Pulumi for the same
 * alphabet. Sharing this is what keeps a password that passes a third party's
 * rules on one stage from failing them on the next.
 */

/** 43 characters from 64 is 256 bits — as much as anything here needs. */
export const SECRET_LENGTH = 43;

/**
 * Two symbols nothing has to escape — not a URL, a connection string, a shell
 * or a `.env` file — which with letters and digits is base64url's alphabet.
 */
export const SECRET_SYMBOLS = '-_';

const LETTERS_AND_DIGITS =
	'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export interface SecretFormat {
	/** How many characters. Defaults to {@link SECRET_LENGTH}. */
	length?: number;
	/**
	 * The characters drawn beside letters and digits, at least one of which is
	 * always present. Defaults to {@link SECRET_SYMBOLS}; `''` draws none.
	 */
	symbols?: string;
}

/**
 * A secret in `format`, each character chosen by `pick(n)` — an integer in
 * `[0, n)` from whatever source the caller trusts.
 *
 * When there are symbols, one is guaranteed: a rule that demands a symbol is
 * the reason anyone names them, and leaving it to chance fails it often —
 * about one draw in seven at 24 characters.
 */
export function drawSecret(
	pick: (n: number) => number,
	format: SecretFormat = {},
): string {
	const length = format.length ?? SECRET_LENGTH;
	const symbols = [...new Set(format.symbols ?? SECRET_SYMBOLS)].join('');
	const alphabet = LETTERS_AND_DIGITS + symbols;

	const chars = Array.from(
		{ length },
		() => alphabet[pick(alphabet.length)] as string,
	);
	if (symbols && !chars.some((char) => symbols.includes(char))) {
		chars[pick(length)] = symbols[pick(symbols.length)] as string;
	}

	return chars.join('');
}
