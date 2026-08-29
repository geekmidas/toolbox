import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { CacheNeedsDatabase, CacheNeedsUrl, CacheNeedsVpc } from '../aws/Cache';
import { EmailNeedsUrl } from '../aws/Email';
import { type ProvisionContext, provisionerFor } from '../fromManifest';

const stack = {} as never;

const manifest = {
	Sessions: { kind: 'cache', id: 'Sessions', provides: ['SESSIONS_URL'] },
	Mail: { kind: 'email', id: 'Mail', provides: ['MAIL_URL'] },
	Orders: { kind: 'database', id: 'Orders', provides: ['ORDERS_URL'] },
} as const satisfies ConstructManifest;

const context = (
	overrides: Partial<ProvisionContext> = {},
): ProvisionContext => ({
	manifest,
	provisioned: {},
	bootstraps: new Map(),
	...overrides,
});

const provided = (values: Record<string, string>) =>
	({ provides: () => values }) as never;

describe('cache', () => {
	it('resolves the declared database for the db backend', () => {
		// No second address and no second credential — which is the whole reason
		// this backend costs nothing to run.
		const cache = provisionerFor('cache')(
			stack,
			manifest.Sessions,
			{},
			context({
				cache: 'db',
				provisioned: { Orders: provided({ url: 'postgres://app@db/orders' }) },
			}),
		);

		expect(cache.provides().url).toBe('postgres://app@db/orders');
	});

	it('refuses a database-backed cache with no database', () => {
		expect(() =>
			provisionerFor('cache')(
				stack,
				manifest.Sessions,
				{},
				context({ cache: 'db' }),
			),
		).toThrow(CacheNeedsDatabase);
	});

	it('refuses to invent an Upstash URL', () => {
		// Upstash is an account somebody creates, not infrastructure this
		// provisions — so its absence is a missing step, not a default.
		expect(() =>
			provisionerFor('cache')(stack, manifest.Sessions, {}, context()),
		).toThrow(CacheNeedsUrl);
	});

	it('refuses an ElastiCache cache with no VPC', () => {
		// A cache in a VPC is reachable from functions in that VPC and from
		// nowhere else, so the VPC is the choice rather than a detail.
		expect(() =>
			provisionerFor('cache')(
				stack,
				manifest.Sessions,
				{},
				context({ cache: 'elasticache' }),
			),
		).toThrow(CacheNeedsVpc);
	});

	it('takes the URL it was given', () => {
		const cache = provisionerFor('cache')(
			stack,
			manifest.Sessions,
			{ url: 'https://token@eu1.upstash.io' },
			context(),
		);

		expect(cache.provides().url).toBe('https://token@eu1.upstash.io');
	});
});

describe('email', () => {
	it('passes a supplied URL straight through for resend', () => {
		// Nothing to provision: Resend is an API key you hold, and the URL it
		// composes into is the same smtp:// shape every other backend produces.
		const email = provisionerFor('email')(
			stack,
			manifest.Mail,
			{ url: 'smtp://resend:re_xxx@smtp.resend.com:587' },
			context({ email: 'resend' }),
		);

		expect(email.provides().url).toBe(
			'smtp://resend:re_xxx@smtp.resend.com:587',
		);
	});

	it('derives its own credential for ses when given none', () => {
		// The only backend that is a chain rather than a value: a user, a key,
		// and a password computed from it.
		const email = provisionerFor('email')(
			stack,
			manifest.Mail,
			{},
			context({ email: 'ses' }),
		);

		expect(email.provides().url).toMatch(
			/^smtp:\/\/.+:.+@email-smtp\.eu-west-1\.amazonaws\.com:587$/,
		);
	});

	it('uses credentials that already exist rather than making more', () => {
		// The common case: a sending identity set up once, by hand. Creating a
		// second IAM user for it would be a deploy quietly adding another way
		// into the account.
		const email = provisionerFor('email')(
			stack,
			manifest.Mail,
			{ url: 'smtp://AKIAOLD:pw@email-smtp.eu-west-1.amazonaws.com:587' },
			context({ email: 'ses' }),
		);

		expect(email.provides().url).toBe(
			'smtp://AKIAOLD:pw@email-smtp.eu-west-1.amazonaws.com:587',
		);
	});

	it('refuses a backend that cannot mint its own and was given none', () => {
		expect(() =>
			provisionerFor('email')(
				stack,
				manifest.Mail,
				{},
				context({ email: 'resend' }),
			),
		).toThrow(EmailNeedsUrl);
	});

	it('sends through SES when nothing said otherwise', () => {
		// The default, because it is what this repo's projects actually use.
		const email = provisionerFor('email')(stack, manifest.Mail, {}, context());

		expect(email.provides().url).toContain('email-smtp.');
	});

	it('produces an smtp:// URL whichever backend it is', () => {
		// The property that lets one client serve all of them, and the reason the
		// declaration names no provider.
		const backends = ['resend', 'smtp'] as const;

		for (const backend of backends) {
			const provisioned = provisionerFor('email')(
				stack,
				manifest.Mail,
				{ url: 'smtp://user:pw@relay.example.com:587' },
				context({ email: backend }),
			);

			expect(String(provisioned.provides().url).startsWith('smtp://')).toBe(
				true,
			);
		}
	});
});
