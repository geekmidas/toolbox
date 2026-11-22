/**
 * Sending mail: the one address an `Email` construct sends from on a stage.
 *
 * The local part is the construct's (`from: 'info'`), the same on every
 * stage; the domain is the stage's, or a label of it the construct names
 * (`subdomain: 'mail'`). Every place that writes `<ID>_FROM` —
 * `gkm dev`/`gkm test`, a compose stack's Mailpit, the SES provider — calls
 * {@link senderAddress} rather than joining the two itself.
 */

import type { EmailDeclaration } from './declaration';

/** The local part mail is sent from when the construct names none. */
export const DEFAULT_SENDER = 'noreply';

/**
 * The domain `email` sends from, of the stage's `domain`: the domain itself,
 * or with a `subdomain`, that label in front of it — `mail.shop.example.com`.
 */
export function senderDomain(
	email: Pick<EmailDeclaration, 'subdomain'>,
	domain: string,
): string {
	return email.subdomain ? `${email.subdomain}.${domain}` : domain;
}

/**
 * `<local part>@<sending domain>` — `info@shop.example.com`, else
 * `noreply@…`; `info@mail.shop.example.com` with `subdomain: 'mail'`.
 */
export function senderAddress(
	email: Pick<EmailDeclaration, 'from' | 'subdomain'>,
	domain: string,
): string {
	return `${email.from ?? DEFAULT_SENDER}@${senderDomain(email, domain)}`;
}
