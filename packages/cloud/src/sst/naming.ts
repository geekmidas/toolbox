/**
 * Kebab-cases an identifier: `userName` → `user-name`, `my_handler` →
 * `my-handler`, and acronym-aware (`APIKey` → `api-key`, `XMLParser` →
 * `xml-parser`).
 */
export function kebab(value: string): string {
	return value
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/[\s_]+/g, '-')
		.toLowerCase();
}

/**
 * Builds a kebab-cased, prefixed physical resource name. The `prefix` parts
 * (e.g. `[stage, name]`) are joined and lower-cased; if `resource` already
 * starts with that prefix it is returned as-is (kebab-cased) to avoid doubling.
 */
export function prefixedName(prefix: string[], resource: string): string {
	const joined = prefix.join('-').toLowerCase();
	const name = kebab(resource);
	return name.startsWith(joined) ? name : `${joined}-${name}`;
}
