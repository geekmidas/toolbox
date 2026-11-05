/**
 * Sending mail: the one address an `Email` construct sends from on a stage.
 *
 * The local part is the construct's (`from: 'info'`), the same on every
 * stage; the domain is the stage's. Every place that writes `<ID>_FROM` —
 * `gkm dev`/`gkm test`, a compose stack's Mailpit, the SES provider — calls
 * {@link senderAddress} rather than joining the two itself.
 */

import type { EmailDeclaration } from './declaration';

/** The local part mail is sent from when the construct names none. */
export const DEFAULT_SENDER = 'noreply';

/** `<local part>@<domain>` — `info@shop.example.com`, else `noreply@…`. */
export function senderAddress(
	email: Pick<EmailDeclaration, 'from'>,
	domain: string,
): string {
	return `${email.from ?? DEFAULT_SENDER}@${domain}`;
}
