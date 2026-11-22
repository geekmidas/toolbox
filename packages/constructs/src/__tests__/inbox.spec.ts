import { describe, expect, it } from 'vitest';
import { Inbox, InboxSubdomainConflict, InboxSubdomainInvalid } from '../inbox';

describe('an Inbox on a fixed subdomain', () => {
	it('declares its label, lowercased, beside its addresses', () => {
		const inbound = new Inbox('Inbound', {
			addresses: ['pop', 'bills'],
			subdomain: 'In',
		});

		expect(inbound.declare()).toContainEqual(
			expect.objectContaining({
				kind: 'inbox',
				id: 'Inbound',
				addresses: ['pop', 'bills'],
				subdomain: 'in',
			}),
		);
	});

	it("is refused beside subdomains: true — one fixed label, or any tenant's", () => {
		expect(
			() =>
				new Inbox('Inbound', {
					addresses: ['pop'],
					subdomain: 'in',
					subdomains: true,
				}),
		).toThrow(InboxSubdomainConflict);
	});

	it.for([
		'in.mail',
		'-in',
		'in-',
		'',
		'in_box',
		'a'.repeat(64),
	])("refuses '%s', which is not one DNS label", (subdomain) => {
		expect(
			() => new Inbox('Inbound', { addresses: ['pop'], subdomain }),
		).toThrow(InboxSubdomainInvalid);
	});
});
