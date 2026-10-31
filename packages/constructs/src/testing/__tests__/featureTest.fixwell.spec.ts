import { beforeEach, describe, expect } from 'vitest';
import { MAILPIT_SMTP_PORT, MAILPIT_URL } from '../../../../testkit/test/ports';
import { Inbox, type InboxMessage } from '../../inbox';
import { Worker } from '../../worker';
import { featureTest } from '../featureTest';
import type { TestManifest } from '../manifest';
import { NoInboxForAddress } from '../receive';

/**
 * The worked example in the "Receiving Email" guide, and its table as the test
 * suite: Fixwell, a made-up maintenance-request app for property-management
 * agencies. Each agency is a tenant with an inbox at
 * `requests@<agency>.fixwell.test`; a reply on a ticket goes to
 * `requests+<token>@<agency>.fixwell.test`. Initech Living is suspended.
 *
 * The handler routes on the envelope recipient alone, treats `From:` as a
 * claim until DMARC passes and the sender is known to that agency, and never
 * trusts a token from another agency.
 */

const agencies: Record<string, { suspended?: boolean; residents: string[] }> = {
	acme: { residents: ['ada@resident.example'] },
	globex: { residents: [] },
	initech: { suspended: true, residents: [] },
};

interface Ticket {
	agency: string;
	token: string;
	from: string;
	review?: 'unknown sender' | 'possible impersonation';
	thread: string[];
}

interface Outcome {
	kind: 'ticket' | 'threaded' | 'dropped' | 'ignored' | 'quarantined';
	agency?: string;
	reason?: string;
	ticket?: Ticket;
	attachments?: number;
}

const tickets: Ticket[] = [];
const outcomes: Outcome[] = [];

const requests = new Inbox('Requests', {
	addresses: ['requests'],
	subdomains: true,
});
const worker = new Worker('Jobs');

/** What Fixwell does with one message — the guide's handler. */
async function handle(message: InboxMessage): Promise<Outcome> {
	// The envelope says which agency. Never `To:`, never `From:`.
	const slug = message.recipient.subdomain;
	const agency = slug ? agencies[slug] : undefined;
	if (!slug || !agency) return { kind: 'dropped', reason: 'no such agency' };
	if (agency.suspended) {
		return { kind: 'dropped', agency: slug, reason: 'agency suspended' };
	}

	const auto = message.headers['auto-submitted']?.[0];
	if (auto && auto !== 'no') {
		return { kind: 'ignored', agency: slug, reason: `auto-submitted: ${auto}` };
	}

	// Kept, never opened: the raw message stays where the provider stored it.
	if (message.verdicts.virus === 'fail') {
		return { kind: 'quarantined', agency: slug, attachments: 0 };
	}

	// A token only threads within its own agency.
	const token = message.recipient.tag;
	const existing = token
		? tickets.find((t) => t.token === token && t.agency === slug)
		: undefined;
	if (existing) {
		existing.thread.push(message.subject ?? '');
		return { kind: 'threaded', agency: slug, ticket: existing };
	}

	const from = message.from?.address ?? '';
	const known = agency.residents.includes(from);
	const review = !known
		? 'unknown sender'
		: message.verdicts.dmarc !== 'pass'
			? 'possible impersonation'
			: undefined;
	const ticket: Ticket = {
		agency: slug,
		token: `t_${tickets.length + 1}`,
		from,
		...(review ? { review } : {}),
		thread: [message.subject ?? ''],
	};
	tickets.push(ticket);
	return {
		kind: 'ticket',
		agency: slug,
		ticket,
		attachments: message.attachments.length,
	};
}

const onRequest = worker.inbox(requests).handle(async ({ messages }) => {
	for (const message of messages) outcomes.push(await handle(message));
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
	modules: { constructs: { requests }, subscribers: { onRequest } },
});

const ADA = 'ada@resident.example';
const pass = { dmarc: 'pass' } as const;

/** The one outcome the last message produced. */
const last = () => outcomes.at(-1);

beforeEach(() => {
	tickets.length = 0;
	outcomes.length = 0;
	// An open Acme ticket, as the earlier exchange left it.
	tickets.push({
		agency: 'acme',
		token: 't_8f3k2q',
		from: ADA,
		thread: ['Leaking tap'],
	});
});

