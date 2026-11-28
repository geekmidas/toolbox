import { isPrivateAddress } from '../privateAddress';

/**
 * A URL a subscription can't deliver to — not a URL, not HTTPS where it has
 * to be, or pointing at this network rather than the receiver's.
 */
export class WebhookUrlNotDeliverable extends Error {
	constructor(
		readonly url: string,
		readonly reason: string,
	) {
		super(
			`'${url}' can't receive webhooks: ${reason}. Register a public https:// URL the receiver serves.`,
		);
		this.name = 'WebhookUrlNotDeliverable';
	}
}

/**
 * Whether deliveries may go to this machine's network and over plain HTTP:
 * under `gkm dev` and in tests, where the receiver is `localhost`. A deployed
 * stage sends to public HTTPS only.
 */
export function deliversLocally(): boolean {
	return (
		process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'
	);
}

/** Host names that are never on the public internet. */
const LOCAL_HOSTS = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i;

/**
 * An address no receiver on the internet has — this network, the carrier's,
 * the unspecified, link-local and multicast ranges — beyond the private
 * ranges {@link isPrivateAddress} already knows.
 */
export function isNonPublicAddress(address: string): boolean {
	if (isPrivateAddress(address)) return true;
	const ip = address.toLowerCase().replace(/^::ffff:/, '');

	const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (v4) {
		const [a, b] = [Number(v4[1]), Number(v4[2])];
		return (
			a === 0 ||
			(a === 100 && b >= 64 && b <= 127) ||
			a >= 224 ||
			(a === 192 && b === 0) ||
			(a === 198 && (b === 18 || b === 19))
		);
	}

	return ip === '::' || /^ff[0-9a-f]{2}:/.test(ip);
}

/**
 * The checks a URL passes before it is stored as a subscription: it parses,
 * it is HTTPS (or HTTP, delivering locally), and it does not name a local
 * host or a non-public address literally.
 *
 * What a name resolves to is checked again at every delivery — a public name
 * can be pointed at a private address after it was registered.
 *
 * @throws {WebhookUrlNotDeliverable}
 */
export function assertDeliverableUrl(
	url: string,
	local: boolean = deliversLocally(),
): URL {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new WebhookUrlNotDeliverable(url, 'it is not a URL');
	}

	if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
		throw new WebhookUrlNotDeliverable(url, 'it is not https://');
	}
	if (parsed.username || parsed.password) {
		throw new WebhookUrlNotDeliverable(url, 'it carries credentials');
	}
	if (local) return parsed;

	const host = parsed.hostname.replace(/^\[|\]$/g, '');
	if (LOCAL_HOSTS.test(host)) {
		throw new WebhookUrlNotDeliverable(url, `'${host}' is a local name`);
	}
	if (isNonPublicAddress(host)) {
		throw new WebhookUrlNotDeliverable(
			url,
			`'${host}' is not a public address`,
		);
	}
	return parsed;
}
