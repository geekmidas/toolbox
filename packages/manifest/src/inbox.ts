/**
 * Receiving mail: which addresses an inbox receives at, matched one way
 * everywhere.
 *
 * The deployed receipt rule, `gkm dev`'s filter over Mailpit, the decoder in
 * front of a handler and the test mailbox all route a message by asking
 * {@link inboxRecipient} about its *envelope* recipient. `From:` and `To:` are
 * written by the sender and route nothing.
 */

import type { InboxDeclaration } from './declaration';

/** The event type a received message is announced as on its inbox's topic. */
export const INBOX_EVENT = 'email.received';

/**
 * Where an inbox's raw messages are kept in its bucket: SES's S3 action
 * writes `<prefix><message id>`, and `gkm dev` and the test mailbox write the
 * same layout.
 */
export const INBOX_MESSAGES_PREFIX = 'messages/';

/** An envelope recipient an inbox receives at, taken apart. */
export interface InboxRecipient {
	/** The address, lowercased: `requests+t_8f3k@acme.fixwell.example`. */
	address: string;
	/** The declared local part it matched: `requests`. */
	local: string;
	/** What followed a `+` in the local part: `t_8f3k`. */
	tag?: string;
	/** The label in front of the stage's domain, with `subdomains: true`. */
	subdomain?: string;
}

/** What {@link inboxRecipient} needs of an inbox. */
export type InboxAddressing = Pick<
	InboxDeclaration,
	'addresses' | 'subdomains'
>;

/**
 * The recipient `address` is to `inbox` on `domain`, or `undefined` when the
 * inbox does not receive at it.
 *
 * - The local part is a declared address, or one with a `+tag` after it.
 * - Without `subdomains`, the domain is the stage's domain itself; with it,
 *   exactly one label in front of the stage's domain — `acme.fixwell.example`
 *   — and never the bare domain, whose mail would belong to no tenant.
 *
 * Case-insensitive, as mail addresses are in practice.
 */
export function inboxRecipient(
	address: string,
	inbox: InboxAddressing,
	domain: string,
): InboxRecipient | undefined {
	const normalized = address.trim().toLowerCase();
	const at = normalized.lastIndexOf('@');
	if (at <= 0) return undefined;

	const localPart = normalized.slice(0, at);
	const host = normalized.slice(at + 1);
	const base = domain.toLowerCase();

	let subdomain: string | undefined;
	if (inbox.subdomains) {
		if (!host.endsWith(`.${base}`)) return undefined;
		subdomain = host.slice(0, -(base.length + 1));
		if (!subdomain || subdomain.includes('.')) return undefined;
	} else if (host !== base) {
		return undefined;
	}

	const plus = localPart.indexOf('+');
	const local = plus === -1 ? localPart : localPart.slice(0, plus);
	const tag = plus === -1 ? undefined : localPart.slice(plus + 1);
	if (!inbox.addresses.some((declared) => declared.toLowerCase() === local)) {
		return undefined;
	}

	return {
		address: normalized,
		local,
		...(tag ? { tag } : {}),
		...(subdomain ? { subdomain } : {}),
	};
}

/**
 * The recipients a deployed receipt rule names for `inbox` on `domain`.
 *
 * Without `subdomains`, each address on the domain: SES matches an address
 * condition's `+label` variants too, so `requests@` takes `requests+t_8f3k@`.
 * With it, every subdomain (`.fixwell.example`): a condition cannot say
 * "`requests` on any subdomain", so the rule takes the subdomains' mail and
 * the decoder in front of the handler drops what {@link inboxRecipient} does
 * not match.
 */
export function receiptRecipients(
	inbox: InboxAddressing,
	domain: string,
): string[] {
	const base = domain.toLowerCase();
	return inbox.subdomains
		? [`.${base}`]
		: inbox.addresses.map((address) => `${address.toLowerCase()}@${base}`);
}
