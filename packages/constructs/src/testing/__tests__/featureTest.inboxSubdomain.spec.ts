import { describe, expect } from 'vitest';
import { MAILPIT_SMTP_PORT, MAILPIT_URL } from '../../../../testkit/test/ports';
import { Inbox, type InboxMessage } from '../../inbox';
import { Worker } from '../../worker';
import { featureTest } from '../featureTest';
import type { TestManifest } from '../manifest';
import { NoInboxForAddress } from '../receive';

/**
 * An inbox on a fixed subdomain receives at `<address>@in.<domain>` — the
 * domain `gkm test` resolves its `<ID>_DOMAIN` to — and nothing at the apex,
 * whose mail is the team's own.
 */

const inbound = new Inbox('Inbound', {
	addresses: ['bills'],
	subdomain: 'in',
});
const worker = new Worker('Jobs');

const received: InboxMessage[] = [];
const onBill = worker.inbox(inbound).handle(async ({ messages }) => {
	received.push(...messages);
});

const source = (file: string, name: string) => ({ file, export: name });

const manifest: TestManifest = {
	stage: 'test',
	constructs: {
		Inbound: { kind: 'inbox', source: source('constructs', 'inbound') },
	},
	endpoints: [],
	subscribers: [{ source: source('subscribers', 'onBill') }],
	env: {
		INBOUND_URL: MAILPIT_URL,
		INBOUND_DOMAIN: 'in.fixwell.test',
		INBOUND_SMTP_URL: `smtp://localhost:${MAILPIT_SMTP_PORT}`,
	},
};

const it = featureTest({
	manifest,
	modules: { constructs: { inbound }, subscribers: { onBill } },
});

describe('mailbox.receive, at a fixed subdomain', () => {
	it('hands mail at the label to the subscriber', async ({ mailbox }) => {
		received.length = 0;

		await mailbox.receive({
			to: 'bills+march@in.fixwell.test',
			from: 'accounts@supplier.example',
			subject: 'Invoice',
			text: 'Attached.',
		});

		expect(received.map((m) => m.recipient)).toEqual([
			{ address: 'bills+march@in.fixwell.test', local: 'bills', tag: 'march' },
		]);
	});

	it("takes nothing at the apex, whose mail is the team's own", async ({
		mailbox,
	}) => {
		await expect(
			mailbox.receive({
				to: 'bills@fixwell.test',
				from: 'accounts@supplier.example',
				text: 'Wrong door.',
			}),
		).rejects.toBeInstanceOf(NoInboxForAddress);
	});
});
