import { Email } from '@geekmidas/constructs/email';
import { Welcome } from './templates/Welcome.js';

/**
 * Outbound mail.
 *
 * Locally `MAIL_URL` points at Mailpit — an inbox you can open on its published
 * port, which is most of why it is a real container rather than a stub. Deployed
 * the same key points at SES or whoever else delivers it: mail travels over SMTP
 * whatever the provider, so there is one scheme, one client, and no driver
 * registry. The provider survives only as a host and a credential.
 *
 * `from` is deliberately not here — it belongs to the verified sending domain,
 * which differs per stage, so it arrives as `MAIL_FROM` beside the URL.
 */
export const mail = new Email('Mail', {
	templates: { welcome: Welcome },
});
