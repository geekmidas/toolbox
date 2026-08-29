/**
 * Reading a backend, or an image pin, out of one `services:` value.
 *
 * `services.cache` and `services.mail` each answer two questions that used to
 * be one: *what runs locally* and *what backs this when deployed*. A boolean or
 * an object is the first; a string is the second. Keeping them in one key rather
 * than adding `cacheBackend` beside `cache` follows `services.events`, which has
 * always been a bare string — and means a project that says `cache: 'db'` has
 * said everything, because a cache in the database needs no container to pin.
 *
 * These readers exist so nothing downstream has to know a value can be either.
 */

import {
	type CacheBackend,
	DEFAULT_CACHE,
	DEFAULT_EMAIL,
	type EmailBackend,
} from '../types.js';

const CACHE_BACKENDS: readonly CacheBackend[] = [
	'upstash',
	'elasticache',
	'db',
];
const EMAIL_BACKENDS: readonly EmailBackend[] = ['resend', 'ses', 'smtp'];

/**
 * The image pin in a `services:` value, if it carries one.
 *
 * A backend name is not one, so it reads as "left at the default" — which it is:
 * naming a backend says nothing about which image the local container should
 * run, and the default is what anyone naming a backend expects.
 */
export function imagePinOf<T>(value: T): Exclude<T, string> | undefined {
	return typeof value === 'string' ? undefined : (value as Exclude<T, string>);
}

/**
 * The cache backend a workspace selected, defaulting to Upstash.
 *
 * Defaulted here rather than by every caller, so "what happens when nobody
 * said" is answered once and the answer is greppable.
 */
export function cacheBackendOf(value: unknown): CacheBackend {
	return isBackend(value, CACHE_BACKENDS) ? value : DEFAULT_CACHE;
}

/** The email backend a workspace selected, defaulting to Resend. */
export function emailBackendOf(value: unknown): EmailBackend {
	return isBackend(value, EMAIL_BACKENDS) ? value : DEFAULT_EMAIL;
}

/**
 * Whether a string names a backend, as opposed to being one of the other things
 * a `services:` value can be.
 *
 * A misspelling falls through to the default rather than throwing, which is the
 * wrong trade for something with a cost attached — so callers that can report it
 * should use {@link unknownBackend} to say so.
 */
function isBackend<T extends string>(
	value: unknown,
	backends: readonly T[],
): value is T {
	return typeof value === 'string' && backends.includes(value as T);
}

/**
 * The backend name in a value that names one wrongly.
 *
 * Returns nothing when the value is not a string at all — an image pin is not a
 * misspelled backend — so a caller can report `cache: 'upstsh'` without
 * complaining about `cache: true`.
 */
export function unknownBackend(
	value: unknown,
	kind: 'cache' | 'mail',
): string | undefined {
	if (typeof value !== 'string') return undefined;

	const backends: readonly string[] =
		kind === 'cache' ? CACHE_BACKENDS : EMAIL_BACKENDS;

	return backends.includes(value) ? undefined : value;
}

/** What a `services:` key accepts, for an error that can list it. */
export function backendsFor(kind: 'cache' | 'mail'): readonly string[] {
	return kind === 'cache' ? CACHE_BACKENDS : EMAIL_BACKENDS;
}
