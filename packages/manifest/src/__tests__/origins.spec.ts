import { describe, expect, it } from 'vitest';
import { trustsOrigin, wildcardDomainOf } from '../origins';

describe('trustsOrigin', () => {
	it('trusts an exact origin, scheme, host and port', () => {
		const trusted = ['https://console.example.com'];

		expect(trustsOrigin('https://console.example.com', trusted)).toBe(true);
		expect(trustsOrigin('http://console.example.com', trusted)).toBe(false);
		expect(trustsOrigin('https://console.example.com:8443', trusted)).toBe(
			false,
		);
	});

	it("trusts one label in place of a wildcard site's *", () => {
		const trusted = ['https://*.example.com'];

		expect(trustsOrigin('https://acme.example.com', trusted)).toBe(true);
		expect(trustsOrigin('https://ACME.example.com', trusted)).toBe(true);
		// Not the domain itself, not two labels, not another domain.
		expect(trustsOrigin('https://example.com', trusted)).toBe(false);
		expect(trustsOrigin('https://a.b.example.com', trusted)).toBe(false);
		expect(trustsOrigin('https://acme.example.com.evil.io', trusted)).toBe(
			false,
		);
		expect(trustsOrigin('https://acmeexample.com', trusted)).toBe(false);
	});

	it('keeps the port of a local wildcard', () => {
		const trusted = ['https://*.shop.localhost:8443'];

		expect(trustsOrigin('https://acme.shop.localhost:8443', trusted)).toBe(
			true,
		);
		expect(trustsOrigin('https://acme.shop.localhost', trusted)).toBe(false);
	});

	it('trusts nothing for a bare *, or for no origin at all', () => {
		expect(trustsOrigin('https://acme.example.com', ['*'])).toBe(false);
		expect(trustsOrigin(undefined, ['https://*.example.com'])).toBe(false);
		expect(trustsOrigin('null', ['https://*.example.com'])).toBe(false);
	});
});

describe('wildcardDomainOf', () => {
	it('is the domain under a wildcard host, and nothing for any other', () => {
		expect(wildcardDomainOf('*.example.com')).toBe('example.com');
		expect(wildcardDomainOf('app.example.com')).toBeUndefined();
	});
});
