/**
 * `Inbox` — mail received at addresses on the stage's domain, each message
 * handled in a worker.
 *
 * ```ts
 * export const requests = new Inbox('Requests', {
 *   addresses: ['requests'], // local parts: structural
 *   subdomains: true,        // requests@<tenant>.<stage domain>
 * });
 *
 * export const onRequest = worker
 *   .inbox(requests)
 *   .handle(async ({ messages }) => {
 *     for (const message of messages) {
 *       message.recipient.subdomain; // the tenant, from the envelope
 *       message.recipient.tag;       // requests+<tag>@
 *     }
 *   });
 * ```
 *
 * **Its own bucket, and a topic.** An inbox owns the bucket its raw messages
 * are kept in — each target creates it for the inbox, never one the stack
 * already runs — and provides its URL itself, so the bucket is no `objects`
 * node and no object subscriber can be bound to it. It declares the topic
 * each message is announced on, which only the provider publishes to.
 *
 * **One decoder.** Deployed, SES's receipt rule stores the raw message and
 * publishes its receipt notification on the topic. Locally `gkm dev` brings a
 * message in from Mailpit and publishes the same notification; in a feature
 * test `mailbox.receive` does. The handler is handed what {@link InboxClient}
 * makes of that notification, wherever it came from.
 *
 * **The envelope routes.** Which inbox, which tenant and which tag come from
 * the envelope recipient, never from `From:` or `To:`, which the sender wrote.
 */

import { type ParsedEmail, parseEmail } from '@geekmidas/emailkit/inbound';
import {
	type ConstructName,
	canonicalId,
	type Declaration,
	INBOX_EVENT,
	type InboxAddressing,
	type InboxRecipient,
	inboxRecipient,
	providedKeyFor,
	serviceKey,
} from '@geekmidas/manifest';
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import { createStorageClient } from '@geekmidas/storage';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Construct } from './construct-interface';
import { Topic } from './topic/Topic';

export interface InboxOptions {
	/**
	 * The local parts it receives at: `['requests']`. Each also takes a
	 * `+tag` — `requests+t_8f3k@` — handed to the handler as `recipient.tag`.
	 */
	addresses: readonly string[];
	/**
	 * Receive at `<address>@<label>.<domain>` — one label, a tenant's — rather
	 * than at the stage's domain itself.
	 */
	subdomains?: boolean;
}

/** An inbox declared with no address receives nothing. */
export class InboxHasNoAddresses extends Error {
	constructor(readonly inbox: string) {
		super(
			`The inbox '${inbox}' names no address, so it would receive nothing. ` +
				`Name the local parts it receives at: addresses: ['requests'].`,
		);
		this.name = 'InboxHasNoAddresses';
	}
}

/** An address that is not a bare local part: `requests@x`, `a+b`, `''`. */
export class InboxAddressInvalid extends Error {
	constructor(
		readonly inbox: string,
		readonly address: string,
	) {
		super(
			`The inbox '${inbox}' names '${address}', which is not a local part. ` +
				`Name only what goes before the @ — the domain is the stage's — ` +
				`and no '+': every address takes a +tag already.`,
		);
		this.name = 'InboxAddressInvalid';
	}
}

/**
 * A receipt notification the inbox cannot read: not SES's shape, or an action
 * other than the S3 one that stores the message where the decoder reads it.
 */
export class ReceiptNotificationMalformed extends Error {
	constructor(
		readonly inbox: string,
		readonly reason: string,
	) {
		super(
			`The inbox '${inbox}' was handed a notification it cannot read: ${reason}. ` +
				`It reads SES receipt notifications whose action stored the message in S3.`,
		);
		this.name = 'ReceiptNotificationMalformed';
	}
}

/**
 * A provider's verdict on a message.
 *
 * `'unavailable'` where nothing judged it — locally, always — and never a
 * faked `'pass'`.
 */
export type Verdict = 'pass' | 'fail' | 'gray' | 'unavailable';

/** What the provider judged of a message, which the message cannot say of itself. */
export interface Verdicts {
	spf: Verdict;
	dkim: Verdict;
	dmarc: Verdict;
	spam: Verdict;
	virus: Verdict;
}

