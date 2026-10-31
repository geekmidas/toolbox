import { describe, expect, it } from 'vitest';
import { inboxRecipient, receiptRecipients } from '../inbox';

const DOMAIN = 'fixwell.example';
const tenants = { addresses: ['requests'], subdomains: true } as const;
const single = { addresses: ['requests', 'billing'] } as const;

describe('inboxRecipient', () => {
	it("takes a tenant's address apart: its local part and its subdomain", () => {
		expect(
			inboxRecipient('requests@acme.fixwell.example', tenants, DOMAIN),
		).toEqual({
			address: 'requests@acme.fixwell.example',
			local: 'requests',
			subdomain: 'acme',
		});
	});

	it('hands the +tag of a plus-address over, and still matches the local part', () => {
		expect(
			inboxRecipient('Requests+T_8f3k2q@Acme.Fixwell.Example', tenants, DOMAIN),
		).toEqual({
			address: 'requests+t_8f3k2q@acme.fixwell.example',
			local: 'requests',
			tag: 't_8f3k2q',
			subdomain: 'acme',
		});
	});

	it('receives nothing at an address it does not declare', () => {
		expect(
			inboxRecipient('support@acme.fixwell.example', tenants, DOMAIN),
		).toBeUndefined();
		expect(
			inboxRecipient('requestsx@acme.fixwell.example', tenants, DOMAIN),
		).toBeUndefined();
	});

	it('with subdomains, takes exactly one label — never the bare domain, never two', () => {
		expect(inboxRecipient('requests@fixwell.example', tenants, DOMAIN)).toBe(
			undefined,
		);
		expect(
			inboxRecipient('requests@a.b.fixwell.example', tenants, DOMAIN),
		).toBeUndefined();
	});

	it('without subdomains, takes the domain itself and nothing under it', () => {
		expect(
			inboxRecipient('billing+inv_7@fixwell.example', single, DOMAIN),
		).toEqual({
			address: 'billing+inv_7@fixwell.example',
			local: 'billing',
			tag: 'inv_7',
		});
		expect(
			inboxRecipient('billing@acme.fixwell.example', single, DOMAIN),
		).toBeUndefined();
	});

	it('takes nothing on another domain, however similar', () => {
		expect(
			inboxRecipient('requests@acme.notfixwell.example', tenants, DOMAIN),
		).toBeUndefined();
		expect(
			inboxRecipient('requests@acme.fixwell.example.evil', tenants, DOMAIN),
		).toBeUndefined();
		expect(inboxRecipient('not-an-address', tenants, DOMAIN)).toBeUndefined();
	});
});

describe('receiptRecipients', () => {
	it('names every subdomain for a tenant inbox, and each address otherwise — SES matches its +tags', () => {
		expect(receiptRecipients(tenants, DOMAIN)).toEqual(['.fixwell.example']);
		expect(receiptRecipients(single, DOMAIN)).toEqual([
			'requests@fixwell.example',
			'billing@fixwell.example',
		]);
	});
});
