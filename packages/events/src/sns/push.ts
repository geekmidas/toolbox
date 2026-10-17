import { createVerify } from 'node:crypto';
import {
	ConfirmSubscriptionCommand,
	GetSubscriptionAttributesCommand,
	ListSubscriptionsByTopicCommand,
	SetSubscriptionAttributesCommand,
	SubscribeCommand,
	type SubscribeCommandInput,
	UnsubscribeCommand,
} from '@aws-sdk/client-sns';
import type { SNSConnection } from './SNSConnection';

/**
 * SNS delivering to an HTTP(S) endpoint, rather than to a queue that is polled.
 *
 * SNS POSTs each message to the subscribed URL as JSON. That is the whole
 * transport: no queue in between, no poller, and the endpoint is handed the
 * same envelope a Lambda subscription receives inside `Records[].Sns` — so the
 * handler that runs deployed can be the one that runs here.
 *
 * The endpoint is public, so a message is trusted only once its signature
 * checks out against a certificate SNS itself serves. Anything else that POSTs
 * there is somebody's guess at the shape.
 */

/** A message SNS POSTs to a subscribed HTTP endpoint. */
export interface SnsHttpMessage {
	Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation';
	MessageId: string;
	TopicArn: string;
	Message: string;
	Timestamp: string;
	SignatureVersion: string;
	Signature: string;
	SigningCertURL: string;
	Subject?: string;
	/** Confirmation messages only. */
	Token?: string;
	/** Confirmation messages only: GET it to confirm. */
	SubscribeURL?: string;
	/** Notifications only. */
	UnsubscribeURL?: string;
	MessageAttributes?: Record<string, { Type: string; Value: string }>;
}

/** The fields signed, in the order SNS signs them, per message type. */
const SIGNED_FIELDS: Record<SnsHttpMessage['Type'], (keyof SnsHttpMessage)[]> =
	{
		Notification: [
			'Message',
			'MessageId',
			'Subject',
			'Timestamp',
			'TopicArn',
			'Type',
		],
		SubscriptionConfirmation: [
			'Message',
			'MessageId',
			'SubscribeURL',
			'Timestamp',
			'Token',
			'TopicArn',
			'Type',
		],
		UnsubscribeConfirmation: [
			'Message',
			'MessageId',
			'SubscribeURL',
			'Timestamp',
			'Token',
			'TopicArn',
			'Type',
		],
	};

/**
 * Where SNS serves its signing certificates. Anywhere else is a certificate
 * the sender chose, which would let the sender sign its own forgeries.
 */
const SNS_CERTIFICATE_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

export interface VerifySnsMessageOptions {
	/**
	 * Fetch the PEM at a certificate URL. `fetch` by default; replaceable so a
	 * test signs with its own key instead of SNS's.
	 */
	fetchCertificate?: (url: string) => Promise<string>;
}

const certificates = new Map<string, Promise<string>>();

async function defaultFetchCertificate(url: string): Promise<string> {
	const response = await fetch(url);
	if (!response.ok) throw new SnsCertificateUnavailable(url, response.status);
	return response.text();
}

/**
 * A URL, or undefined for a value that is not one at all — what an emulator
 * sends — so it is untrusted rather than a crash. (`URL.parse` is Node 22.1+.)
 */
function parseUrl(value: unknown): URL | undefined {
	try {
		return new URL(String(value));
	} catch {
		return undefined;
	}
}

/** The string SNS signed for this message. */
export function snsStringToSign(message: SnsHttpMessage): string {
	const fields = SIGNED_FIELDS[message.Type];
	if (!fields) throw new SnsMessageTypeUnknown(String(message.Type));

	return fields
		.filter((field) => message[field] !== undefined)
		.map((field) => `${field}\n${message[field]}\n`)
		.join('');
}

/**
 * Check that SNS sent this message: the certificate is SNS's own, and the
 * signature over the message's signed fields verifies against it.
 *
 * Throws rather than returning false, so a caller cannot forget to look.
 */
