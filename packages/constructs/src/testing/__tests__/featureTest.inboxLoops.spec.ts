import { describe, expect } from 'vitest';
import { MAILPIT_SMTP_PORT, MAILPIT_URL } from '../../../../testkit/test/ports';
import { Email } from '../../email';
import { Inbox, type InboxMessage } from '../../inbox';
import { Worker } from '../../worker';
import { featureTest } from '../featureTest';
import type { TestManifest } from '../manifest';

/**
 * Reply loops (#345): an inbox handler that answers `From:` would answer its
 * own reply, or someone's out-of-office, forever. Its replies are marked
 * `Auto-Submitted: auto-replied`, and marked mail never reaches a handler —
 * unless it asks for it with `.automated()`.
 */

const requests = new Inbox('Requests', {
	addresses: ['requests'],
	subdomains: true,
});
const replies = new Email('Replies', { templates: {} });
const worker = new Worker('Jobs');

const handled: InboxMessage[] = [];
const onRequest = worker
	.inbox(requests)
	.dependsOn([replies])
	.handle(async ({ messages, services }) => {
		for (const message of messages) {
			handled.push(message);
			// Answers whoever `From:` claims to be — the mistake a loop needs.
			await services.replies.send({
				from: message.recipient.address,
				to: message.from!.address,
				subject: `Re: ${message.subject ?? ''}`,
				text: 'We got your request.',
			});
		}
	});

const automated: InboxMessage[] = [];
const onAutomated = worker
	.inbox(requests)
	.automated()
	.handle(async ({ messages }) => {
		automated.push(...messages);
	});

const source = (file: string, name: string) => ({ file, export: name });
const env = {
	REQUESTS_URL: MAILPIT_URL,
	REQUESTS_DOMAIN: 'fixwell.test',
	REQUESTS_SMTP_URL: `smtp://localhost:${MAILPIT_SMTP_PORT}`,
	REPLIES_URL: `smtp://localhost:${MAILPIT_SMTP_PORT}`,
	REPLIES_FROM: 'noreply@fixwell.test',
	REPLIES_INBOX_URL: MAILPIT_URL,
};

const manifest = (subscriber: string): TestManifest => ({
	stage: 'test',
	constructs: {
		Requests: { kind: 'inbox', source: source('constructs', 'requests') },
		Replies: { kind: 'email', source: source('constructs', 'replies') },
	},
	endpoints: [],
	subscribers: [{ source: source('subscribers', subscriber) }],
	env,
});

const modules = {
	constructs: { requests, replies },
	subscribers: { onRequest, onAutomated },
};

const it = featureTest({ manifest: manifest('onRequest'), modules });
const itAutomated = featureTest({ manifest: manifest('onAutomated'), modules });

describe('inbox reply loops', () => {
	it('a forged From: naming another inbox ends after one reply', async ({
		mailbox,
	}) => {
		handled.length = 0;
		await mailbox('requests@globex.fixwell.test').clear();

		await mailbox.receive({
			to: 'requests@acme.fixwell.test',
			from: 'requests@globex.fixwell.test',
			subject: 'Invoice',
			text: 'pay',
		});
		const reply = await mailbox('requests@globex.fixwell.test').last();
		expect(reply.headers['auto-submitted']).toEqual(['auto-replied']);

		// The reply arrives at Globex's inbox, as SES would deliver it.
		await mailbox.receive({
			to: 'requests@globex.fixwell.test',
			from: reply.from,
			subject: reply.subject,
			text: reply.text,
			headers: { 'Auto-Submitted': 'auto-replied' },
		});

		expect(handled.map((m) => m.recipient.subdomain)).toEqual(['acme']);
	});

	it("someone's out-of-office never reaches the handler", async ({
		mailbox,
	}) => {
		handled.length = 0;

		await mailbox.receive({
			to: 'requests+t_1@acme.fixwell.test',
			from: 'ada@resident.example',
			subject: 'Out of office',
			text: 'Away until Monday.',
			headers: { 'Auto-Submitted': 'auto-replied' },
		});

		expect(handled).toEqual([]);
	});

	it('mail marked `Auto-Submitted: no` is a person writing, and is handled', async ({
		mailbox,
	}) => {
		handled.length = 0;

		await mailbox.receive({
			to: 'requests@acme.fixwell.test',
			from: 'ada@resident.example',
			subject: 'Broken heater',
			text: '…',
			headers: { 'Auto-Submitted': 'no' },
		});

		expect(handled).toHaveLength(1);
	});

	itAutomated(
		'`.automated()` hands the handler that mail',
		async ({ mailbox }) => {
			automated.length = 0;

			await mailbox.receive({
				to: 'requests@acme.fixwell.test',
				from: 'ada@resident.example',
				subject: 'Out of office',
				text: 'Away until Monday.',
				headers: { 'Auto-Submitted': 'auto-replied' },
			});

			expect(automated).toHaveLength(1);
			expect(automated[0]!.headers['auto-submitted']).toEqual(['auto-replied']);
		},
	);
});
