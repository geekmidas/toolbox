/**
 * Received mail: the one MIME parser everything that reads a message uses, and
 * the composer that builds one.
 *
 * An `Inbox`'s handler, the test mailbox's `receive` and the mailbox that
 * reads what an app sent all go through {@link parseEmail}, so an attachment
 * that survives one survives all of them. {@link composeEmail} builds a real
 * MIME message from fields — what a test hands an inbox when it does not
 * bring a `.eml` of its own.
 */

import { createTransport } from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import PostalMime, {
	type Address,
	type Attachment as PostalAttachment,
} from 'postal-mime';

/** A mailbox in a header: `"Ada" <ada@example.com>`. */
export interface EmailAddress {
	/** The display name, where the header gave one. */
	name?: string;
	address: string;
}

/** A file in a message. */
export interface ReceivedAttachment {
	/**
	 * As the sender named it — never a key or a path: it is theirs to choose,
	 * `../../etc/passwd` included.
	 */
	filename?: string;
	contentType: string;
	/** Bytes. */
	size: number;
	/** `attachment`, or `inline` for one the HTML refers to by `contentId`. */
	disposition?: string;
	contentId?: string;
	/** Its bytes. */
	content(): Promise<Uint8Array>;
}

/** A message, parsed: its headers as the sender wrote them, its body, its files. */
export interface ParsedEmail {
	from?: EmailAddress;
	to: EmailAddress[];
	cc: EmailAddress[];
	replyTo: EmailAddress[];
	subject?: string;
	/** `Date:`, as written. */
	date?: string;
	messageId?: string;
	inReplyTo?: string;
	/** `References:`, one message id each. */
	references: string[];
	/** Every header, by lowercase name, each occurrence in order. */
	headers: Readonly<Record<string, readonly string[]>>;
	text?: string;
	html?: string;
	attachments: ReceivedAttachment[];
}

/** Parse a raw RFC 5322 message. */
export async function parseEmail(
	raw: string | Uint8Array | ArrayBuffer,
): Promise<ParsedEmail> {
	const parsed = await PostalMime.parse(raw, {
		attachmentEncoding: 'arraybuffer',
	});

	const headers: Record<string, string[]> = {};
	for (const { key, value } of parsed.headers) {
		const name = key.toLowerCase();
		headers[name] = [...(headers[name] ?? []), value];
	}

	const from = parsed.from ? addresses([parsed.from])[0] : undefined;
	return {
		...(from ? { from } : {}),
		to: addresses(parsed.to),
		cc: addresses(parsed.cc),
		replyTo: addresses(parsed.replyTo),
		...(parsed.subject !== undefined ? { subject: parsed.subject } : {}),
		...(parsed.date !== undefined ? { date: parsed.date } : {}),
		...(parsed.messageId ? { messageId: parsed.messageId } : {}),
		...(parsed.inReplyTo ? { inReplyTo: parsed.inReplyTo } : {}),
		references: (parsed.references ?? '').split(/\s+/).filter(Boolean),
		headers,
		...(parsed.text !== undefined ? { text: parsed.text } : {}),
		...(parsed.html !== undefined ? { html: parsed.html } : {}),
		attachments: parsed.attachments.map(attachment),
	};
}

/** Groups flattened into their members: a header's mailboxes, in order. */
function addresses(list: readonly Address[] | undefined): EmailAddress[] {
	const flat: EmailAddress[] = [];
	for (const entry of list ?? []) {
		const members = entry.group ?? [entry];
		for (const { name, address } of members) {
			if (!address) continue;
			flat.push({ ...(name ? { name } : {}), address });
		}
	}
	return flat;
}

function attachment(file: PostalAttachment): ReceivedAttachment {
	const bytes =
		typeof file.content === 'string'
			? new TextEncoder().encode(file.content)
			: file.content instanceof Uint8Array
				? file.content
				: new Uint8Array(file.content);
	return {
		...(file.filename ? { filename: file.filename } : {}),
		contentType: file.mimeType,
		size: bytes.byteLength,
		...(file.disposition ? { disposition: file.disposition } : {}),
		...(file.contentId ? { contentId: file.contentId } : {}),
		// A copy each time: a handler that mutates what it was given must not
		// change what the next read sees.
		content: async () => bytes.slice(),
	};
}

/** A file to put in a composed message. */
export interface ComposedAttachment {
	filename: string;
	content: string | Uint8Array;
	contentType?: string;
}

/** The fields {@link composeEmail} builds a message from. */
export interface ComposeEmailOptions {
	from: string;
	/** `To:` as written — not where the message is delivered, which is the envelope's. */
	to?: string | readonly string[];
	cc?: string | readonly string[];
	replyTo?: string;
	subject?: string;
	text?: string;
	html?: string;
	attachments?: readonly ComposedAttachment[];
	/** Any other header, as written: `Auto-Submitted`, `In-Reply-To`, `References`. */
	headers?: Readonly<Record<string, string>>;
	messageId?: string;
	date?: Date;
}

/** A real MIME message from fields, as `parseEmail` reads one. */
export async function composeEmail(
	options: ComposeEmailOptions,
): Promise<Uint8Array> {
	const list = (value: string | readonly string[] | undefined) =>
		value === undefined
			? undefined
			: typeof value === 'string'
				? value
				: [...value];
	const composer = new MailComposer({
		from: options.from,
		...(options.to !== undefined ? { to: list(options.to) } : {}),
		...(options.cc !== undefined ? { cc: list(options.cc) } : {}),
		...(options.replyTo ? { replyTo: options.replyTo } : {}),
		...(options.subject !== undefined ? { subject: options.subject } : {}),
		...(options.text !== undefined ? { text: options.text } : {}),
		...(options.html !== undefined ? { html: options.html } : {}),
		...(options.messageId ? { messageId: options.messageId } : {}),
		...(options.date ? { date: options.date } : {}),
		...(options.headers ? { headers: { ...options.headers } } : {}),
		attachments: (options.attachments ?? []).map((file) => ({
			filename: file.filename,
			content:
				typeof file.content === 'string'
					? file.content
					: Buffer.from(file.content),
			...(file.contentType ? { contentType: file.contentType } : {}),
		})),
	});
	const built = await composer.compile().build();
	return new Uint8Array(built);
}

/** The receiving server's reply named no id for the message it accepted. */
export class DeliveryNotQueued extends Error {
	constructor(readonly response: string) {
		super(
			`The mail server accepted the message but named no id for it ` +
				`('queued as …'), so it cannot be read back. Mailpit names one; ` +
				`deliver to Mailpit.`,
		);
		this.name = 'DeliveryNotQueued';
	}
}

/**
 * Deliver a raw message over SMTP with an envelope of its own — what a
 * sender's server does, `RCPT TO` and all — and return the id the receiving
 * server queued it under: Mailpit's message id, which its API serves the raw
 * message by.
 */
export async function deliverRaw(
	smtpUrl: string,
	envelope: { from: string; to: readonly string[] },
	raw: Uint8Array | string,
): Promise<string> {
	const transport = createTransport(smtpUrl);
	try {
		const info = await transport.sendMail({
			envelope: { from: envelope.from, to: [...envelope.to] },
			raw: typeof raw === 'string' ? raw : Buffer.from(raw),
		});
		const id = /queued as (\S+)/i.exec(String(info.response))?.[1];
		if (!id) throw new DeliveryNotQueued(String(info.response));
		return id;
	} finally {
		transport.close();
	}
}