export async function verifySnsMessage(
	message: SnsHttpMessage,
	options: VerifySnsMessageOptions = {},
): Promise<void> {
	const url = parseUrl(message.SigningCertURL);
	if (url?.protocol !== 'https:' || !SNS_CERTIFICATE_HOST.test(url.hostname)) {
		throw new SnsCertificateUntrusted(message.SigningCertURL);
	}

	const algorithm =
		message.SignatureVersion === '1'
			? 'RSA-SHA1'
			: message.SignatureVersion === '2'
				? 'RSA-SHA256'
				: undefined;
	if (!algorithm) {
		throw new SnsSignatureVersionUnknown(message.SignatureVersion);
	}

	const fetchCertificate = options.fetchCertificate ?? defaultFetchCertificate;
	let certificate = certificates.get(message.SigningCertURL);
	if (!certificate || options.fetchCertificate) {
		certificate = fetchCertificate(message.SigningCertURL);
		// Only SNS's real fetch is cached: a test's key belongs to that test.
		if (!options.fetchCertificate) {
			certificates.set(message.SigningCertURL, certificate);
			certificate.catch(() => certificates.delete(message.SigningCertURL));
		}
	}

	const verifier = createVerify(algorithm);
	verifier.update(snsStringToSign(message), 'utf8');
	if (!verifier.verify(await certificate, message.Signature, 'base64')) {
		throw new SnsSignatureInvalid(message.MessageId, message.TopicArn);
	}
}

/**
 * Confirm a subscription by visiting the URL SNS sent. Until this happens SNS
 * delivers nothing to the endpoint.
 */
export async function confirmSnsSubscription(
	message: SnsHttpMessage,
	request: (url: string) => Promise<{ ok: boolean; status: number }> = fetch,
): Promise<void> {
	if (message.Type !== 'SubscriptionConfirmation' || !message.SubscribeURL) {
		throw new SnsNotAConfirmation(message.Type);
	}

	const response = await request(message.SubscribeURL);
	if (!response.ok) {
		throw new SnsConfirmationFailed(message.TopicArn, response.status);
	}
}

/** Where a subscription's filter policy is matched. */
export type SnsFilterPolicyScope = 'MessageAttributes' | 'MessageBody';

/** What an HTTP subscription is created or brought up to date with. */
export interface HttpSubscriptionFilter {
	/**
	 * The event types this endpoint takes. Becomes the subscription's filter
	 * policy on the `type` attribute `SNSPublisher` sets, so SNS sends nothing
	 * else — fan-out to every subscriber, each seeing only what it named.
	 *
	 * Ignored when {@link filterPolicy} is given.
	 */
	events?: readonly string[];
	/**
	 * A filter policy of the caller's own, for messages SNS did not receive
	 * from `SNSPublisher` — a bucket's notifications carry no `type` attribute,
	 * so they are matched on their body instead.
	 */
	filterPolicy?: Record<string, unknown>;
	/** Where {@link filterPolicy} is matched. `MessageAttributes` by default. */
	filterPolicyScope?: SnsFilterPolicyScope;
	/**
	 * An SQS queue's ARN for what SNS gives up delivering. SNS retries an HTTP
	 * endpoint for a limited time and then drops the message, so without one an
	 * outage longer than that loses events.
	 */
	deadLetterQueueArn?: string;
}

export interface SubscribeHttpEndpointOptions extends HttpSubscriptionFilter {
	/** The URL SNS POSTs to — `http:` or `https:`, which picks the protocol. */
	endpoint: string;
}

/** The subscription attributes a filter asks for, as SNS spells them. */
function subscriptionAttributes(
	filter: HttpSubscriptionFilter,
): Record<string, string> {
	const attributes: Record<string, string> = filter.filterPolicy
		? {
				FilterPolicyScope: filter.filterPolicyScope ?? 'MessageAttributes',
				FilterPolicy: JSON.stringify(filter.filterPolicy),
			}
		: {
				FilterPolicyScope: 'MessageAttributes',
				FilterPolicy: JSON.stringify({ type: [...(filter.events ?? [])] }),
			};
	if (filter.deadLetterQueueArn) {
		attributes.RedrivePolicy = JSON.stringify({
			deadLetterTargetArn: filter.deadLetterQueueArn,
		});
	}
	return attributes;
}

/** The protocol SNS delivers to an endpoint with, from its URL. */
function protocolOf(endpoint: string): 'http' | 'https' {
	const protocol = parseUrl(endpoint)?.protocol.replace(':', '');
	if (protocol !== 'http' && protocol !== 'https') {
		throw new SnsEndpointNotHttp(endpoint);
	}
	return protocol;
}

