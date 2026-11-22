import { describe, expect, it } from 'vitest';
import { senderAddress, senderDomain } from '../email';

const DOMAIN = 'shop.example.com';

describe('senderAddress', () => {
	it.each([
		[{}, 'noreply@shop.example.com'],
		[{ from: 'info' }, 'info@shop.example.com'],
		[{ subdomain: 'mail' }, 'noreply@mail.shop.example.com'],
		[{ from: 'info', subdomain: 'mail' }, 'info@mail.shop.example.com'],
	])('%j sends as %s', (email, address) => {
		expect(senderAddress(email, DOMAIN)).toBe(address);
	});
});

describe('senderDomain', () => {
	it("is the stage's domain, or the construct's label in front of it", () => {
		expect([
			senderDomain({}, DOMAIN),
			senderDomain({ subdomain: 'mail' }, DOMAIN),
		]).toEqual(['shop.example.com', 'mail.shop.example.com']);
	});
});
