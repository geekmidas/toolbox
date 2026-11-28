/**
 * Receiving the webhooks a `@geekmidas/constructs` service sends: checking a
 * request is signed by the subscription's secret and recent, then reading
 * the event out of it.
 *
 * The scheme is [Standard Webhooks](https://www.standardwebhooks.com/):
 * `webhook-id`, `webhook-timestamp` (unix seconds) and `webhook-signature`,
 * one or more space-separated `v1,<base64 HMAC-SHA256>` of
 * `${id}.${timestamp}.${body}`, keyed with the base64 part of the
 * `whsec_…` secret. WebCrypto only, so it runs in a browser, a worker, Deno,
 * Bun and Node alike.
 */

/** An event a receiver is sent, by type — what a generated client's `webhooks` maps. */
export type WebhookEventMap = Record<
	string,
	{ type: string; payload: unknown }
>;

/**
 * The body of a webhook: the event, with the id it was published under and
 * when it occurred (ISO 8601).
 */
export type WebhookEvent<TEvents extends WebhookEventMap = WebhookEventMap> =
	TEvents[keyof TEvents] & { id: string; occurredAt: string };

/** A request as frameworks hand it over when a `Request` is not to hand. */
export interface RawWebhookRequest {
	headers:
		| Headers
		| Record<string, string | readonly string[] | undefined | null>;
	/** The body exactly as received — re-serialised JSON no longer verifies. */
	body: string;
}

export interface VerifyWebhookOptions {
	/** How far the timestamp may be from now, either way. Five minutes by default. */
	toleranceSeconds?: number;
	/** What time it is — `new Date()` by default. */
	now?: Date;
}

/** A webhook request without one of the headers a signed one carries. */
export class WebhookHeadersMissing extends Error {
	constructor(readonly missing: readonly string[]) {
		super(
			`The request is missing ${missing.map((h) => `'${h}'`).join(', ')}. Pass the request as it was received, headers included.`,
		);
		this.name = 'WebhookHeadersMissing';
	}
}

/** No signature on the request was made with the secret. */
export class WebhookSignatureInvalid extends Error {
	constructor(readonly webhookId: string) {
		super(
			`Webhook '${webhookId}' is not signed with this secret. Check the secret is the subscription's, and that the body is verified exactly as received.`,
		);
		this.name = 'WebhookSignatureInvalid';
	}
}

/** The request's timestamp is outside the tolerance — a replay, or a clock far off. */
export class WebhookTimestampOutOfRange extends Error {
	constructor(
		readonly webhookId: string,
		readonly timestamp: number,
		readonly toleranceSeconds: number,
	) {
		super(
			`Webhook '${webhookId}' was signed at ${timestamp}, more than ${toleranceSeconds}s from now. Refuse it; if this machine's clock is off, fix the clock.`,
		);
		this.name = 'WebhookTimestampOutOfRange';
	}
}

/** The secret is not a `whsec_…` secret. */
export class WebhookSecretInvalid extends Error {
	constructor() {
		super(
			"The webhook secret is not valid base64. Use the 'whsec_…' secret returned when the subscription was created.",
		);
		this.name = 'WebhookSecretInvalid';
	}
}

/**
 * Check a webhook request and return its event.
 *
 * Accepted when any one of its signatures was made with `secret` (or any one
 * of `secret`, when given several) and its timestamp is within
 * `toleranceSeconds` of now. The body is read as text, so pass
 * `request.clone()` to read it again afterwards.
 *
 * ```ts
 * import type { webhooks } from './client';
 *
 * const event = await verifyWebhook<webhooks>(process.env.WEBHOOK_SECRET, request);
 * if (event.type === 'invoice.paid') event.payload.invoiceId;
 * ```
 *
 * @throws {WebhookHeadersMissing} a `webhook-*` header is absent
 * @throws {WebhookTimestampOutOfRange} it is stale, or from the future
 * @throws {WebhookSignatureInvalid} no signature matches
 */
export async function verifyWebhook<
	TEvents extends WebhookEventMap = WebhookEventMap,
>(
	secret: string | readonly string[],
	request: Request | RawWebhookRequest,
	options: VerifyWebhookOptions = {},
): Promise<WebhookEvent<TEvents>> {
	const toleranceSeconds = options.toleranceSeconds ?? 300;
	const header = headerReader(request.headers);
	const id = header('webhook-id');
	const timestamp = header('webhook-timestamp');
	const signature = header('webhook-signature');
	const missing = [
		['webhook-id', id],
		['webhook-timestamp', timestamp],
		['webhook-signature', signature],
	]
		.filter(([, value]) => !value)
		.map(([name]) => name as string);
	if (missing.length > 0) throw new WebhookHeadersMissing(missing);

	const signedAt = Number(timestamp);
	const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
	if (
		!Number.isInteger(signedAt) ||
		Math.abs(now - signedAt) > toleranceSeconds
	) {
		throw new WebhookTimestampOutOfRange(
			id as string,
			signedAt,
			toleranceSeconds,
		);
	}

	const body =
		typeof (request as Request).text === 'function'
			? await (request as Request).text()
			: (request as RawWebhookRequest).body;
	const signed = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
	const offered = (signature as string)
		.split(' ')
		.filter((entry) => entry.startsWith('v1,'))
		.map((entry) => entry.slice(3));

	const secrets = typeof secret === 'string' ? [secret] : secret;
	for (const one of secrets) {
		const key = await crypto.subtle.importKey(
			'raw',
			secretBytes(one),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['verify'],
		);
		for (const candidate of offered) {
			const mac = base64Bytes(candidate);
			// `verify` compares in constant time.
			if (mac && (await crypto.subtle.verify('HMAC', key, mac, signed))) {
				return JSON.parse(body) as WebhookEvent<TEvents>;
			}
		}
	}
	throw new WebhookSignatureInvalid(id as string);
}

function headerReader(
	headers: Request['headers'] | RawWebhookRequest['headers'],
): (name: string) => string | undefined {
	if (typeof (headers as Headers).get === 'function') {
		return (name) => (headers as Headers).get(name) ?? undefined;
	}
	const record = headers as Record<string, unknown>;
	const lower = new Map(
		Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]),
	);
	return (name) => {
		const value = lower.get(name);
		if (Array.isArray(value)) return value.join(' ') || undefined;
		return typeof value === 'string' ? value : undefined;
	};
}

function secretBytes(secret: string): Uint8Array<ArrayBuffer> {
	const bytes = base64Bytes(secret.replace(/^whsec_/, ''));
	if (!bytes) throw new WebhookSecretInvalid();
	return bytes;
}

function base64Bytes(value: string): Uint8Array<ArrayBuffer> | undefined {
	try {
		const binary = atob(value);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return bytes;
	} catch {
		return undefined;
	}
}