/** Bring an existing subscription's attributes up to what is asked for. */
async function updateAttributes(
	connection: SNSConnection,
	subscriptionArn: string,
	current: Record<string, string>,
	wanted: Record<string, string>,
): Promise<void> {
	for (const [name, value] of Object.entries(wanted)) {
		if (current[name] === value) continue;
		await connection.snsClient.send(
			new SetSubscriptionAttributesCommand({
				SubscriptionArn: subscriptionArn,
				AttributeName: name,
				AttributeValue: value,
			}),
		);
	}
}

/**
 * Subscribe an HTTP endpoint to the connection's topic, converging on one
 * confirmed subscription with the filter asked for — so it is safe on every
 * start. What a server does against an emulator, where nothing deploys it;
 * against SNS itself the deploy owns the subscription
 * ({@link reconcileHttpSubscriptions}).
 *
 * - **none yet** — subscribed; SNS sends a confirmation to the endpoint.
 * - **confirmed** — its filter and dead-letter queue are brought up to date.
 *   Subscribing again with different attributes is an error on SNS, and the
 *   events a subscriber names change.
 * - **stuck pending** — a confirmation that never landed (the endpoint was
 *   down, or answered wrong). Subscribing the same endpoint again is a no-op
 *   on an emulator, so it is dropped and subscribed afresh, which sends a new
 *   confirmation.
 */
export async function subscribeHttpEndpoint(
	connection: SNSConnection,
	options: SubscribeHttpEndpointOptions,
): Promise<string | undefined> {
	const protocol = protocolOf(options.endpoint);
	const attributes = subscriptionAttributes(options);

	const client = connection.snsClient;
	const existing = (await topicSubscriptions(connection)).find(
		(s) => s.endpoint === options.endpoint,
	)?.arn;
	if (existing) {
		const { Attributes = {} } = await client.send(
			new GetSubscriptionAttributesCommand({ SubscriptionArn: existing }),
		);
		if (Attributes.PendingConfirmation === 'true') {
			await client.send(new UnsubscribeCommand({ SubscriptionArn: existing }));
		} else {
			await updateAttributes(connection, existing, Attributes, attributes);
			return existing;
		}
	}

	const { SubscriptionArn } = await client.send(
		new SubscribeCommand({
			TopicArn: connection.topicArn,
			Protocol: protocol,
			Endpoint: options.endpoint,
			Attributes: attributes as SubscribeCommandInput['Attributes'],
			ReturnSubscriptionArn: true,
		}),
	);
	return SubscriptionArn;
}

/** One endpoint the deploy wants subscribed, under the name it is recorded by. */
export interface HttpSubscriptionSpec extends HttpSubscriptionFilter {
	/** What the ARN is recorded under — the subscriber's export. */
	name: string;
	/** The URL SNS POSTs to. */
	endpoint: string;
}

export interface ReconcileHttpSubscriptionsOptions {
	/** Every endpoint that should be subscribed to the topic. */
	endpoints: readonly HttpSubscriptionSpec[];
	/**
	 * The host these endpoints answer on. A subscription to an endpoint on it
	 * that is not in {@link endpoints} — a subscriber renamed or removed — is
	 * unsubscribed; anything subscribed on another host is somebody else's and
	 * left alone.
	 */
	ownedHost: string;
}

export interface ReconciledHttpSubscriptions {
	/** Each endpoint's subscription ARN, by its name — stable across runs. */
	subscriptions: Record<string, string>;
	/** The names whose subscription SNS still waits to have confirmed. */
	pending: string[];
	/** The ARNs of what was unsubscribed as no longer wanted. */
	removed: string[];
}

/**
 * Converge a topic's HTTP subscriptions on the endpoints a deploy wants, and
 * answer each one's ARN for the deploy to record and hand to the server.
 *
 * The deploy's half of push delivery against SNS itself: the server never
 * subscribes, so its credentials need no `sns:Subscribe` — and the only
 * subscriptions to the topic are ones the deploy made.
 *
 * Run it twice: once before the server starts, for the ARNs it is configured
 * with — SNS answers one even while the subscription waits to be confirmed —
 * and once the server is up, which subscribes each still-pending endpoint
 * again so SNS resends its confirmation to a server now there to answer it.
 * The ARN does not change between the two.
 *
 * - **absent** — subscribed with its filter.
 * - **present** — its filter and dead-letter queue are brought up to date;
 *   pending, it is subscribed again to resend the confirmation.
 * - **stale** — on {@link ReconcileHttpSubscriptionsOptions.ownedHost} and no
 *   longer wanted: unsubscribed. (A stale one SNS still lists as pending has
 *   no ARN to act on; SNS drops it unconfirmed after three days.)
 */
