/**
 * `smtp://` — the one URL shape an email construct ever provides.
 *
 * Every provider is reached the same way: Mailpit locally, SES through its SMTP
 * interface, Resend and Postmark through theirs. So there is no scheme-keyed
 * driver registry here as there is in `@geekmidas/storage` — one transport, one
 * parser, and the client never branches on who is delivering the mail.
 *
 * What varies between providers is confined to the URL: host, port, and
 * credentials. That is what lets the same handler source run against Mailpit and
 * against SES without a conditional.
 */

import { MalformedEmailUrl, UnsupportedEmailScheme } from './errors';
import type { SMTPConfig } from './types';

/**
 * The port to use when the URL names none.
 *
 * 587 is submission-with-STARTTLS, which is what SES, Resend, and Postmark all
 * document; 465 is implicit TLS, which is what `smtps://` means.
 */
const DEFAULT_PORT = { 'smtp:': 587, 'smtps:': 465 } as const;

/**
 * Build an SMTP transport config from a `<NAME>_URL`.
 *
 * `smtps://` sets `secure`, which is nodemailer's flag for implicit TLS on
 * connect rather than STARTTLS after `EHLO` — the distinction 465 and 587 carry,
 * and the reason the scheme is worth having rather than inferring from the port.
 *
 * @example parseEmailUrl('smtp://mailpit:1025')
 * @example parseEmailUrl('smtps://AKIA…:…@email-smtp.eu-west-1.amazonaws.com:465')
 * @example parseEmailUrl('smtp://resend:re_123@smtp.resend.com:587')
 */
export function parseEmailUrl(url: string): SMTPConfig {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new MalformedEmailUrl(url);
	}

	if (parsed.protocol !== 'smtp:' && parsed.protocol !== 'smtps:') {
		throw new UnsupportedEmailScheme(url, parsed.protocol);
	}

	const secure = parsed.protocol === 'smtps:';
	const config: SMTPConfig = {
		host: parsed.hostname,
		port: parsed.port ? Number(parsed.port) : DEFAULT_PORT[parsed.protocol],
		secure,
	};

	// Mailpit accepts mail unauthenticated, so credentials are optional rather
	// than required — omitting `auth` entirely is what nodemailer expects, where
	// empty strings would be sent as a real (failing) AUTH exchange.
	if (parsed.username) {
		config.auth = {
			user: decodeURIComponent(parsed.username),
			pass: decodeURIComponent(parsed.password),
		};
	}

	// Local containers present a self-signed certificate. Rather than have every
	// project set this, read it off the URL — the adapter that knows it is
	// pointing at a container is the one that can say so.
	if (parsed.searchParams.get('insecure') === 'true') {
		config.tls = { rejectUnauthorized: false };
	}

	return config;
}
