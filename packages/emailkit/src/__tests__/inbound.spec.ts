import { describe, expect, it } from 'vitest';
import { composeEmail, parseEmail } from '../inbound';

describe('composeEmail and parseEmail', () => {
	it('round-trips a message: headers, both bodies and its attachments', async () => {
		const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10]);
		const raw = await composeEmail({
			from: '"Ada Resident" <ada@resident.example>',
			to: ['requests@acme.fixwell.example', 'Bea <bea@resident.example>'],
			cc: 'cc@resident.example',
			replyTo: 'ada.alt@resident.example',
			subject: 'Leaking tap — flat 4',
			text: 'The kitchen tap drips.',
			html: '<p>The kitchen tap <b>drips</b>.</p>',
			headers: {
				'Auto-Submitted': 'auto-replied',
				'In-Reply-To': '<t1@fixwell.example>',
				References: '<t0@fixwell.example> <t1@fixwell.example>',
			},
			attachments: [
				{ filename: 'photo.pdf', content: pdf, contentType: 'application/pdf' },
				{ filename: 'notes.txt', content: 'second floor' },
			],
		});

		const email = await parseEmail(raw);

		expect(email.from).toEqual({
			name: 'Ada Resident',
			address: 'ada@resident.example',
		});
		expect(email.to).toEqual([
			{ address: 'requests@acme.fixwell.example' },
			{ name: 'Bea', address: 'bea@resident.example' },
		]);
		expect(email.cc).toEqual([{ address: 'cc@resident.example' }]);
		expect(email.replyTo).toEqual([{ address: 'ada.alt@resident.example' }]);
		expect(email.subject).toBe('Leaking tap — flat 4');
		expect(email.text?.trim()).toBe('The kitchen tap drips.');
		expect(email.html).toContain('<b>drips</b>');
		expect(email.inReplyTo).toBe('<t1@fixwell.example>');
		expect(email.references).toEqual([
			'<t0@fixwell.example>',
			'<t1@fixwell.example>',
		]);
		expect(email.headers['auto-submitted']).toEqual(['auto-replied']);
		expect(email.messageId).toMatch(/^<.+>$/);

		expect(
			email.attachments.map(({ filename, contentType, size }) => ({
				filename,
				contentType,
				size,
			})),
		).toEqual([
			{ filename: 'photo.pdf', contentType: 'application/pdf', size: 7 },
			{ filename: 'notes.txt', contentType: 'text/plain', size: 12 },
		]);
		expect(await email.attachments[0]!.content()).toEqual(pdf);
		expect(
			new TextDecoder().decode(await email.attachments[1]!.content()),
		).toBe('second floor');
	});

	it('hands each read its own copy of an attachment', async () => {
		const email = await parseEmail(
			await composeEmail({
				from: 'a@example.com',
				attachments: [{ filename: 'a.bin', content: new Uint8Array([1, 2]) }],
			}),
		);
		const first = await email.attachments[0]!.content();
		first[0] = 9;

		expect(await email.attachments[0]!.content()).toEqual(
			new Uint8Array([1, 2]),
		);
	});
});
