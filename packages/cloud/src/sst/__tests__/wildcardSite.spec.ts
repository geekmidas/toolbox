import {
	type ConstructManifest,
	PUBLIC_PREFIX,
	providedKeyFor,
	trustsOrigin,
} from '@geekmidas/manifest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { WildcardSiteNeedsDomain } from '../errors';
import { fromManifest } from '../fromManifest';

/**
 * A site on every subdomain, on AWS: one distribution under `*.<domain>`, a
 * wildcard certificate validated through the stack's zone, one alias record,
 * and nothing per tenant.
 */

const keys = (id: string, kind: string, roles: string[]) =>
	roles.map((role) => providedKeyFor(id, kind as never, role));

function manifest(): ConstructManifest {
	return {
		Api: {
			kind: 'rest-api',
			id: 'Api',
			path: 'apps/api',
			endpoints: [
				{
					id: 'TenantHosts',
					handler: 'hosts.handler',
					method: 'GET',
					path: '/tenants/hosts',
					dependencies: [],
				},
			],
			provides: keys('Api', 'rest-api', [
				'url',
				'trustedOrigins',
				'cookieDomain',
			]),
		},
		Admin: {
			kind: 'site',
			id: 'Admin',
			variant: 'static',
			subdomain: 'admin',
			app: { path: 'apps/admin' },
			dependencies: [{ target: 'Api', kind: 'rest-api' }],
			provides: keys('Admin', 'site', ['url']),
		},
		App: {
			kind: 'site',
			id: 'App',
			variant: 'next',
			subdomain: '*',
			hosts: { surface: 'Api', path: '/tenants/hosts' },
			app: { path: 'apps/web' },
			dependencies: [{ target: 'Api', kind: 'rest-api' }],
			provides: keys('App', 'site', ['url', 'domain', 'protectedSubdomains']),
		},
	} as unknown as ConstructManifest;
}

const stackOn = (domain: string, hostedZoneId: string = 'Z123') =>
	new App({
		name: 'shop',
		stage: 'production',
		domain,
		hostedZoneId,
		region: 'eu-west-1',
	}).stack('shop');

const argsOf = (component: unknown) =>
	(component as { args: Record<string, any> }).args;

const settle = async (value: unknown): Promise<unknown> =>
	typeof value === 'object' && value && 'apply' in value
		? (value as { apply: (fn: (v: unknown) => unknown) => unknown }).apply(
				(v) => v,
			)
		: value;

const PROTECTED = ['admin', 'api', 'www'];

describe('a wildcard site on AWS', () => {
	afterEach(() => vi.restoreAllMocks());

	it('is one distribution under *.<domain>, its certificate and alias through the stack’s zone', () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const provisioned = fromManifest(
			stackOn('example.com'),
			manifest(),
			{},
			{
				protectedSubdomains: PROTECTED,
			},
		);

		expect(argsOf(provisioned.App).domain).toEqual({
			name: '*.example.com',
			dns: { dns: { zone: 'Z123' } },
		});
		// A named site keeps its own: nothing about it changed.
		expect(argsOf(provisioned.Admin).domain).toBeUndefined();
	});

	it('looks its zone up by name when the stack has none resolved', () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const provisioned = fromManifest(
			stackOn('example.com', ''),
			manifest(),
			{},
			{ protectedSubdomains: PROTECTED },
		);

		expect(argsOf(provisioned.App).domain.dns).toEqual({ dns: {} });
	});

	it('provides its address, domain and protected labels, and inlines the last two', () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const provisioned = fromManifest(
			stackOn('example.com'),
			manifest(),
			{},
			{
				protectedSubdomains: PROTECTED,
			},
		);

		expect(provisioned.App!.provides()).toEqual({
			url: 'https://*.example.com',
			domain: 'example.com',
			protectedSubdomains: 'admin,api,www',
		});

		const env = argsOf(provisioned.App).environment as Record<string, unknown>;
		const prefix = PUBLIC_PREFIX.next;
		expect(env[`${prefix}${providedKeyFor('App', 'site', 'domain')}`]).toBe(
			'example.com',
		);
		expect(
			env[`${prefix}${providedKeyFor('App', 'site', 'protectedSubdomains')}`],
		).toBe('admin,api,www');
	});

	it('has the surfaces it calls trust every tenant’s origin, one label deep', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const provisioned = fromManifest(
			stackOn('example.com'),
			manifest(),
			{},
			{
				protectedSubdomains: PROTECTED,
			},
		);
		const trusted = String(
			await settle(provisioned.Api!.provides().trustedOrigins),
		).split(',');

		expect(trusted).toContain('https://*.example.com');
		expect(trustsOrigin('https://acme.example.com', trusted)).toBe(true);
		expect(trustsOrigin('https://a.b.example.com', trusted)).toBe(false);
		expect(trustsOrigin('https://example.com', trusted)).toBe(false);
	});

	it('lets an override win, as every other prop does', () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const domain = { name: '*.tenants.example.com' };
		const provisioned = fromManifest(
			stackOn('example.com'),
			manifest(),
			{ App: { domain } } as never,
			{ protectedSubdomains: PROTECTED },
		);

		expect(argsOf(provisioned.App).domain).toBe(domain);
	});

	it('is refused on a stack with no domain, naming the site', () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});

		expect.assertions(2);
		try {
			fromManifest(stackOn(''), manifest(), {}, {});
		} catch (error) {
			expect(error).toBeInstanceOf(WildcardSiteNeedsDomain);
			expect((error as WildcardSiteNeedsDomain).id).toBe('App');
		}
	});
});
