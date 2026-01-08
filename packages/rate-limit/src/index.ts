import type { Cache } from '@geekmidas/cache';
import type { Logger } from '@geekmidas/logger';
import type { Service, ServiceRecord } from '@geekmidas/services';

/**
 * Error thrown when rate limit is exceeded
 */
export class TooManyRequestsError extends Error {
	public readonly statusCode = 429;
	public readonly retryAfter?: number;

	constructor(message?: string, retryAfter?: number) {
		super(message || 'Too many requests, please try again later.');
		this.name = 'TooManyRequestsError';
		this.retryAfter = retryAfter;
	}
}

/**
 * Rate limit configuration for an endpoint
 */
export interface RateLimitConfig {
	/**
	 * Maximum number of requests allowed in the window
	 */
	limit: number;

	/**
	 * Time window in milliseconds
	 */
	windowMs: number;

	/**
	 * Cache instance to store rate limit data
	 */
	cache: Cache;

	/**
	 * Key generator function to identify clients
	 * Defaults to using IP address
	 */
	keyGenerator?: RateLimitKeyGenerator;

	/**
	 * Skip rate limiting for certain requests
	 */
	skip?: RateLimitSkipFn;

	/**
	 * Optional message to return when rate limit is exceeded
	 */
	message?: string;

	/**
	 * Optional custom handler when rate limit is exceeded
	 */
	handler?: RateLimitExceededHandler;

	/**
	 * Whether to include rate limit headers in response
	 * @default true
	 */
	standardHeaders?: boolean;

	/**
	 * Whether to include legacy rate limit headers
	 * @default false
	 */
	legacyHeaders?: boolean;
}

/**
 * Context for rate limiting decisions
 */
export interface RateLimitContext<
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	TSession = unknown,
> {
	header: (key: string) => string | undefined;
	services: ServiceRecord<TServices>;
	logger: TLogger;
	session: TSession;
	path: string;
	method: string;
}

/**
 * Function to generate a unique key for rate limiting
 */
export type RateLimitKeyGenerator<
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	TSession = unknown,
> = (
	ctx: RateLimitContext<TServices, TLogger, TSession>,
) => string | Promise<string>;

/**
 * Function to determine if rate limiting should be skipped
 */
export type RateLimitSkipFn<
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	TSession = unknown,
> = (
	ctx: RateLimitContext<TServices, TLogger, TSession>,
) => boolean | Promise<boolean>;

/**
 * Handler for when rate limit is exceeded
 */
export type RateLimitExceededHandler<
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	TSession = unknown,
> = (
	ctx: RateLimitContext<TServices, TLogger, TSession>,
	info: RateLimitInfo,
) => void | Promise<void>;

/**
 * Information about current rate limit status
 */
export interface RateLimitInfo {
	/**
	 * Current request count in the window
	 */
	count: number;

	/**
	 * Maximum allowed requests
	 */
	limit: number;

	/**
	 * Remaining requests allowed
	 */
	remaining: number;

	/**
	 * Time when the window resets (Unix timestamp)
	 */
	resetTime: number;

	/**
	 * Time until reset in milliseconds
	 */
	retryAfter: number;
}

/**
 * Headers to be set on responses
 */
export interface RateLimitHeaders {
	'X-RateLimit-Limit'?: string;
	'X-RateLimit-Remaining'?: string;
	'X-RateLimit-Reset'?: string;
	'Retry-After'?: string;
	'X-RateLimit-Retry-After'?: string;
	'X-RateLimit-Reset-After'?: string;
}

/**
 * Data stored in cache for rate limiting
 */
export interface RateLimitData {
	count: number;
	resetTime: number;
}

/**
 * Default key generator using IP address
 */
export const defaultKeyGenerator: RateLimitKeyGenerator = (ctx) => {
	// Try various headers for IP address
	const ip =
		ctx.header('x-forwarded-for')?.split(',')[0]?.trim() ||
		ctx.header('x-real-ip') ||
		ctx.header('x-client-ip') ||
		ctx.header('cf-connecting-ip') ||
		'unknown';

	return `rate-limit:${ctx.method}:${ctx.path}:${ip}`;
};

/**
 * Check rate limit and throw error if exceeded
 */
export async function checkRateLimit<
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	TSession = unknown,
>(
	config: RateLimitConfig,
	ctx: RateLimitContext<TServices, TLogger, TSession>,
): Promise<RateLimitInfo> {
	// Check if we should skip rate limiting
	if (config.skip && (await config.skip(ctx))) {
		return {
			count: 0,
			limit: config.limit,
			remaining: config.limit,
			resetTime: Date.now() + config.windowMs,
			retryAfter: config.windowMs,
		};
	}

	// Generate key for this request
	const keyGenerator = config.keyGenerator || defaultKeyGenerator;
	const key = await keyGenerator(ctx);

	// Get current data from cache
	const now = Date.now();
	let data = await config.cache.get<RateLimitData>(key);

	// If no data or window expired, create new entry
	if (!data || data.resetTime <= now) {
		const resetTime = now + config.windowMs;
		data = { count: 1, resetTime };

		// Store with TTL matching the window
		const ttlSeconds = Math.ceil(config.windowMs / 1000);
		await config.cache.set(key, data, ttlSeconds);
	} else {
		// Increment count
		data.count++;

		// Calculate remaining TTL
		const remainingMs = data.resetTime - now;
		const ttlSeconds = Math.ceil(remainingMs / 1000);
		await config.cache.set(key, data, ttlSeconds);
	}

	// Calculate rate limit info
	const info: RateLimitInfo = {
		count: data.count,
		limit: config.limit,
		remaining: Math.max(0, config.limit - data.count),
		resetTime: data.resetTime,
		retryAfter: data.resetTime - now,
	};

	// Check if limit exceeded
	if (data.count > config.limit) {
		// Call custom handler if provided
		if (config.handler) {
			await config.handler(ctx, info);
		}

		// Throw rate limit error
		const retryAfterSeconds = Math.ceil(info.retryAfter / 1000);
		throw new TooManyRequestsError(
			config.message || 'Too many requests, please try again later.',
			retryAfterSeconds,
		);
	}

	return info;
}

/**
 * Generate rate limit headers
 */
export function getRateLimitHeaders(
	info: RateLimitInfo,
	config: RateLimitConfig,
): RateLimitHeaders {
	const headers: RateLimitHeaders = {};

	if (config.standardHeaders !== false) {
		headers['X-RateLimit-Limit'] = info.limit.toString();
		headers['X-RateLimit-Remaining'] = info.remaining.toString();
		headers['X-RateLimit-Reset'] = new Date(info.resetTime).toISOString();
	}

	if (config.legacyHeaders) {
		headers['X-RateLimit-Retry-After'] = info.retryAfter.toString();
		headers['X-RateLimit-Reset-After'] = Math.ceil(
			info.retryAfter / 1000,
		).toString();
	}

	// Always set Retry-After when limit is exceeded
	if (info.remaining === 0) {
		headers['Retry-After'] = Math.ceil(info.retryAfter / 1000).toString();
	}

	return headers;
}
