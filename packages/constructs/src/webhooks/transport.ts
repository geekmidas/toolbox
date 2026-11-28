import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import {
	assertDeliverableUrl,
	deliversLocally,
	isNonPublicAddress,
} from './url';

/**
 * How a delivery's request leaves the process — the one seam between a
 * `Webhooks` construct and the network.
 *
 * Deployed, it is {@link webhookTransport}: redirects left unfollowed (a
 * receiver that answers 3xx has not accepted the delivery, and following it
 * would send a signed body to wherever the redirect points), every address a
 * name resolves to checked as the connection is made, a timeout, and a cap on
 * how much of the answer is read. A test hands the construct one that never
 * reaches the network.
 */
export type WebhookTransport = (request: Request) => Promise<Response>;

/** How long a receiver has to answer, headers and body, by default. */
export const WEBHOOK_TIMEOUT_MS = 10_000;

/** How much of a receiver's answer is read, by default: the rest is dropped. */
export const WEBHOOK_MAX_RESPONSE_BYTES = 64 * 1024;

/** What {@link webhookTransport} is built with. */
export interface WebhookTransportOptions {
	/**
	 * Whether deliveries may go to this machine's network and over plain HTTP.
	 * Read at every request when left out — {@link deliversLocally}, so under
	 * `gkm dev` and in tests.
	 */
	local?: boolean;
	/** How long a request may take, answer included. Ten seconds by default. */
	timeoutMs?: number;
	/** How much of an answer is read. 64 KiB by default. */
	maxResponseBytes?: number;
	/**
	 * How a name is resolved — `dns.lookup` by default. Whatever it returns is
	 * checked before a connection is made, so a test can point a public-looking
	 * name at a private address and see it refused.
	 */
	lookup?: typeof dnsLookup;
}

/**
 * A delivery's host resolved to an address no receiver on the internet has —
 * this network, a cloud's metadata service, a reserved range. Refused at the
 * connection, so a name re-pointed after it was registered sends nothing.
 */
export class WebhookAddressRefused extends Error {
	constructor(
		readonly url: string,
		readonly host: string,
		readonly address: string,
	) {
		super(
			`Refused to deliver to '${url}': '${host}' resolves to ${address}, which is not a public address. The subscription has to name a host that resolves to the receiver's public address.`,
		);
		this.name = 'WebhookAddressRefused';
	}
}

/** The receiver took longer than the transport allows. */
export class WebhookRequestTimedOut extends Error {
	constructor(
		readonly url: string,
		readonly timeoutMs: number,
	) {
		super(
			`'${url}' did not answer within ${timeoutMs}ms. A receiver should acknowledge a delivery at once and do its work afterwards.`,
		);
		this.name = 'WebhookRequestTimedOut';
	}
}

/** Statuses whose response can carry no body, which `Response` refuses one for. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * The transport deliveries go through unless a test swaps it: Node's own
 * HTTP client, so that each address a name resolves to is checked as the
 * socket connects — no second lookup a rebinding name could answer
 * differently.
 *
 * - Off a local stage, the URL has to be public HTTPS
 *   ({@link assertDeliverableUrl}), and every address the host resolves to
 *   public ({@link WebhookAddressRefused} otherwise).
 * - Redirects are never followed: a 3xx comes back as it is.
 * - The whole exchange is bounded by `timeoutMs` ({@link WebhookRequestTimedOut}).
 * - At most `maxResponseBytes` of the answer is read; the rest is dropped.
 */
export function webhookTransport(
	options: WebhookTransportOptions = {},
): WebhookTransport {
	const timeoutMs = options.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
	const maxBytes = options.maxResponseBytes ?? WEBHOOK_MAX_RESPONSE_BYTES;
	const resolve = options.lookup ?? dnsLookup;

	return async (request) => {
		const local = options.local ?? deliversLocally();
		const url = assertDeliverableUrl(request.url, local);
		const host = url.hostname.replace(/^\[|\]$/g, '');
		const body = Buffer.from(await request.arrayBuffer());

		const guardedLookup: LookupFunction = (hostname, lookupOptions, done) => {
			resolve(hostname, { ...lookupOptions, all: true }, (error, found) => {
				if (error) return done(error, '', 0);
				const addresses = found as unknown as LookupAddress[];
				if (!local) {
					const refused = addresses.find((a) => isNonPublicAddress(a.address));
					if (refused) {
						return done(
							new WebhookAddressRefused(request.url, host, refused.address),
							'',
							0,
						);
					}
				}
				if (lookupOptions.all) return done(null, addresses);
				const [first] = addresses;
				if (!first) return done(null, '', 0);
				done(null, first.address, first.family);
			});
		};

		// A literal address is connected to without a lookup: checked here.
		if (!local && isIP(host) && isNonPublicAddress(host)) {
			throw new WebhookAddressRefused(request.url, host, host);
		}

		const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
		const headers: Record<string, string> = {};
		request.headers.forEach((value, name) => {
			headers[name] = value;
		});
		headers['content-length'] = String(body.byteLength);

		return new Promise<Response>((settle, fail) => {
			const outgoing = send(url, {
				method: request.method,
				headers,
				lookup: guardedLookup,
			});

			const timer = setTimeout(() => {
				outgoing.destroy(new WebhookRequestTimedOut(request.url, timeoutMs));
			}, timeoutMs);
			const finish = (outcome: () => void) => {
				clearTimeout(timer);
				outcome();
			};

			outgoing.on('error', (error) => finish(() => fail(error)));
			outgoing.on('response', (incoming: IncomingMessage) => {
				readCapped(incoming, maxBytes).then(
					(answer) => finish(() => settle(toResponse(incoming, answer))),
					(error) => finish(() => fail(error)),
				);
			});
			outgoing.end(body);
		});
	};
}

/** The default transport: {@link webhookTransport} with its defaults. */
export const defaultTransport: WebhookTransport = webhookTransport();

/** At most `max` bytes of a response, then the socket is let go. */
function readCapped(incoming: IncomingMessage, max: number): Promise<Buffer> {
	return new Promise((settle, fail) => {
		const chunks: Buffer[] = [];
		let size = 0;
		incoming.on('data', (chunk: Buffer) => {
			const room = max - size;
			if (room > 0) chunks.push(chunk.subarray(0, room));
			size += chunk.byteLength;
			if (size >= max) {
				incoming.destroy();
				settle(Buffer.concat(chunks));
			}
		});
		incoming.on('end', () => settle(Buffer.concat(chunks)));
		incoming.on('error', fail);
		// Destroyed after the cap: `close` without `end`, already settled.
		incoming.on('close', () => settle(Buffer.concat(chunks)));
	});
}

function toResponse(incoming: IncomingMessage, body: Buffer): Response {
	const status = incoming.statusCode ?? 0;
	const headers = new Headers();
	for (const [name, value] of Object.entries(incoming.headers)) {
		if (value === undefined) continue;
		for (const one of Array.isArray(value) ? value : [value]) {
			headers.append(name, one);
		}
	}
	// `Response` takes 200–599 only; anything else is reported as a 502, and
	// what the receiver actually said is lost only for statuses no receiver
	// should send.
	const valid = status >= 200 && status <= 599 ? status : 502;
	return new Response(
		NULL_BODY_STATUSES.has(valid) ? null : new Uint8Array(body),
		{ status: valid, statusText: incoming.statusMessage, headers },
	);
}