/**
 * One received message, for one recipient it was delivered to.
 *
 * `recipient` is the envelope's; every other address is a header, written by
 * the sender. Inbound mail is untrusted input: route on `recipient`, treat
 * `from` as a claim until `verdicts.dmarc` passes *and* the address is known,
 * sanitise `html`, and never use an attachment's filename as a key or path.
 */
export interface InboxMessage
	extends Omit<ParsedEmail, 'attachments'>,
		Pick<ParsedEmail, 'attachments'> {
	recipient: InboxRecipient;
	/**
	 * Where the raw message is kept: the bucket SES stored it in (`mailpit`
	 * locally), and its key there.
	 */
	raw: { bucket: string; key: string };
	verdicts: Verdicts;
}

/** A status as SES writes one: `PASS`, `FAIL`, `GRAY`, `PROCESSING_FAILED`, `DISABLED`. */
interface ReceiptVerdict {
	status: string;
}

/**
 * SES's receipt notification — the part an inbox reads.
 *
 * `gkm dev` and the test mailbox publish the same shape, with every verdict
 * `UNAVAILABLE`, so one decoder serves all three.
 */
export interface ReceiptNotification {
	notificationType: 'Received';
	mail: {
		messageId: string;
		timestamp: string;
		/** The envelope sender (`MAIL FROM`). */
		source: string;
		destination: string[];
	};
	receipt: {
		timestamp: string;
		/** The envelope recipients this receipt rule matched. */
		recipients: string[];
		spamVerdict?: ReceiptVerdict;
		virusVerdict?: ReceiptVerdict;
		spfVerdict?: ReceiptVerdict;
		dkimVerdict?: ReceiptVerdict;
		dmarcVerdict?: ReceiptVerdict;
		action: {
			type: string;
			bucketName?: string;
			objectKey?: string;
			topicArn?: string;
		};
	};
}

/** What the handler's inbox is: its domain, its raw messages, the decoder. */
export interface InboxClient {
	/** The stage's domain it receives on. */
	readonly domain: string;
	/** A raw message's bytes, by its key in the bucket. */
	raw(key: string): Promise<Uint8Array>;
	/**
	 * The messages a notification announces: one per envelope recipient this
	 * inbox receives at, parsed. Empty when none is — a receipt rule that takes
	 * a whole domain stores mail for addresses no inbox declared.
	 */
	messages(notification: ReceiptNotification): Promise<InboxMessage[]>;
}

/** A schema that takes a receipt notification as it is — SES wrote it, not the app. */
const RECEIPT_NOTIFICATION: StandardSchemaV1<ReceiptNotification> = {
	'~standard': {
		version: 1,
		vendor: 'geekmidas',
		validate: (value) => ({ value: value as ReceiptNotification }),
	},
};

type InboxTopic = Topic<string, { [INBOX_EVENT]: typeof RECEIPT_NOTIFICATION }>;

