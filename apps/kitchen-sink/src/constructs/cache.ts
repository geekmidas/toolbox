import { Cache } from '@geekmidas/constructs/cache';

/**
 * The app's cache.
 *
 * Declaring it is what puts a Redis (and the HTTP proxy the client speaks to)
 * in the local plan, and what resolves `SESSIONS_URL` — the endpoint with its
 * token, one string. Deployed the same key points at Upstash and the client
 * does not change, which is the whole reason the local target runs a proxy
 * rather than handing out a bare `redis://`.
 */
export const sessions = new Cache('Sessions');
