import type { Context } from 'hono';
import qs from 'qs';

/**
 * Parse Hono query parameters using qs bracket notation
 * Supports nested objects, arrays, and deep nesting via standard bracket syntax
 */
export function parseHonoQuery(c: Context): Record<string, any> {
	const url = c.req.url;
	const queryIndex = url.indexOf('?');
	if (queryIndex === -1) {
		return {};
	}
	const queryString = url.slice(queryIndex + 1);
	return qs.parse(queryString) as Record<string, any>;
}
