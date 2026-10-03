import { createVerify } from 'node:crypto';
import {
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

export interface SubscribeHttpEndpointOptions {
	/** The URL SNS POSTs to — `http:` or `https:`, which picks the protocol. */
	endpoint: string;
	/**
	 * The event types this endpoint takes. Becomes the subscription's filter
	 * policy on the `type` attribute `SNSPublisher` sets, so SNS sends nothing
	 * else — fan-out to every subscriber, each seeing only what it named.
	 */
	events: readonly string[];
	/**
	 * An SQS queue's ARN for what SNS gives up delivering. SNS retries an HTTP
	 * endpoint for a limited time and then drops the message, so without one an
	 * outage longer than that loses events.
	 */
	deadLetterQueueArn?: string;
}

/**
 * Subscribe an HTTP endpoint to the connection's topic, converging on one
 * confirmed subscription with the filter asked for — so it is safe on every
 * start:
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
	const protocol = new URL(options.endpoint).protocol.replace(':', '');
	if (protocol !== 'http' && protocol !== 'https') {
		throw new SnsEndpointNotHttp(options.endpoint);
	}

	const attributes: Record<string, string> = {
		FilterPolicyScope: 'MessageAttributes',
		FilterPolicy: JSON.stringify({ type: [...options.events] }),
	};
	if (options.deadLetterQueueArn) {
		attributes.RedrivePolicy = JSON.stringify({
			deadLetterTargetArn: options.deadLetterQueueArn,
		});
	}

	const client = connection.snsClient;
	const existing = await existingSubscription(connection, options.endpoint);
	if (existing) {
		const { Attributes = {} } = await client.send(
			new GetSubscriptionAttributesCommand({ SubscriptionArn: existing }),
		);
		if (Attributes.PendingConfirmation === 'true') {
			await client.send(new UnsubscribeCommand({ SubscriptionArn: existing }));
		} else {
			for (const [name, value] of Object.entries(attributes)) {
				if (Attributes[name] === value) continue;
				await client.send(
					new SetSubscriptionAttributesCommand({
						SubscriptionArn: existing,
						AttributeName: name,
						AttributeValue: value,
					}),
				);
			}
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

/**
 * The ARN of the endpoint's subscription to the topic, if it has one SNS will
 * name. (Real SNS lists a pending one as `PendingConfirmation`, with no ARN to
 * act on — and resends its confirmation on a new Subscribe anyway.)
 */
async function existingSubscription(
	connection: SNSConnection,
	endpoint: string,
): Promise<string | undefined> {
	let NextToken: string | undefined;
	do {
		const page = await connection.snsClient.send(
			new ListSubscriptionsByTopicCommand({
				TopicArn: connection.topicArn,
				NextToken,
			}),
		);
		const match = page.Subscriptions?.find(
			(s) => s.Endpoint === endpoint && s.SubscriptionArn?.startsWith('arn:'),
		);
		if (match) return match.SubscriptionArn;
		NextToken = page.NextToken;
	} while (NextToken);
	return undefined;
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
