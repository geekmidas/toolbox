import { describe, expect } from 'vitest';
import { MAILPIT_SMTP_PORT, MAILPIT_URL } from '../../../../testkit/test/ports';
import { Inbox, type InboxMessage } from '../../inbox';
import { Worker } from '../../worker';
import { featureTest } from '../featureTest';
import type { TestManifest } from '../manifest';
import { NoInboxForAddress, ReceiveFieldsOrRaw } from '../receive';

/**
 * Mail arriving at an inbox in a feature test: delivered to the real Mailpit
 * with the envelope the test names, received by the receiver `gkm dev`'s
 * webhook calls, and handed to the inbox's subscriber — which reads the raw
 * message back from Mailpit and parses it as it does in production.
 */

const requests = new Inbox('Requests', {
	addresses: ['requests'],
	subdomains: true,
});
const worker = new Worker('Jobs');

const received: InboxMessage[] = [];
const onRequest = worker.inbox(requests).handle(async ({ messages }) => {
	received.push(...messages);
});

const source = (file: string, name: string) => ({ file, export: name });

const manifest: TestManifest = {
	stage: 'test',
	constructs: {
		Requests: { kind: 'inbox', source: source('constructs', 'requests') },
	},
	endpoints: [],
	subscribers: [{ source: source('subscribers', 'onRequest') }],
	env: {
		REQUESTS_URL: MAILPIT_URL,
		REQUESTS_DOMAIN: 'fixwell.test',
		REQUESTS_SMTP_URL: `smtp://localhost:${MAILPIT_SMTP_PORT}`,
	},
};

const it = featureTest({
	manifest,
	modules: {
		constructs: { requests },
		subscribers: { onRequest },
	},
});

describe('mailbox.receive', () => {
	it("hands a tenant's request to the inbox's subscriber, parsed, with what the envelope says", async ({
		mailbox,
	}) => {
		received.length = 0;
		const photo = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x7f]);

		await mailbox.receive({
			to: 'requests+t_8f3k2q@acme.fixwell.test',
			from: 'ada@resident.example',
			subject: 'Leaking tap',
			text: 'The kitchen tap drips.',
			html: '<p>The kitchen tap drips.</p>',
			attachments: [
				{ filename: 'tap.jpg', content: photo, contentType: 'image/jpeg' },
			],
		});

		expect(received).toHaveLength(1);
		const [message] = received;
		expect(message!.recipient).toEqual({
			address: 'requests+t_8f3k2q@acme.fixwell.test',
			local: 'requests',
			tag: 't_8f3k2q',
			subdomain: 'acme',
		});
		expect(message!.from).toEqual({ address: 'ada@resident.example' });
		expect(message!.subject).toBe('Leaking tap');
		expect(message!.text?.trim()).toBe('The kitchen tap drips.');
		expect(message!.html).toContain('drips');
		// Nothing judged it locally, and nothing pretends it did.
		expect(message!.verdicts).toEqual({
			spf: 'unavailable',
			dkim: 'unavailable',
			dmarc: 'unavailable',
			spam: 'unavailable',
			virus: 'unavailable',
		});
		expect(message!.raw.bucket).toBe('mailpit');
		// The attachment survives the round trip through Mailpit (#315).
		expect(message!.attachments).toHaveLength(1);
		expect(message!.attachments[0]).toMatchObject({
			filename: 'tap.jpg',
			contentType: 'image/jpeg',
			size: 5,
		});
		expect(await message!.attachments[0]!.content()).toEqual(photo);
	});

	it('routes on the envelope, never on the To: header the sender wrote', async ({
		mailbox,
	}) => {
		received.length = 0;

		await mailbox.receive({
			to: 'requests@acme.fixwell.test',
			headerTo: 'requests@globex.fixwell.test',
			from: 'anyone@elsewhere.example',
			subject: 'Not for Globex',
			text: 'hello',
		});

		expect(received.map((m) => m.recipient.subdomain)).toEqual(['acme']);
		expect(received[0]!.to).toEqual([
			{ address: 'requests@globex.fixwell.test' },
		]);
	});

	it('hands over the verdicts a test says the provider judged', async ({
		mailbox,
	}) => {
		received.length = 0;

		await mailbox.receive({
			to: 'requests@acme.fixwell.test',
			from: 'finance@globex.fixwell.test',
			subject: 'Invoice',
			text: 'pay me',
			verdicts: { dmarc: 'fail', spf: 'pass' },
		});

		expect(received[0]!.verdicts).toMatchObject({
			dmarc: 'fail',
			spf: 'pass',
			dkim: 'unavailable',
		});
	});

	it('receives a whole .eml, its From: as the envelope sender', async ({
		mailbox,
	}) => {
		received.length = 0;
		const eml = [
			'From: Bea <bea@resident.example>',
			'To: requests@acme.fixwell.test',
			'Subject: Re: Leaking tap',
			'X-Ticket: t_8f3k2q',
			'',
			'Still dripping.',
			'',
		].join('\r\n');

		await mailbox.receive({ to: 'requests@acme.fixwell.test', raw: eml });

		expect(received[0]!.from).toEqual({
			name: 'Bea',
			address: 'bea@resident.example',
		});
		expect(received[0]!.headers['x-ticket']).toEqual(['t_8f3k2q']);
	});

	it('refuses an address no inbox receives at, as the receipt rule would', async ({
		mailbox,
	}) => {
		const refused = mailbox.receive({
			to: 'support@acme.fixwell.test',
			from: 'ada@resident.example',
			text: 'hi',
		});

		await expect(refused).rejects.toBeInstanceOf(NoInboxForAddress);
	});

	it('refuses a raw message given with fields, and a built one with no sender', async ({
		mailbox,
	}) => {
		await expect(
			mailbox.receive({
				to: 'requests@acme.fixwell.test',
				raw: 'From: a@b.example\r\n\r\nx',
				subject: 'both',
			} as never),
		).rejects.toBeInstanceOf(ReceiveFieldsOrRaw);
		await expect(
			mailbox.receive({
				to: 'requests@acme.fixwell.test',
				text: 'no sender',
			} as never),
		).rejects.toBeInstanceOf(ReceiveFieldsOrRaw);
	});
});