export async function reconcileHttpSubscriptions(
	connection: SNSConnection,
	options: ReconcileHttpSubscriptionsOptions,
): Promise<ReconciledHttpSubscriptions> {
	const client = connection.snsClient;
	const listed = await topicSubscriptions(connection);
	const result: ReconciledHttpSubscriptions = {
		subscriptions: {},
		pending: [],
		removed: [],
	};

	for (const spec of options.endpoints) {
		const protocol = protocolOf(spec.endpoint);
		const attributes = subscriptionAttributes(spec);
		const subscribe = async () =>
			(
				await client.send(
					new SubscribeCommand({
						TopicArn: connection.topicArn,
						Protocol: protocol,
						Endpoint: spec.endpoint,
						Attributes: attributes as SubscribeCommandInput['Attributes'],
						ReturnSubscriptionArn: true,
					}),
				)
			).SubscriptionArn;

		const existing = listed.find((s) => s.endpoint === spec.endpoint)?.arn;
		let arn: string | undefined;
		let pending: boolean;
		if (existing) {
			const { Attributes = {} } = await client.send(
				new GetSubscriptionAttributesCommand({ SubscriptionArn: existing }),
			);
			await updateAttributes(connection, existing, Attributes, attributes);
			pending = Attributes.PendingConfirmation === 'true';
			// Subscribing a pending endpoint again resends its confirmation,
			// under the same ARN.
			arn = pending ? ((await subscribe()) ?? existing) : existing;
		} else {
			// Absent — or pending on SNS itself, which lists it with no ARN:
			// subscribing answers the one it has, and resends the confirmation.
			arn = await subscribe();
			pending = true;
		}
		if (!arn) {
			throw new SnsSubscriptionArnMissing(connection.topicArn, spec.endpoint);
		}

		result.subscriptions[spec.name] = arn;
		if (pending) result.pending.push(spec.name);
	}

	const wanted = new Set(options.endpoints.map((spec) => spec.endpoint));
	for (const { arn, endpoint } of listed) {
		if (!arn || wanted.has(endpoint)) continue;
		if (parseUrl(endpoint)?.host !== options.ownedHost) continue;
		await client.send(new UnsubscribeCommand({ SubscriptionArn: arn }));
		result.removed.push(arn);
	}

	return result;
}

/**
 * Confirm a subscription through the API, as its topic's owner, rather than by
 * visiting the URL SNS sent.
 *
 * `AuthenticateOnUnsubscribe` is the point of it. A subscription confirmed by
 * visiting `SubscribeURL` can be removed by anyone holding the
 * `UnsubscribeURL` every notification carries — one unauthenticated GET, and
 * the endpoint is silently cut off. Confirmed this way, only the topic's owner
 * can unsubscribe it. All it takes of the caller's credentials is
 * `sns:ConfirmSubscription` on this one topic.
 */
export async function confirmSubscription(
	connection: SNSConnection,
	message: SnsHttpMessage,
): Promise<string | undefined> {
	if (message.Type !== 'SubscriptionConfirmation' || !message.Token) {
		throw new SnsNotAConfirmation(message.Type);
	}

	const { SubscriptionArn } = await connection.snsClient.send(
		new ConfirmSubscriptionCommand({
			TopicArn: message.TopicArn,
			Token: message.Token,
			AuthenticateOnUnsubscribe: 'true',
		}),
	);
	return SubscriptionArn;
}

/**
 * Every subscription on the connection's topic, with the ARN SNS names for it
 * — none for one real SNS lists as `PendingConfirmation`, which there is no
 * ARN to act on (and which a new Subscribe resends the confirmation of anyway).
 */
async function topicSubscriptions(
	connection: SNSConnection,
): Promise<{ arn?: string; endpoint: string }[]> {
	const found: { arn?: string; endpoint: string }[] = [];
	let NextToken: string | undefined;
	do {
		const page = await connection.snsClient.send(
			new ListSubscriptionsByTopicCommand({
				TopicArn: connection.topicArn,
				NextToken,
			}),
		);
		for (const s of page.Subscriptions ?? []) {
			if (!s.Endpoint) continue;
			found.push({
				endpoint: s.Endpoint,
				...(s.SubscriptionArn?.startsWith('arn:')
					? { arn: s.SubscriptionArn }
					: {}),
			});
		}
		NextToken = page.NextToken;
	} while (NextToken);
	return found;
}

