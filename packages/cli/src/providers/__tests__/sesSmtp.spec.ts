import { describe, expect, it } from 'vitest';
import { domainOf, senderOf, urlSetElsewhere } from '../ses/email';
import { EmailSenderUnknown } from '../ses/errors';
import { smtpHost, smtpKeySecret, smtpPassword, smtpUrl } from '../ses/smtp';

/** AWS's documented example secret. */
const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

describe('the SES SMTP password', () => {
	it("is the key's secret signed for the region, as SES's own script derives it", () => {
		// From a separate Python implementation of the SES Developer Guide's derivation.
		expect(smtpPassword(SECRET, 'us-east-1')).toBe(
			'BLBM/9hSUELfq8Gw+rU1YcBjkOxGbhT2XG763xVLGWL9',
		);
		expect(smtpPassword(SECRET, 'eu-west-1')).toBe(
			'BMW5RDrXmmVs0lV7GpI4oLkHXpZ4stDsk6q91z1g38Pk',
		);
	});

	it('goes into a URL that reads back as the key and the password', () => {
		const url = new URL(smtpUrl('AKIAEXAMPLE', SECRET, 'eu-west-1'));

		expect(url.protocol).toBe('smtp:');
		expect(url.hostname).toBe(smtpHost('eu-west-1'));
		expect(url.port).toBe('587');
		expect(decodeURIComponent(url.username)).toBe('AKIAEXAMPLE');
		expect(decodeURIComponent(url.password)).toBe(
			smtpPassword(SECRET, 'eu-west-1'),
		);
	});
});

describe("a mail construct's URL as a key's secret", () => {
	const secret = smtpKeySecret('MAIL_URL', 'eu-west-1');

	it("reads the key from a URL on the region's endpoint", () => {
		expect(secret.keyIdOf(smtpUrl('AKIAEXAMPLE', SECRET, 'eu-west-1'))).toBe(
			'AKIAEXAMPLE',
		);
	});

	it("holds no usable key on another region's endpoint, or another server", () => {
		expect(
			secret.keyIdOf(smtpUrl('AKIAEXAMPLE', SECRET, 'us-east-1')),
		).toBeUndefined();
		expect(
			secret.keyIdOf('smtp://user:pass@smtp.example.com:587'),
		).toBeUndefined();
		expect(secret.keyIdOf('not a url')).toBeUndefined();
	});
});

describe('which mail the provider leaves alone', () => {
	const state = (record?: { id: string; previous?: string }) => ({
		record: () =>
			record
				? {
						key: 'iam-access-key:Mail',
						type: 'iam-access-key',
						status: 'ready' as const,
						id: record.id,
						data: record.previous ? { previous: record.previous } : {},
					}
				: undefined,
		pending: async () => {},
		ready: async () => {},
	});
	const url = (key: string) => smtpUrl(key, SECRET, 'eu-west-1');

	it('a URL it did not write — set by hand, or imported', () => {
		expect(
			urlSetElsewhere(
				{
					secrets: { MAIL_URL: 'smtp://u:p@smtp.example.com:587' },
					state: state(),
				} as never,
				'Mail',
			),
		).toBe(true);
		expect(
			urlSetElsewhere(
				{
					secrets: { MAIL_URL: url('AKIAOTHER') },
					state: state({ id: 'AKIAOURS' }),
				} as never,
				'Mail',
			),
		).toBe(true);
	});

	it('not one holding the key it recorded, or the one it rotated out', () => {
		expect(
			urlSetElsewhere(
				{
					secrets: { MAIL_URL: url('AKIAOURS') },
					state: state({ id: 'AKIAOURS' }),
				} as never,
				'Mail',
			),
		).toBe(false);
		expect(
			urlSetElsewhere(
				{
					secrets: { MAIL_URL: url('AKIAOLD') },
					state: state({ id: 'AKIANEW', previous: 'AKIAOLD' }),
				} as never,
				'Mail',
			),
		).toBe(false);
		expect(
			urlSetElsewhere({ secrets: {}, state: state() } as never, 'Mail'),
		).toBe(false);
	});
});

describe('the address mail is sent from', () => {
	const ctx = (
		config: { from?: string },
		secrets: Record<string, string> = {},
		domain: string | null = 'shop.example.com',
		wrote?: string,
	) =>
		({
			config: { provider: 'ses', ...config },
			secrets,
			workspace: { domains: domain ? { production: domain } : {} },
			stage: 'production',
			state: {
				record: (key: string) =>
					wrote && key === 'email-from:Mail' ? { id: wrote } : undefined,
			},
		}) as never;

	it("is `from`, else an address set by hand, else noreply@ the stage's domain", () => {
		expect(
			senderOf(
				ctx({ from: 'hi@other.example' }, { MAIL_FROM: 'x@y.z' }),
				'Mail',
			),
		).toEqual({ address: 'hi@other.example', ours: true });
		expect(senderOf(ctx({}, { MAIL_FROM: 'x@y.example' }), 'Mail')).toEqual({
			address: 'x@y.example',
			ours: false,
		});
		expect(senderOf(ctx({}), 'Mail')).toEqual({
			address: 'noreply@shop.example.com',
			ours: true,
		});
	});

	it("follows the stage's domain when the address held is the one gkm wrote", () => {
		const moved = ctx(
			{},
			{ MAIL_FROM: 'noreply@old.example' },
			'new.example',
			'noreply@old.example',
		);

		expect(senderOf(moved, 'Mail')).toEqual({
			address: 'noreply@new.example',
			ours: true,
		});
	});

	it('follows the domain once `from` is removed, rather than keep what `from` was', () => {
		const dropped = ctx(
			{},
			{ MAIL_FROM: 'hi@other.example' },
			'shop.example.com',
			'hi@other.example',
		);

		expect(senderOf(dropped, 'Mail').address).toBe('noreply@shop.example.com');
	});

	it('adopts the default it finds unrecorded — written before gkm recorded it', () => {
		expect(
			senderOf(ctx({}, { MAIL_FROM: 'noreply@shop.example.com' }), 'Mail'),
		).toEqual({ address: 'noreply@shop.example.com', ours: true });
	});

	it('is refused with no domain to send from, saying what to set', () => {
		expect(() => senderOf(ctx({}, {}, null), 'Mail')).toThrow(
			EmailSenderUnknown,
		);
		expect(() => senderOf(ctx({}, {}, null), 'Mail')).toThrow(
			/domains\.production.*deploy\.email\.production\.from/,
		);
	});

	it('sends as its domain, a display name or not', () => {
		expect(domainOf('noreply@Shop.Example.com')).toBe('shop.example.com');
		expect(domainOf('Acme <hi@acme.example>')).toBe('acme.example');
	});
});