describe('Fixwell', () => {
	it('1. a resident writes to their agency: a new ticket, attributed to them', async ({
		mailbox,
	}) => {
		await mailbox.receive({
			to: 'requests@acme.fixwell.test',
			from: ADA,
			subject: 'Broken heater',
			text: 'No heat since Monday.',
			verdicts: pass,
		});

		expect(last()).toMatchObject({
			kind: 'ticket',
			agency: 'acme',
			ticket: { from: ADA },
		});
		expect(last()!.ticket!.review).toBeUndefined();
	});

	it('2. a reply to a ticket token: threaded onto that ticket', async ({
		mailbox,
	}) => {
		await mailbox.receive({
			to: 'requests+t_8f3k2q@acme.fixwell.test',
			from: ADA,
			subject: 'Re: Leaking tap',
			text: 'Still dripping.',
			verdicts: pass,
		});

		expect(last()).toMatchObject({ kind: 'threaded', agency: 'acme' });
		expect(last()!.ticket!.thread).toEqual(['Leaking tap', 'Re: Leaking tap']);
	});

	it('3. an unknown sender: a new ticket, needs review', async ({
		mailbox,
	}) => {
		await mailbox.receive({
			to: 'requests@acme.fixwell.test',
			from: 'stranger@elsewhere.example',
			subject: 'Hello',
			text: 'hi',
			verdicts: pass,
		});

		expect(last()!.ticket!.review).toBe('unknown sender');
	});

	it('4. a resident whose DMARC fails: needs review, possible impersonation', async ({
		mailbox,
	}) => {
		await mailbox.receive({
			to: 'requests@acme.fixwell.test',
			from: ADA,
			subject: 'Change my bank details',
			text: '…',
			verdicts: { dmarc: 'fail' },
		});

		expect(last()!.ticket!.review).toBe('possible impersonation');
	});

	it("5. another agency's address in From:, DMARC failing: stays in Acme, never routed to Globex", async ({
		mailbox,
	}) => {
		await mailbox.receive({
			to: 'requests@acme.fixwell.test',
			from: 'finance@globex.fixwell.test',
			subject: 'Invoice',
			text: 'pay',
			verdicts: { dmarc: 'fail' },
		});

		expect(last()).toMatchObject({ kind: 'ticket', agency: 'acme' });
		expect(last()!.ticket!.review).toBe('unknown sender');
	});

	it('6. a To: header naming Globex: Acme, because the envelope says Acme', async ({
		mailbox,
	}) => {
		await mailbox.receive({
			to: 'requests@acme.fixwell.test',
			headerTo: 'requests@globex.fixwell.test',
			from: 'anyone@elsewhere.example',
			subject: 'Misdirected?',
			text: '…',
		});

		expect(last()).toMatchObject({ kind: 'ticket', agency: 'acme' });
	});

	it('7. sent by BCC — no header names the inbox: Acme, the envelope still knows', async ({
		mailbox,
	}) => {
		await mailbox.receive({
			to: 'requests@acme.fixwell.test',
			headerTo: 'neighbours@resident.example',
			from: ADA,
			subject: 'FYI: lift out of order',
			text: '…',
			verdicts: pass,
		});

		expect(last()).toMatchObject({
			kind: 'ticket',
			agency: 'acme',
			ticket: { from: ADA },
		});
	});

	it('8. an Acme token sent to Globex: not found there, a new Globex ticket', async ({
		mailbox,
	}) => {
		await mailbox.receive({
			to: 'requests+t_8f3k2q@globex.fixwell.test',
			from: 'anyone@elsewhere.example',
			subject: 'Re: Leaking tap',
			text: '…',
		});

		expect(last()).toMatchObject({ kind: 'ticket', agency: 'globex' });
		expect(tickets.find((t) => t.token === 't_8f3k2q')!.thread).toEqual([
			'Leaking tap',
		]);
	});

	it('9. a suspended agency: dropped', async ({ mailbox }) => {
		await mailbox.receive({
			to: 'requests@initech.fixwell.test',
			from: 'anyone@elsewhere.example',
			text: '…',
		});

		expect(last()).toEqual({
			kind: 'dropped',
			agency: 'initech',
			reason: 'agency suspended',
		});
	});

	it('10. no such agency: dropped', async ({ mailbox }) => {
		await mailbox.receive({
			to: 'requests@unknown.fixwell.test',
			from: 'anyone@elsewhere.example',
			text: '…',
		});

		expect(last()).toEqual({ kind: 'dropped', reason: 'no such agency' });
	});

	it('11. an out-of-office reply: ignored', async ({ mailbox }) => {
		await mailbox.receive({
			to: 'requests@acme.fixwell.test',
			from: ADA,
			subject: 'Out of office',
			text: 'Away until Monday.',
			headers: { 'Auto-Submitted': 'auto-replied' },
			verdicts: pass,
		});

		expect(last()).toMatchObject({ kind: 'ignored', agency: 'acme' });
		expect(tickets).toHaveLength(1);
	});

	it('12. a virus: quarantined, the raw message kept and no attachment stored', async ({
		mailbox,
	}) => {
		await mailbox.receive({
			to: 'requests@acme.fixwell.test',
			from: 'anyone@elsewhere.example',
			subject: 'Invoice',
			text: '…',
			attachments: [{ filename: 'invoice.pdf.exe', content: 'MZ' }],
			verdicts: { virus: 'fail' },
		});

		expect(last()).toEqual({
			kind: 'quarantined',
			agency: 'acme',
			attachments: 0,
		});
	});

	it('13. an address no inbox declares: never received', async ({
		mailbox,
	}) => {
		await expect(
			mailbox.receive({
				to: 'support@acme.fixwell.test',
				from: ADA,
				text: '…',
			}),
		).rejects.toBeInstanceOf(NoInboxForAddress);
		expect(outcomes).toEqual([]);
	});
});