/**
 * A pushed notification as the Lambda event SNS would have invoked a function
 * with, so it can be handed to the same adaptor.
 */
export function toSnsEvent(message: SnsHttpMessage, subscriptionArn = '') {
	return {
		Records: [
			{
				EventSource: 'aws:sns',
				EventVersion: '1.0',
				EventSubscriptionArn: subscriptionArn,
				Sns: {
					Type: message.Type,
					MessageId: message.MessageId,
					TopicArn: message.TopicArn,
					Subject: message.Subject ?? null,
					Message: message.Message,
					Timestamp: message.Timestamp,
					SignatureVersion: message.SignatureVersion,
					Signature: message.Signature,
					// Lambda spells these two differently from the HTTP envelope.
					SigningCertUrl: message.SigningCertURL,
					UnsubscribeUrl: message.UnsubscribeURL ?? '',
					MessageAttributes: message.MessageAttributes ?? {},
				},
			},
		],
	};
}

export class SnsCertificateUntrusted extends Error {
	constructor(readonly url: string) {
		super(
			`The SNS message names a signing certificate at '${url}', which is not ` +
				'an https URL on sns.<region>.amazonaws.com. Only SNS can send to ' +
				'this endpoint; reject the request.',
		);
		this.name = 'SnsCertificateUntrusted';
	}
}

export class SnsCertificateUnavailable extends Error {
	constructor(
		readonly url: string,
		readonly status: number,
	) {
		super(
			`Fetching the SNS signing certificate at '${url}' answered ${status}. ` +
				'The message cannot be verified, so it is not handled; SNS will retry.',
		);
		this.name = 'SnsCertificateUnavailable';
	}
}

export class SnsSignatureVersionUnknown extends Error {
	constructor(readonly version: string) {
		super(
			`SNS signature version '${version}' is not one this endpoint verifies ` +
				"(it knows '1' and '2'). Reject the request.",
		);
		this.name = 'SnsSignatureVersionUnknown';
	}
}

export class SnsSignatureInvalid extends Error {
	constructor(
		readonly messageId: string,
		readonly topicArn: string,
	) {
		super(
			`SNS message '${messageId}' from '${topicArn}' does not verify against ` +
				'its signing certificate. It was not sent by SNS, or was altered ' +
				'on the way; reject it.',
		);
		this.name = 'SnsSignatureInvalid';
	}
}

export class SnsMessageTypeUnknown extends Error {
	constructor(readonly type: string) {
		super(
			`'${type}' is not an SNS message type (Notification, ` +
				'SubscriptionConfirmation, UnsubscribeConfirmation). Reject it.',
		);
		this.name = 'SnsMessageTypeUnknown';
	}
}

export class SnsNotAConfirmation extends Error {
	constructor(readonly type: string) {
		super(
			`Only a SubscriptionConfirmation carries a URL to confirm; this is a ` +
				`'${type}'.`,
		);
		this.name = 'SnsNotAConfirmation';
	}
}

export class SnsConfirmationFailed extends Error {
	constructor(
		readonly topicArn: string,
		readonly status: number,
	) {
		super(
			`Confirming the subscription to '${topicArn}' answered ${status}. ` +
				'SNS will deliver nothing until it is confirmed; it resends the ' +
				'confirmation, or subscribe the endpoint again.',
		);
		this.name = 'SnsConfirmationFailed';
	}
}

export class SnsEndpointNotHttp extends Error {
	constructor(readonly endpoint: string) {
		super(
			`'${endpoint}' is not an http(s) URL. SNS pushes to an HTTP endpoint; ` +
				'subscribe a queue for anything else.',
		);
		this.name = 'SnsEndpointNotHttp';
	}
}

export class SnsSubscriptionArnMissing extends Error {
	constructor(
		readonly topicArn: string,
		readonly endpoint: string,
	) {
		super(
			`Subscribing '${endpoint}' to '${topicArn}' answered no subscription ` +
				'ARN, so there is nothing to record for the server to accept. ' +
				'Check the topic exists and the deploy may subscribe to it.',
		);
		this.name = 'SnsSubscriptionArnMissing';
	}
}