export class Inbox<TName extends string = string>
	implements Construct<TName, InboxClient>
{
	readonly id: TName;
	readonly service: Service<Uncapitalize<TName>, InboxClient>;
	/** Where each received message is announced. Published to by the provider only. */
	readonly topic: InboxTopic;

	/** The local parts it receives at, and whether on a tenant's subdomain. */
	readonly addressing: InboxAddressing;
	private readonly addresses: readonly string[];
	private readonly subdomains: boolean;
	private readonly keys: { url: string; domain: string };

	constructor(name: ConstructName<TName>, options: InboxOptions) {
		const canonical = canonicalId(name as string);
		if (options.addresses.length === 0) {
			throw new InboxHasNoAddresses(canonical);
		}
		for (const address of options.addresses) {
			if (!/^[a-z0-9][a-z0-9._-]*$/i.test(address)) {
				throw new InboxAddressInvalid(canonical, address);
			}
		}

		this.id = canonical as TName;
		this.addresses = options.addresses.map((a) => a.toLowerCase());
		this.subdomains = options.subdomains === true;
		this.addressing = {
			addresses: this.addresses,
			...(this.subdomains ? { subdomains: true } : {}),
		};
		this.keys = {
			url: providedKeyFor(canonical, 'inbox', 'url'),
			domain: providedKeyFor(canonical, 'inbox', 'domain'),
		};
		this.topic = new Topic(`${canonical}Mail`, {
			events: { [INBOX_EVENT]: RECEIPT_NOTIFICATION },
		}) as InboxTopic;

		this.service = {
			serviceName: serviceKey(canonical) as Uncapitalize<TName>,
			register: (register) => this.connect(register),
		};
	}

	declare(): Declaration[] {
		return [
			...this.topic.declare(),
			{
				kind: 'inbox',
				id: this.id,
				provides: [this.keys.url, this.keys.domain],
				addresses: this.addresses,
				...(this.subdomains ? { subdomains: true } : {}),
				topic: this.topic.id,
			},
		];
	}

	private async connect(
		register: ServiceRegisterOptions,
	): Promise<InboxClient> {
		const { url, domain } = register.envParser
			.create((get) => ({
				url: get(this.keys.url).string(),
				domain: get(this.keys.domain).string(),
			}))
			.parse();
		const read = rawReader(url);
		const addressing = {
			addresses: this.addresses,
			subdomains: this.subdomains,
		};
		const inbox = this.id;

		const raw = async (key: string): Promise<Uint8Array> => {
			const response = await fetch(await read(key));
			if (!response.ok) {
				throw new RawMessageUnreadable(inbox, key, response.status);
			}
			return new Uint8Array(await response.arrayBuffer());
		};

		return {
			domain,
			raw,
			async messages(notification) {
				const { receipt } = assertReceipt(inbox, notification);
				const recipients = receipt.recipients.flatMap((address) => {
					const recipient = inboxRecipient(address, addressing, domain);
					return recipient ? [recipient] : [];
				});
				if (recipients.length === 0) return [];

				const key = receipt.action.objectKey!;
				const parsed = await parseEmail(await raw(key));
				const verdicts = verdictsOf(receipt);
				return recipients.map((recipient) => ({
					...parsed,
					recipient,
					raw: { bucket: receipt.action.bucketName!, key },
					verdicts,
				}));
			},
		};
	}
}

/**
 * Where a raw message is read from, by its key, for the store `url` names:
 * an `s3://` bucket deployed — SES stored it at `messages/<id>` — or, locally,
 * Mailpit's API, which keeps every message it receives under its own id.
 *
 * The one place local and deployed differ; everything that reads a message
 * goes through it.
 */
function rawReader(url: string): (key: string) => Promise<string> {
	if (url.startsWith('s3:')) {
		const bucket = createStorageClient(url);
		return async (key) => (await bucket).getDownloadURL({ path: key });
	}
	const base = url.replace(/\/+$/, '');
	return async (key) => `${base}/api/v1/message/${encodeURIComponent(key)}/raw`;
}

/** The raw message a notification names could not be read from its store. */
export class RawMessageUnreadable extends Error {
	constructor(
		readonly inbox: string,
		readonly key: string,
		readonly status: number,
	) {
		super(
			`The inbox '${inbox}' could not read its raw message '${key}' (HTTP ${status}). ` +
				`It is written by the receipt rule before the notification is sent; ` +
				`check the bucket's policy lets the process that runs the handler read it.`,
		);
		this.name = 'RawMessageUnreadable';
	}
}

function assertReceipt(inbox: string, value: unknown): ReceiptNotification {
	const notification = value as Partial<ReceiptNotification> | undefined;
	if (notification?.notificationType !== 'Received') {
		throw new ReceiptNotificationMalformed(
			inbox,
			`its notificationType is '${String(notification?.notificationType)}', not 'Received'`,
		);
	}
	const action = notification.receipt?.action;
	if (action?.type !== 'S3' || !action.objectKey || !action.bucketName) {
		throw new ReceiptNotificationMalformed(
			inbox,
			`its action is '${String(action?.type)}' without an S3 object`,
		);
	}
	if (!Array.isArray(notification.receipt?.recipients)) {
		throw new ReceiptNotificationMalformed(inbox, 'it names no recipients');
	}
	return notification as ReceiptNotification;
}

