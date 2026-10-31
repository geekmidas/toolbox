/**
 * `mailbox.receive` — mail arriving at an app's inbox in a feature test.
 *
 * The message goes where `gkm dev`'s does: built into a real MIME message
 * (or taken as the `.eml` given), delivered over SMTP to Mailpit with the
 * envelope the test names, and handed to `receiveMail` — the receiver
 * Mailpit's webhook calls under `gkm dev`, and the one SES stands for
 * deployed. The handler then reads it back from Mailpit through the parser it
 * uses in production. Only the trigger is the test's own.
 */

import type { ComposedAttachment } from '@geekmidas/emailkit/inbound';
import type { Declaration } from '@geekmidas/manifest';
import {
	type InboxAddressing,
	inboxRecipient,
	provideKey,
} from '@geekmidas/manifest';
import type { ReceiptNotification, Verdicts } from '../inbox';
import type { Topic } from '../topic/Topic';

/** What a test hands `mailbox.receive`. */
export type MailToReceive =
	| ({
			/** The envelope recipient — what routes it. Required. */
			to: string;
			/** The envelope sender, and `From:`. Required without `raw`. */
			from: string;
			raw?: undefined;
			/** `To:` as written, when it should differ from the envelope. */
			headerTo?: string | readonly string[];
			cc?: string | readonly string[];
			replyTo?: string;
			subject?: string;
			text?: string;
			html?: string;
			attachments?: readonly ComposedAttachment[];
			headers?: Readonly<Record<string, string>>;
	  } & Judged)
	| ({
			/** The envelope recipient — what routes it. Required. */
			to: string;
			/** A whole message, as an `.eml` holds it. */
			raw: string | Uint8Array;
			/** The envelope sender; `From:` in the message otherwise. */
			from?: string;
	  } & Judged);

interface Judged {
	/** What the provider judged — `'unavailable'` for any left out. */
	verdicts?: Partial<Verdicts>;
}

/** `mailbox.receive` named no recipient. */
export class ReceiveNeedsRecipient extends Error {
	constructor() {
		super(
			`mailbox.receive needs \`to\`: the envelope recipient routes the ` +
				`message to an inbox, and nothing else does.`,
		);
		this.name = 'ReceiveNeedsRecipient';
	}
}

/** `mailbox.receive` was given fields and a raw message, or neither a sender nor raw. */
export class ReceiveFieldsOrRaw extends Error {
	constructor(readonly reason: 'both' | 'no-sender') {
		super(
			reason === 'both'
				? `mailbox.receive takes either a raw message or the fields to build ` +
						`one (subject, text, html, attachments, headers…), not both: ` +
						`the raw message already says them.`
				: `mailbox.receive needs \`from\` when it builds the message — or a ` +
						`\`raw\` message, whose From: it uses.`,
		);
		this.name = 'ReceiveFieldsOrRaw';
	}
}

/** No declared inbox receives at the address `mailbox.receive` was given. */
export class NoInboxForAddress extends Error {
	constructor(
		readonly address: string,
		readonly inboxes: readonly string[],
	) {
		super(
			inboxes.length === 0
				? `No inbox is declared, so nothing receives at '${address}'.`
				: `No inbox receives at '${address}'. ${inboxes
						.map((i) => `'${i}'`)
						.join(', ')} ` +
						`take only their declared addresses on this stage's domain — ` +
						`as the deployed receipt rule does.`,
		);
		this.name = 'NoInboxForAddress';
	}
}

/** An inbox the test can receive for: no Mailpit to deliver to. */
export class InboxNotLocal extends Error {
	constructor(readonly inbox: string) {
		super(
			`'${inbox}' has no ${provideKey(inbox, 'smtpUrl')} in this test's ` +
				`environment, so there is no Mailpit to deliver to. Run it under ` +
				`\`gkm test\`, which resolves it.`,
		);
		this.name = 'InboxNotLocal';
	}
}

