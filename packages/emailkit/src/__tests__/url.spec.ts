import { describe, expect, it } from 'vitest';
import { MalformedEmailUrl, UnsupportedEmailScheme } from '../errors';
import { parseEmailUrl } from '../url';

describe('parseEmailUrl', () => {
	it('reads the local container URL', () => {
		// Mailpit takes mail from anyone; no auth is not a missing credential.
		expect(parseEmailUrl('smtp://mailpit:1025')).toEqual({
			host: 'mailpit',
			port: 1025,
			secure: false,
		});
	});

	it('omits auth entirely when the URL carries no credentials', () => {
		// An empty user/pass would be sent as a real AUTH exchange, and fail.
		expect(parseEmailUrl('smtp://mailpit:1025')).not.toHaveProperty('auth');
	});

	it('reads credentials off the URL', () => {
		expect(parseEmailUrl('smtp://resend:re_123@smtp.resend.com:587')).toEqual({
			host: 'smtp.resend.com',
			port: 587,
			secure: false,
			auth: { user: 'resend', pass: 're_123' },
		});
	});

	it('parses an SES URL exactly as it parses any other provider', () => {
		// The whole point of one scheme: nothing here knows this one is SES.
		const ses = parseEmailUrl(
			'smtps://AKIAEXAMPLE:BF%2Bsecret@email-smtp.eu-west-1.amazonaws.com:465',
		);

		expect(ses).toEqual({
			host: 'email-smtp.eu-west-1.amazonaws.com',
			port: 465,
			secure: true,
			auth: { user: 'AKIAEXAMPLE', pass: 'BF+secret' },
		});
	});

	it('decodes percent-encoded credentials', () => {
		// SES SMTP passwords are base64 and routinely contain `+` and `/`.
		const { auth } = parseEmailUrl('smtp://user:a%2Fb%2Bc%3D@host:587');

		expect(auth?.pass).toBe('a/b+c=');
	});

	it('defaults smtp to the submission port', () => {
		expect(parseEmailUrl('smtp://host').port).toBe(587);
	});

	it('defaults smtps to the implicit-TLS port', () => {
		expect(parseEmailUrl('smtps://host').port).toBe(465);
	});

	it('treats smtps as implicit TLS rather than STARTTLS', () => {
		// The distinction 465 and 587 carry, and why the scheme is worth having.
		expect(parseEmailUrl('smtps://host').secure).toBe(true);
		expect(parseEmailUrl('smtp://host').secure).toBe(false);
	});

	it('relaxes certificate checking only when the URL asks', () => {
		expect(parseEmailUrl('smtps://host?insecure=true').tls).toEqual({
			rejectUnauthorized: false,
		});
		expect(parseEmailUrl('smtps://host')).not.toHaveProperty('tls');
	});

	it('rejects a scheme this transport cannot speak', () => {
		// There is no `ses://` — a provider is not a protocol.
		expect(() => parseEmailUrl('ses://?region=eu-west-1')).toThrow(
			UnsupportedEmailScheme,
		);
	});

	it('carries the offending scheme as a field, not in the message', () => {
		// The message states the rule and never interpolates the URL — a mail
		// URL's userinfo is a credential, so interpolating it leaks one into
		// every log line that touches the error.
		try {
			parseEmailUrl('ses://?region=eu-west-1');
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(UnsupportedEmailScheme);
			const scheme = error as UnsupportedEmailScheme;
			expect(scheme.message).toBe('Email URL scheme must be smtp: or smtps:');
			expect(scheme.actual).toBe('ses:');
			expect(scheme.url).toBe('ses://?region=eu-west-1');
		}
	});

	it('reports a bare host:port as a scheme it cannot speak', () => {
		// `mailpit:1025` parses — as scheme `mailpit:` — so it is the scheme
		// error rather than the parse error that fires, which reads better.
		expect(() => parseEmailUrl('mailpit:1025')).toThrow(UnsupportedEmailScheme);
	});

	it('rejects a string that is not a URL at all', () => {
		expect(() => parseEmailUrl('not a url')).toThrow(MalformedEmailUrl);
	});
});