function verdict(status: ReceiptVerdict | undefined): Verdict {
	switch (status?.status) {
		case 'PASS':
			return 'pass';
		case 'FAIL':
			return 'fail';
		case 'GRAY':
			return 'gray';
		default:
			return 'unavailable';
	}
}

function verdictsOf(receipt: ReceiptNotification['receipt']): Verdicts {
	return {
		spf: verdict(receipt.spfVerdict),
		dkim: verdict(receipt.dkimVerdict),
		dmarc: verdict(receipt.dmarcVerdict),
		spam: verdict(receipt.spamVerdict),
		virus: verdict(receipt.virusVerdict),
	};
}

/**
 * The receipt notification a provider that judges nothing publishes —
 * `gkm dev` and the test mailbox — for a message stored at `objectKey`.
 */
export function unjudgedReceipt(options: {
	messageId: string;
	source: string;
	recipients: readonly string[];
	bucketName: string;
	objectKey: string;
	verdicts?: Partial<Verdicts>;
	timestamp?: Date;
}): ReceiptNotification {
	const at = (options.timestamp ?? new Date()).toISOString();
	const status = (v: Verdict | undefined): ReceiptVerdict => ({
		status: v ? v.toUpperCase() : 'UNAVAILABLE',
	});
	return {
		notificationType: 'Received',
		mail: {
			messageId: options.messageId,
			timestamp: at,
			source: options.source,
			destination: [...options.recipients],
		},
		receipt: {
			timestamp: at,
			recipients: [...options.recipients],
			spfVerdict: status(options.verdicts?.spf),
			dkimVerdict: status(options.verdicts?.dkim),
			dmarcVerdict: status(options.verdicts?.dmarc),
			spamVerdict: status(options.verdicts?.spam),
			virusVerdict: status(options.verdicts?.virus),
			action: {
				type: 'S3',
				bucketName: options.bucketName,
				objectKey: options.objectKey,
			},
		},
	};
}

/** An inbox, as the receiver routes to it. */
export interface ReceivingInbox {
	id: string;
	addressing: InboxAddressing;
	/** The stage's domain it receives on. */
	domain: string;
	/** Announce a received message on the inbox's topic. */
	publish(notification: ReceiptNotification): Promise<void>;
}

/** A message that arrived where a provider that judges nothing stores mail. */
export interface ArrivedMessage {
	/** Its key in that store — Mailpit's message id locally. */
	key: string;
	/** Where the store is, as a notification names it: `mailpit`. */
	store: string;
	/** The envelope sender. */
	from: string;
	/** The envelope recipients — never `To:`. */
	recipients: readonly string[];
	/** What a test says the provider judged; `'unavailable'` otherwise. */
	verdicts?: Partial<Verdicts>;
}

/**
 * Receive a message the way a receipt rule does: for each inbox one of its
 * envelope recipients is addressed to, publish the receipt notification for
 * those recipients on the inbox's topic. What no inbox receives at goes
 * nowhere — mail the app sent to anyone else included.
 *
 * The one receiver for every local path: Mailpit's webhook under `gkm dev`
 * and a local compose stack, and `mailbox.receive` in a feature test. SES is
 * the receiver deployed. Returns the ids of the inboxes it announced to.
 */
export async function receiveMail(
	message: ArrivedMessage,
	inboxes: readonly ReceivingInbox[],
): Promise<string[]> {
	const received: string[] = [];
	for (const inbox of inboxes) {
		const recipients = message.recipients.filter((address) =>
			inboxRecipient(address, inbox.addressing, inbox.domain),
		);
		if (recipients.length === 0) continue;
		await inbox.publish(
			unjudgedReceipt({
				messageId: message.key,
				source: message.from,
				recipients,
				bucketName: message.store,
				objectKey: message.key,
				...(message.verdicts ? { verdicts: message.verdicts } : {}),
			}),
		);
		received.push(inbox.id);
	}
	return received;
}

/** Whether `value` is an {@link Inbox}. */
export function isInbox(value: unknown): value is Inbox {
	return value instanceof Inbox;
}
