import { describe, expect, it } from 'vitest';
import {
	assertHostLabels,
	assertSubdomainLabel,
	HostLabelBothAliasAndRedirect,
	hostLabels,
	InvalidHostLabel,
	isHostedDeclaration,
	WildcardSiteCannotHaveAliases,
} from '../hosts';

describe('hostLabels', () => {
	it('is its id kebab-cased, with no aliases or redirects by default', () => {
		expect(hostLabels({ id: 'AdminConsole' })).toEqual({
			primary: 'admin-console',
			aliases: [],
			redirects: [],
		});
	});

	it('is its subdomain where it declared one, and its aliases and redirects in order', () => {
		expect(
			hostLabels({
				id: 'Web',
				subdomain: 'shop',
				aliases: ['store', 'buy'],
				redirects: ['www'],
			}),
		).toEqual({
			primary: 'shop',
			aliases: ['store', 'buy'],
			redirects: ['www'],
		});
	});

	it("is '*' for a wildcard site", () => {
		expect(hostLabels({ id: 'App', subdomain: '*' }).primary).toBe('*');
	});
});

describe('isHostedDeclaration', () => {
	it('is a surface or a site, and nothing else', () => {
		expect(
			isHostedDeclaration({
				kind: 'rest-api',
				id: 'Api',
				path: '.',
				endpoints: [],
			}),
		).toBe(true);
		expect(isHostedDeclaration({ kind: 'topic', id: 'Users' })).toBe(false);
		expect(isHostedDeclaration(undefined)).toBe(false);
	});
});

describe('assertHostLabels', () => {
	it('accepts labels under the domain', () => {
		expect(() =>
			assertHostLabels({ id: 'Web', aliases: ['store'], redirects: ['www'] }),
		).not.toThrow();
	});

	it.each([
		['*', 'aliases'],
		['rest.api', 'aliases'],
		['Rest', 'aliases'],
		['', 'aliases'],
		['api', 'aliases'],
		['www', 'redirects'],
	] as const)("refuses '%s'", (label, field) => {
		const source =
			label === 'www'
				? { id: 'Web', redirects: ['www', 'www'] }
				: { id: 'Api', [field]: [label] };
		try {
			assertHostLabels(source);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(InvalidHostLabel);
			expect((error as InvalidHostLabel).label).toBe(label);
			expect((error as InvalidHostLabel).field).toBe(field);
		}
	});

	it("refuses its own label, its subdomain's rather than its id's", () => {
		expect(() =>
			assertHostLabels({ id: 'Api', subdomain: 'rest', aliases: ['rest'] }),
		).toThrow(InvalidHostLabel);
		expect(() =>
			assertHostLabels({ id: 'Api', subdomain: 'rest', aliases: ['api'] }),
		).not.toThrow();
	});

	it('refuses either field on a wildcard site', () => {
		expect(() =>
			assertHostLabels({ id: 'App', subdomain: '*', aliases: ['x'] }),
		).toThrow(WildcardSiteCannotHaveAliases);
		expect(() =>
			assertHostLabels({ id: 'App', subdomain: '*', redirects: ['www'] }),
		).toThrow(WildcardSiteCannotHaveAliases);
	});

	it('refuses a label that is both an alias and a redirect', () => {
		try {
			assertHostLabels({ id: 'Web', aliases: ['www'], redirects: ['www'] });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(HostLabelBothAliasAndRedirect);
			expect((error as HostLabelBothAliasAndRedirect).label).toBe('www');
		}
	});
});

describe('assertSubdomainLabel', () => {
	it('takes one DNS label', () => {
		for (const label of ['telemetry', 'logs', 'o11y', 'my-logs']) {
			expect(() => assertSubdomainLabel('Telemetry', label)).not.toThrow();
		}
	});

	it('refuses a wildcard, a dot, or anything not a label, naming the field', () => {
		for (const label of ['*', 'logs.ops', 'Logs', '-logs', '']) {
			try {
				assertSubdomainLabel('Telemetry', label);
				expect.unreachable();
			} catch (error) {
				expect(error).toBeInstanceOf(InvalidHostLabel);
				expect((error as InvalidHostLabel).field).toBe('subdomain');
				expect((error as Error).message).toContain(`subdomain: '${label}'`);
			}
		}
	});
});
