/**
 * Reads one cookie out of a `Cookie` header.
 *
 * The header is a list of `name=value` pairs, so the name has to be matched
 * against a whole pair. Searching the raw header for `name=` instead lets an
 * attacker prefix their own cookie — `evil_session=ATTACKER; session=REAL`
 * contains `session=ATTACKER` — and the first match wins.
 */
export function readCookie(
	cookieHeader: string | undefined,
	name: string,
): string | null {
	if (!cookieHeader) {
		return null;
	}

	for (const pair of cookieHeader.split(';')) {
		const separator = pair.indexOf('=');
		if (separator === -1) {
			continue;
		}

		if (pair.slice(0, separator).trim() !== name) {
			continue;
		}

		const value = pair.slice(separator + 1).trim();
		return value === '' ? null : value;
	}

	return null;
}
