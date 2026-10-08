/**
 * Whose `traceparent` an API continues.
 *
 * An incoming trace context is a claim made by the caller. Continued, it puts
 * this request's span inside whatever trace the caller named, and its sampled
 * flag asks this API to record it. From the API's own sites and from its own
 * services that is the point; from anyone else it lets a stranger graft spans
 * onto another user's trace, or force traces the stage's rate would not keep.
 *
 * So a request's context is continued only when it comes from a trusted source:
 *
 * - **its own sites** — an `Origin` header naming one of the API's allowed CORS
 *   origins (the sites with an edge to it). A browser sets `Origin` itself on
 *   every cross-origin request and a page cannot forge it;
 * - **an internal caller** — no `Origin` at all, no header any reverse proxy
 *   adds (`X-Forwarded-For`, `Forwarded`, `X-Real-IP`, …), and a TCP peer on a
 *   loopback or private address. That is another service calling this one
 *   over the private network by its internal URL: a request from the internet
 *   reaches the API through the stack's proxy, which always adds a forwarding
 *   header, or from a public address.
 *
 * Anything else — an unknown origin, a request through the public proxy with
 * no origin (curl, a server elsewhere) — starts a new trace, linked to the
 * context it claimed so the hop can still be followed.
 *
 * Whether a trusted context is *sampled* is still this API's decision: see
 * `traceSampler`, which caps an incoming sampled flag at the stage's rate.
 */

/**
 * Headers a reverse proxy or CDN adds on the way in.
 *
 * Not `x-gkm-client-ip`: that is gkm's own, sent by a service calling another
 * on a client's behalf (an API's session check), and stripped by the stack's
 * edge from everything that arrives from outside.
 */
const FORWARDING_HEADERS = [
	'forwarded',
	'x-forwarded-for',
	'x-forwarded-host',
	'x-real-ip',
	'cf-connecting-ip',
	'true-client-ip',
	'fastly-client-ip',
	'x-client-ip',
];

/** `origin` normalized the way a browser sends it, or undefined. */
function normalizeOrigin(origin: string): string | undefined {
	try {
		const url = new URL(origin);
		return url.origin === 'null' ? undefined : url.origin;
	} catch {
		return undefined;
	}
}

/**
 * Whether `origin` is one of `trustedOrigins` — exactly, scheme, host and
 * port. A wildcard trusts nothing: an API that answers any origin's CORS has
 * not said which sites are its own.
 */
export function isTrustedOrigin(
	origin: string | undefined,
	trustedOrigins: readonly string[] | undefined,
): boolean {
	if (!origin || !trustedOrigins?.length) return false;
	const normalized = normalizeOrigin(origin);
	if (!normalized) return false;
	return trustedOrigins.some(
		(trusted) => trusted !== '*' && normalizeOrigin(trusted) === normalized,
	);
}

/**
 * Whether `address` is loopback or private: 127/8, 10/8, 172.16/12,
 * 192.168/16, 169.254/16, `::1`, `fc00::/7`, `fe80::/10`, and an IPv4 one
 * mapped into IPv6.
 */
export function isPrivateAddress(address: string | undefined): boolean {
	if (!address) return false;
	const ip = address.toLowerCase().replace(/^::ffff:/, '');

	const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (v4) {
		const [a, b] = [Number(v4[1]), Number(v4[2])];
		return (
			a === 127 ||
			a === 10 ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 169 && b === 254)
		);
	}

	if (ip === '::1') return true;
	return /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip);
}

/** What the internal-caller rule looks at. */
export interface IncomingRequestFacts {
	/** Every request header. */
	headers: Headers | Record<string, string | string[] | undefined>;
	/** The TCP peer's address, when the server knows it. */
	remoteAddress?: string;
}

function header(
	headers: IncomingRequestFacts['headers'],
	name: string,
): string | undefined {
	if (headers instanceof Headers) return headers.get(name) ?? undefined;
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() !== name) continue;
		return Array.isArray(value) ? value[0] : value;
	}
	return undefined;
}

/**
 * Whether a request is an internal caller's: no `Origin`, no forwarding
 * header, and a loopback or private peer. Without a peer address — a request
 * handed to the app in-process, a runtime that does not expose the socket —
 * it is not.
 */
export function isInternalCaller(request: IncomingRequestFacts): boolean {
	if (header(request.headers, 'origin')) return false;
	if (FORWARDING_HEADERS.some((name) => header(request.headers, name))) {
		return false;
	}
	return isPrivateAddress(request.remoteAddress);
}
