import { describe, expect, it } from 'vitest';
import { InvalidHostLabel, RestApi } from '../rest-api';
import {
	HostLabelBothAliasAndRedirect,
	StaticSite,
	WildcardSiteCannotHaveAliases,
} from '../site';
import { WebSocketApi } from '../websocket-api';

/**
 * The labels a surface or site adds beside its own — `aliases` it answers
 * on, and a site's `redirects` — declared, and refused at construction when
 * they cannot be a host of their own.
 */

describe('aliases and redirects', () => {
	it('declares a surface’s aliases beside its own label', () => {
		const api = new RestApi('Api', { path: 'apps/api', aliases: ['rest'] });
		const realtime = new WebSocketApi('Realtime', {
			path: 'apps/realtime',
			aliases: ['ws'],
		});

		expect(api.declare()[0]).toMatchObject({
			kind: 'rest-api',
			aliases: ['rest'],
		});
		expect(realtime.declare()[0]).toMatchObject({
			kind: 'websocket-api',
			aliases: ['ws'],
		});
		// Its address is still its own label's.
		expect(api.keys.url).toBe('API_URL');
	});

	it('declares a site’s aliases and redirects', () => {
		const web = new StaticSite('Web', {
			path: 'apps/web',
			aliases: ['store'],
			redirects: ['www'],
		});

		expect(web.declare()[0]).toMatchObject({
			kind: 'site',
			aliases: ['store'],
			redirects: ['www'],
		});
	});

	it('declares neither field when none is given', () => {
		const [site] = new StaticSite('Web', { path: 'apps/web' }).declare();

		expect(site).not.toHaveProperty('aliases');
		expect(site).not.toHaveProperty('redirects');
	});

	it('refuses a label that is not one host under the domain', () => {
		expect(
			() => new RestApi('Api', { path: 'apps/api', aliases: ['*'] }),
		).toThrow(InvalidHostLabel);
		expect(
			() => new RestApi('Api', { path: 'apps/api', aliases: ['rest.v2'] }),
		).toThrow(InvalidHostLabel);
		expect(
			() =>
				new WebSocketApi('Realtime', {
					path: 'apps/realtime',
					aliases: ['realtime'],
				}),
		).toThrow(InvalidHostLabel);
		expect(
			() =>
				new StaticSite('Web', {
					path: 'apps/web',
					subdomain: 'shop',
					redirects: ['shop'],
				}),
		).toThrow(InvalidHostLabel);
	});

	it('refuses either field on a wildcard site', () => {
		const hosts = new RestApi('Api', { path: 'apps/api' })
			.get('/tenants/hosts')
			.handle(async () => ({}));

		expect(
			() =>
				new StaticSite('App', {
					path: 'apps/app',
					subdomain: '*',
					hosts,
					redirects: ['www'],
				}),
		).toThrow(WildcardSiteCannotHaveAliases);
	});

	it('refuses a label that is both an alias and a redirect', () => {
		expect(
			() =>
				new StaticSite('Web', {
					path: 'apps/web',
					aliases: ['www'],
					redirects: ['www'],
				}),
		).toThrow(HostLabelBothAliasAndRedirect);
	});

	it('keeps redirects off a surface’s type', () => {
		// @ts-expect-error — an API client does not reliably follow a 301 on POST.
		new RestApi('Api', { path: 'apps/api', redirects: ['www'] });
	});
});
