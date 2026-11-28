import type { HttpError } from '@geekmidas/errors';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { PROBLEM_CONTENT_TYPE, problemOf } from './problems';

/**
 * The problem details response Hono answers `error` with, carrying the
 * headers the error says its response has (a 429's `Retry-After`).
 */
export function honoProblem(
	c: Context,
	error: HttpError,
	options: { isDev: boolean },
): Response {
	for (const [key, value] of Object.entries(error.headers ?? {})) {
		c.header(key, value);
	}
	return c.json(
		problemOf(error, options),
		error.statusCode as ContentfulStatusCode,
		{ 'Content-Type': PROBLEM_CONTENT_TYPE },
	);
}
