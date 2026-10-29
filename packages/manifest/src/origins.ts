/**
 * Whether a request from `origin` comes from one of `trusted`.
 *
 * An entry matches exactly — scheme, host and port — or, written
 * `https://*.example.com`, matches any one label in place of the `*`:
 * `https://acme.example.com`, never `https://example.com` and never
 * `https://a.b.example.com`. That is the origin a wildcard site's tenants
 * call from, and it is as wide as a wildcard certificate, no wider.
 *
 * A bare `*` trusts nothing: a surface that answers any origin has not said
 * which sites are its own.
 */
export function trustsOrigin(
	origin: string | undefined,
	trusted: readonly string[],
): boolean {
	const request = parse(origin);
	if (!request) return false;

	return trusted.some((entry) => {
		const allowed = parse(entry);
		if (!allowed) return false;
		if (allowed.scheme !== request.scheme) return false;
		if (allowed.port !== request.port) return false;

		const domain = wildcardDomainOf(allowed.host);
		if (domain === undefined) return allowed.host === request.host;

		const dot = request.host.indexOf('.');
		return (
			dot > 0 &&
			LABEL.test(request.host.slice(0, dot)) &&
			request.host.slice(dot + 1) === domain
		);
	});
}

/**
 * The domain under a wildcard host — `example.com` for `*.example.com` — or
 * `undefined` for a host that is not one.
 */
export function wildcardDomainOf(host: string): string | undefined {
	return host.startsWith('*.') ? host.slice(2) : undefined;
}

/** One DNS label, as a tenant's slug is. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function parse(
	origin: string | undefined,
): { scheme: string; host: string; port: string } | undefined {
	if (!origin || origin === '*') return undefined;
	try {
		const url = new URL(origin);
		if (url.origin === 'null') return undefined;
		return {
			scheme: url.protocol,
			host: url.hostname.toLowerCase(),
			port: url.port,
		};
	} catch {
		return undefined;
	}
}
