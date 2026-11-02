/**
 * The origins a client of the surface's own address sends: the `https://`
 * one a native socket derives from `wss://`, and the address's own.
 *
 * Shared by every adaptor that checks a handshake's `Origin` — the Node
 * server and the API Gateway `$connect` handler — so the two trust the same
 * origins for the same address.
 */
export function ownOrigins(url: string | undefined): string[] {
	if (!url || !URL.canParse(url)) return [];
	const own = new URL(url);
	const web = new URL(url.replace(/^ws(s?):/i, 'http$1:'));
	return [...new Set([`${own.protocol}//${own.host}`, web.origin])];
}
