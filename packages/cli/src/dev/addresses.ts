import { wildcardDomainOf } from '@geekmidas/manifest';

/** The slug `gkm dev` shows a wildcard site's address with. */
export const EXAMPLE_TENANT = 'acme';

/**
 * How `gkm dev` prints where an app is reached: its public address, and the
 * local port the edge forwards it to.
 *
 * A wildcard site's address is `https://*.shop.localhost:8443`, which no
 * browser opens, so it is followed by one a browser does: the same address
 * with a slug in place of the `*`.
 */
export function describeAddress(
	url: string | undefined,
	local: string,
): string {
	if (!url) return local;
	const example = tenantUrl(url, EXAMPLE_TENANT);
	return example
		? `${url} -> ${local} (open a tenant: ${example})`
		: `${url} -> ${local}`;
}

/**
 * A wildcard site's address with `slug` in place of the `*` —
 * `https://acme.shop.localhost:8443` — or `undefined` for any other address.
 */
export function tenantUrl(url: string, slug: string): string | undefined {
	const match = /^(https?:\/\/)([^/:]+)(.*)$/.exec(url);
	if (!match) return undefined;
	const [, scheme, host, rest] = match;
	const domain = wildcardDomainOf(host!);
	return domain === undefined ? undefined : `${scheme}${slug}.${domain}${rest}`;
}
