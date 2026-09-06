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
	DEFAULT_STORAGE,
	type EmailBackend,
	type MainProvider,
	type StorageBackend,
} from '../types.js';

const CACHE_BACKENDS: readonly CacheBackend[] = [
	'upstash',
	'elasticache',
	'db',
];
const EMAIL_BACKENDS: readonly EmailBackend[] = ['resend', 'ses', 'smtp'];
const STORAGE_BACKENDS: readonly StorageBackend[] = ['minio', 's3', 'r2'];

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
 * The cache backend a workspace selected, or the one its target implies.
 *
 * Defaulted here rather than by every caller, so "what happens when nobody
 * said" is answered once and the answer is greppable — and now answered by
 * *where it deploys*, because there is no single right answer for both a
 * Lambda and a box running its own Postgres.
 *
 * `on` is the deploy target, not where this code happens to be running. A
 * local `gkm dev` for an AWS app still defaults to Upstash, because a backend
 * that differed between local and deployed would be worse than a slower one —
 * which is the property the type's own documentation asks for.
 */
export function cacheBackendOf(
	value: unknown,
	on: MainProvider = 'aws',
): CacheBackend {
	return isBackend(value, CACHE_BACKENDS) ? value : DEFAULT_CACHE[on];
}

/** The email backend a workspace selected, defaulting to SES on every target. */
export function emailBackendOf(value: unknown): EmailBackend {
	return isBackend(value, EMAIL_BACKENDS) ? value : DEFAULT_EMAIL;
}

/** The storage backend a workspace selected, or the one its target implies. */
export function storageBackendOf(
	value: unknown,
	on: MainProvider = 'aws',
): StorageBackend {
	return isBackend(value, STORAGE_BACKENDS) ? value : DEFAULT_STORAGE[on];
}

/**
 * Which family of defaults a workspace's deploy target belongs to.
 *
 * One question, asked once: **does this target run containers the project
 * controls?** Dokploy and a bare server do, so a bucket or a cache can live
 * beside the app; AWS, Vercel and Cloudflare do not, so the default has to be
 * something managed. That is the whole of the distinction, and it is why
 * `MainProvider` is the right axis rather than the deploy target's own name —
 * three targets share one answer.
 *
 * An AWS deploy names no `deploy.default` at all, because it goes through SST,
 * which is why the absence is what selects `aws`.
 */
export function providerOf(workspace: {
	deploy?: { default?: string } | undefined;
}): MainProvider {
	const target = workspace.deploy?.default;

	return target === 'dokploy' || target === 'server' ? 'server' : 'aws';
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
	kind: BackendKind,
): string | undefined {
	if (typeof value !== 'string') return undefined;

	return backendsFor(kind).includes(value) ? undefined : value;
}

/** A `services:` key that selects a backend. */
export type BackendKind = 'cache' | 'mail' | 'storage';

/** What a `services:` key accepts, for an error that can list it. */
export function backendsFor(kind: BackendKind): readonly string[] {
	if (kind === 'cache') return CACHE_BACKENDS;
	if (kind === 'storage') return STORAGE_BACKENDS;

	return EMAIL_BACKENDS;
}
