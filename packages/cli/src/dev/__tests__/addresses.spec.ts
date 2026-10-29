import { describe, expect, it } from 'vitest';
import { describeAddress, tenantUrl } from '../addresses';

describe('describeAddress', () => {
	it('prints the address an app is reached at and its local port', () => {
		expect(
			describeAddress(
				'https://api.shop.localhost:8443',
				'http://localhost:3000',
			),
		).toBe('https://api.shop.localhost:8443 -> http://localhost:3000');
	});

	it('prints only the local port for an app the edge does not serve', () => {
		expect(describeAddress(undefined, 'http://localhost:3000')).toBe(
			'http://localhost:3000',
		);
	});

	it('follows a wildcard site with an address a browser can open', () => {
		expect(
			describeAddress('https://*.shop.localhost:8443', 'http://localhost:3001'),
		).toBe(
			'https://*.shop.localhost:8443 -> http://localhost:3001 ' +
				'(open a tenant: https://acme.shop.localhost:8443)',
		);
	});
});

describe('tenantUrl', () => {
	it('puts the slug in place of the wildcard, keeping the stage and port', () => {
		expect(tenantUrl('https://*.test.shop.localhost:8443', 'globex')).toBe(
			'https://globex.test.shop.localhost:8443',
		);
		expect(tenantUrl('https://*.example.com', 'acme')).toBe(
			'https://acme.example.com',
		);
	});

	it('is nothing for an address that is not a wildcard', () => {
		expect(tenantUrl('https://api.shop.localhost', 'acme')).toBeUndefined();
	});
});
