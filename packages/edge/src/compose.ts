/**
 * Text written into a compose file as it is, for compose to read back
 * unchanged: every `$` doubled, compose's escape for a literal `$`.
 *
 * Compose interpolates variables throughout the file — an inline config's
 * `content` included — so a `$` left alone is read as the start of a
 * variable's name. A bcrypt hash in a Caddyfile (`$2a$10$AbCd…`) lost the
 * salt's first letters to an unset `$AbCd`, and one with `${` failed to parse.
 */
export function composeLiteral(text: string): string {
	return text.replaceAll('$', '$$$$');
}
