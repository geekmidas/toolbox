import type { RateLimitConfig, RateLimitContext } from '@geekmidas/rate-limit';
import { loadRateLimit } from './optionalPeers';

/**
 * An endpoint's `.rateLimit()`, checked the one way every adaptor checks it —
 * Hono, Lambda and the test adaptor — after the request is authorized.
 *
 * Under the limit, it answers the headers the response carries:
 * `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (and
 * `Retry-After` on the last request the window allows).
 *
 * @throws {TooManyRequestsError} over the limit — `@geekmidas/errors`' 429,
 * whose `headers` hold `Retry-After` (seconds until the window resets) and the
 * same `X-RateLimit-*`, which every adaptor sets on the error response.
 */
export async function enforceRateLimit(
	config: RateLimitConfig,
	ctx: RateLimitContext<any, any, any>,
): Promise<Record<string, string>> {
	const { checkRateLimit, getRateLimitHeaders } = await loadRateLimit();
	const info = await checkRateLimit(config, ctx);

	const headers: Record<string, string> = {};
	for (const [key, value] of Object.entries(
		getRateLimitHeaders(info, config),
	)) {
		if (value !== undefined) headers[key] = value;
	}
	return headers;
}
