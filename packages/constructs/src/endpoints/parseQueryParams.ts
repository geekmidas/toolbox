import qs from 'qs';

/**
 * Parse query parameters from a flat object into a nested structure
 * Uses qs bracket notation for standard interoperability
 *
 * @example
 * parseQueryParams({ 'tags[]': ['a', 'b'], 'filter[name]': 'john' })
 * // Returns: { tags: ['a', 'b'], filter: { name: 'john' } }
 */
export function parseQueryParams(
	queryParams: Record<string, string | string[] | undefined> | null,
): Record<string, any> {
	if (!queryParams) {
		return {};
	}

	// Reconstruct a query string from the flat object so qs can parse bracket notation
	const parts: string[] = [];
	for (const [key, value] of Object.entries(queryParams)) {
		if (value === undefined) continue;
		if (Array.isArray(value)) {
			for (const v of value) {
				parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
			}
		} else {
			parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
		}
	}

	return qs.parse(parts.join('&')) as Record<string, any>;
}
