import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import {
	CacheIsAmbiguous,
	CacheNeedsDatabase,
	CacheNeedsProvider,
	CacheNeedsVpc,
} from '../aws/Cache';
import { EmailNeedsSender, EmailNeedsUrl } from '../aws/Email';
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

		// The table travels in the URL: two caches in one database resolve the
		// same connection string, so it is the only thing that says which one a
		// client is holding.
		expect(cache.provides().url).toBe(
			'postgres://app@db/orders?table=cache_sessions',
		);
	});

	it('gives two caches in one database a table each', () => {
		// Sharing a table would mean sharing a keyspace: each would read the
		// other's entries and evict the other's keys.
		const twoCaches = {
			...manifest,
			Rates: {
				kind: 'cache',
				id: 'Rates',
				of: 'Orders',
				provides: ['RATES_URL'],
			},
		} as const satisfies ConstructManifest;

		const urlOf = (id: 'Sessions' | 'Rates') =>
			provisionerFor('cache')(
				stack,
				twoCaches[id],
				{},
				context({
					cache: 'db',
					manifest: twoCaches,
					provisioned: {
						Orders: provided({ url: 'postgres://app@db/orders' }),
					},
				}),
			).provides().url;

		expect(urlOf('Sessions')).not.toBe(urlOf('Rates'));
		expect(urlOf('Rates')).toContain('table=cache_rates');
	});

	it('refuses to guess which database, rather than picking the first', () => {
		const twoDatabases = {
			...manifest,
			Reports: { kind: 'database', id: 'Reports', provides: ['REPORTS_URL'] },
		} as const satisfies ConstructManifest;

		expect(() =>
			provisionerFor('cache')(
				stack,
				twoDatabases.Sessions,
				{},
				context({ cache: 'db', manifest: twoDatabases }),
			),
		).toThrow(CacheIsAmbiguous);
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

	it('names the command when Upstash’s provider is not installed', () => {
		// SST preloads two providers and installs the rest on demand, so the
		// global this reaches for is absent until somebody runs the command.
		// Naming it beats an undefined-name crash halfway through a synth.
		expect(() =>
			provisionerFor('cache')(stack, manifest.Sessions, {}, context()),
		).toThrow(CacheNeedsProvider);
	});

	it('takes a URL instead, for a database that already exists', () => {
		const cache = provisionerFor('cache')(
			stack,
			manifest.Sessions,
			{ url: 'https://:token@eu1.upstash.io' },
			context(),
		);

		expect(cache.provides().url).toBe('https://:token@eu1.upstash.io');
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
});

describe('email', () => {
	it('passes a supplied URL straight through for resend', () => {
		// Nothing to provision: Resend is an API key you hold, and the URL it
		// composes into is the same smtp:// shape every other backend produces.
		const email = provisionerFor('email')(
			stack,
			manifest.Mail,
			{ url: 'smtp://resend:re_xxx@smtp.resend.com:587', from: 'a@b.com' },
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
			{ from: 'a@b.com' },
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
			{
				url: 'smtp://AKIAOLD:pw@email-smtp.eu-west-1.amazonaws.com:587',
				from: 'a@b.com',
			},
			context({ email: 'ses' }),
		);

		expect(email.provides().url).toBe(
			'smtp://AKIAOLD:pw@email-smtp.eu-west-1.amazonaws.com:587',
		);
	});

	it('refuses a backend that cannot mint its own and was given none', () => {
		// A sender alone is not enough for Resend: it is an account somebody
		// created, so there is nothing for a deploy to provision and the URL is
		// a missing setup step rather than something to default.
		expect(() =>
			provisionerFor('email')(
				stack,
				manifest.Mail,
				{ from: 'a@b.com' },
				context({ email: 'resend' }),
			),
		).toThrow(EmailNeedsUrl);
	});

	it('sends through SES when nothing said otherwise', () => {
		// The default, because it is what this repo's projects actually use.
		const email = provisionerFor('email')(
			stack,
			manifest.Mail,
			{ from: 'a@b.com' },
			context(),
		);

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
				{ url: 'smtp://user:pw@relay.example.com:587', from: 'a@b.com' },
				context({ email: backend }),
			);

			expect(String(provisioned.provides().url).startsWith('smtp://')).toBe(
				true,
			);
		}
	});

	it('refuses to invent a sending identity', () => {
		// Every provider rejects an unverified sender, so a guess would deploy
		// cleanly and fail at the first send — which is the worst place to
		// discover it.
		expect(() =>
			provisionerFor('email')(stack, manifest.Mail, {}, context()),
		).toThrow(EmailNeedsSender);
	});
});