/** An inbox, as a feature test finds it among the app's constructs. */
export interface TestInbox {
	id: string;
	addressing: InboxAddressing;
	topic: Topic<any, any>;
}

/** Whether `value` is an inbox construct — by what it declares, so nothing imports one. */
export function isInboxConstruct(value: unknown): value is TestInbox {
	const candidate = value as {
		id?: unknown;
		declare?: () => Declaration[];
		addressing?: unknown;
		topic?: unknown;
	};
	return (
		typeof candidate?.declare === 'function' &&
		typeof candidate.id === 'string' &&
		candidate.addressing !== undefined &&
		candidate.topic !== undefined &&
		candidate.declare().some((d) => d.kind === 'inbox' && d.id === candidate.id)
	);
}

/**
 * Deliver `mail` to Mailpit and receive it: each inbox its envelope
 * recipient is addressed to gets the receipt notification, through
 * `publish`.
 */
export async function receiveInTest(
	mail: MailToReceive,
	inboxes: readonly TestInbox[],
	env: Readonly<Record<string, string | undefined>>,
	publish: (
		inbox: TestInbox,
		notification: ReceiptNotification,
	) => Promise<void>,
): Promise<string[]> {
	if (!mail.to) throw new ReceiveNeedsRecipient();
	const fields = mail as Exclude<MailToReceive, { raw: string | Uint8Array }>;
	const built =
		fields.subject !== undefined ||
		fields.text !== undefined ||
		fields.html !== undefined ||
		fields.attachments !== undefined ||
		fields.headers !== undefined ||
		fields.headerTo !== undefined ||
		fields.cc !== undefined ||
		fields.replyTo !== undefined;
	if (mail.raw !== undefined && built) throw new ReceiveFieldsOrRaw('both');

	const addressed = inboxes.filter((inbox) => {
		const domain = env[provideKey(inbox.id, 'domain')];
		return domain && inboxRecipient(mail.to, inbox.addressing, domain);
	});
	if (addressed.length === 0) {
		throw new NoInboxForAddress(
			mail.to,
			inboxes.map((inbox) => inbox.id),
		);
	}

	const { composeEmail, deliverRaw, parseEmail } = await import(
		'@geekmidas/emailkit/inbound'
	);
	const { receiveMail } = await import('../inbox');

	let raw: string | Uint8Array;
	let from: string;
	if (mail.raw !== undefined) {
		raw = mail.raw;
		const sender = mail.from ?? (await parseEmail(raw)).from?.address;
		if (!sender) throw new ReceiveFieldsOrRaw('no-sender');
		from = sender;
	} else {
		if (!fields.from) throw new ReceiveFieldsOrRaw('no-sender');
		from = fields.from;
		raw = await composeEmail({
			from: fields.from,
			to: fields.headerTo ?? mail.to,
			...(fields.cc !== undefined ? { cc: fields.cc } : {}),
			...(fields.replyTo ? { replyTo: fields.replyTo } : {}),
			...(fields.subject !== undefined ? { subject: fields.subject } : {}),
			...(fields.text !== undefined ? { text: fields.text } : {}),
			...(fields.html !== undefined ? { html: fields.html } : {}),
			...(fields.attachments ? { attachments: fields.attachments } : {}),
			...(fields.headers ? { headers: fields.headers } : {}),
		});
	}

	const smtp = env[provideKey(addressed[0]!.id, 'smtpUrl')];
	if (!smtp) throw new InboxNotLocal(addressed[0]!.id);
	const key = await deliverRaw(smtp, { from, to: [mail.to] }, raw);

	return receiveMail(
		{
			key,
			store: 'mailpit',
			from,
			recipients: [mail.to],
			...(mail.verdicts ? { verdicts: mail.verdicts } : {}),
		},
		addressed.map((inbox) => ({
			id: inbox.id,
			addressing: inbox.addressing,
			domain: env[provideKey(inbox.id, 'domain')]!,
			publish: (notification) => publish(inbox, notification),
		})),
	);
}
