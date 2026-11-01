/**
 * The mail a test sent, read from Mailpit.
 *
 * Locally, mail goes over real SMTP to Mailpit — the same client, the same
 * message, only the host differs. A test reads what arrived through Mailpit's
 * HTTP API, so a magic link is signed in with by opening the email that was
 * actually sent rather than a token pulled from somewhere else.
 *
 * Mailpit has one inbox for everything, and transactions do not reach it, so a
 * test keeps to its own mail by address: a unique recipient per test, read by
 * `to:`, and cleared afterwards.
 */

import type { ReceivedAttachment } from '@geekmidas/emailkit/inbound';

/** How long `last()` waits for mail that is still on its way. */
const DEFAULT_TIMEOUT = 5_000;
const POLL_INTERVAL = 50;

export interface MailboxOptions {
	/** Mailpit's HTTP address — what `gkm test` injects as `<ID>_INBOX_URL`. */
	inbox: string;
	/** The `fetch` to read it with. Defaults to the global one. */
	fetch?: typeof fetch;
	/** How long `last()` waits for mail to arrive. */
	timeout?: number;
}

/** One email, as it arrived. */
export interface Email {
	id: string;
	from: string;
	to: string[];
	subject: string;
	text: string;
	html: string;
	/** Every `http(s)` link in the email, in order. */
	links: string[];
	/** The first link — the one a sign-in or confirmation email is about. */
	link: string | undefined;
	/**
	 * Its files, read from the raw message by the parser an inbox's handler
	 * uses — so what survives one survives the other.
	 */
	attachments: ReceivedAttachment[];
}

export interface Mailbox {
	/** The newest email to this address, waiting for one if none has arrived. */
	last(): Promise<Email>;
	/** Every email to this address, newest first. */
	all(): Promise<Email[]>;
	/** Delete every email to this address. */
	clear(): Promise<void>;
}

/** A way to read the mail sent to one address. */
export function createMailbox(
	options: MailboxOptions,
): (address: string) => Mailbox {
	const inbox = options.inbox.replace(/\/$/, '');
	const timeout = options.timeout ?? DEFAULT_TIMEOUT;
	const get = (path: string, init?: RequestInit) =>
		(options.fetch ?? globalThis.fetch)(`${inbox}${path}`, init);

	return (address) => {
		const query = `?query=${encodeURIComponent(`to:"${address}"`)}`;

		const all = async (): Promise<Email[]> => {
			const found = await json<SearchResult>(
				await get(`/api/v1/search${query}`),
				inbox,
			);
			return Promise.all(
				found.messages.map(async ({ ID }) => {
					const response = await get(`/api/v1/message/${ID}/raw`);
					if (!response.ok) {
						throw new InboxUnreachable(inbox, response.status);
					}
					return email(ID, new Uint8Array(await response.arrayBuffer()));
				}),
			);
		};

		return {
			all,
			async last() {
				const deadline = Date.now() + timeout;
				for (;;) {
					const [newest] = await all();
					if (newest) return newest;
					if (Date.now() >= deadline) throw new NoMail(address, timeout);
					await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
				}
			},
			async clear() {
				const response = await get(`/api/v1/search${query}`, {
					method: 'DELETE',
				});
				if (!response.ok) {
					throw new InboxUnreachable(inbox, response.status);
				}
			},
		};
	};
}

interface SearchResult {
	messages: { ID: string }[];
}

async function json<T>(response: Response, inbox: string): Promise<T> {
	if (!response.ok) throw new InboxUnreachable(inbox, response.status);
	return (await response.json()) as T;
}

/** The message, through the one MIME parser everything that reads mail uses. */
async function email(id: string, raw: Uint8Array): Promise<Email> {
	const { parseEmail } = await import('@geekmidas/emailkit/inbound');
	const message = await parseEmail(raw);
	const html = message.html ?? '';
	const text = message.text ?? '';
	const links = [
		...new Set(
			[
				...html.matchAll(/href="(https?:\/\/[^"]+)"/g),
				...text.matchAll(/(https?:\/\/[^\s<>"]+)/g),
			].map(([, url]) => decodeEntities(url!)),
		),
	];

	return {
		id,
		from: message.from?.address ?? '',
		to: message.to.map(({ address }) => address),
		subject: message.subject ?? '',
		text,
		html,
		links,
		link: links[0],
		attachments: message.attachments,
	};
}

/** `&amp;` in an HTML attribute is `&` in the URL it names. */
function decodeEntities(url: string): string {
	return url.replaceAll('&amp;', '&');
}

/** No email to an address arrived in time. */
export class NoMail extends Error {
	constructor(
		readonly address: string,
		readonly timeout: number,
	) {
		super(
			`No email to ${address} arrived within ${timeout}ms. Check that the ` +
				`code under test sends it, and to that address.`,
		);
		this.name = 'NoMail';
	}
}

/** Mailpit did not answer. */
export class InboxUnreachable extends Error {
	constructor(
		readonly inbox: string,
		readonly status: number,
	) {
		super(
			`Mailpit at ${inbox} answered ${status}. Is it running? \`gkm test\` ` +
				`starts it when the app declares an Email construct.`,
		);
		this.name = 'InboxUnreachable';
	}
}
