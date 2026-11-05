import { type ConstructManifest, providedKeyFor } from '@geekmidas/manifest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { HostLabelNeedsCustomDomain } from '../errors';
import { assertNoHostLabels, fromManifest } from '../fromManifest';

/**
 * Aliases and redirects on AWS: no surface but a wildcard site has a custom
 * domain there, so either one fails the deploy, naming the construct, rather
 * than deploying a host that never answers.
 */

const keys = (id: string, kind: string, roles: string[]) =>
	roles.map((role) => providedKeyFor(id, kind as never, role));

function manifest(
	web: { aliases?: string[]; redirects?: string[] } = {},
): ConstructManifest {
	return {
		Api: {
			kind: 'rest-api',
			id: 'Api',
			path: 'apps/api',
			endpoints: [],
			provides: keys('Api', 'rest-api', [
				'url',
				'trustedOrigins',
				'cookieDomain',
			]),
		},
		Web: {
			kind: 'site',
			id: 'Web',
			variant: 'static',
			app: { path: 'apps/web' },
			dependencies: [{ target: 'Api', kind: 'rest-api' }],
			provides: keys('Web', 'site', ['url']),
			...web,
		},
	} as unknown as ConstructManifest;
}

const stack = () =>
	new App({
		name: 'shop',
		stage: 'production',
		domain: 'example.com',
		hostedZoneId: 'Z123',
		region: 'eu-west-1',
	}).stack('shop');

describe('aliases and redirects on AWS', () => {
	afterEach(() => vi.restoreAllMocks());

	it('pass a manifest that declares none', () => {
		expect(() => assertNoHostLabels(manifest())).not.toThrow();
	});

	it.each([
		[{ aliases: ['store'] }, ['store']],
		[{ redirects: ['www'] }, ['www']],
	])('fail the deploy, naming the construct and its labels', (web, labels) => {
		vi.spyOn(console, 'log').mockImplementation(() => {});

		expect.assertions(3);
		try {
			fromManifest(stack(), manifest(web), {}, {});
		} catch (error) {
			expect(error).toBeInstanceOf(HostLabelNeedsCustomDomain);
			expect((error as HostLabelNeedsCustomDomain).id).toBe('Web');
			expect((error as HostLabelNeedsCustomDomain).labels).toEqual(labels);
		}
	});
});
