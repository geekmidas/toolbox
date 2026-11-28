import { randomBytes, randomUUID } from 'node:crypto';
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { EnvironmentParser } from '@geekmidas/envkit';
import { providedKeyFor } from '@geekmidas/manifest';
import { serviceContext } from '@geekmidas/services';
import pg from 'pg';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from 'vitest';
import { z } from 'zod/v4';
// The receiver's side, from source: the client package depends on this one,
// so this one can't depend on it back.
import {
	verifyWebhook,
	WebhookSignatureInvalid,
	WebhookTimestampOutOfRange,
} from '../../../../client/src/webhooks';
import { TEST_DATABASE_CONFIG } from '../../../../testkit/test/globalSetup';
import { Cron } from '../../crons/Cron';
import { KyselyDatabase } from '../../database/kysely';
import { Encryption } from '../../encryption';
import { RestApi } from '../../rest-api';
import { Subscriber } from '../../subscribers/Subscriber';
import { Topic } from '../../topic/Topic';
import { Worker } from '../../worker';
import {
	defaultTransport,
	deliverEvent,
	GONE_REASON,
	sweepDue,
	WEBHOOK_MAX_ATTEMPTS,
	WEBHOOK_RETRY_SCHEDULE_MS,
	WEBHOOK_TABLES_SQL,
	WebhookAddressRefused,
	WebhookDeliveryNotFound,
	type WebhookDeps,
	type WebhookLifecycleMessage,
	WebhookRequestTimedOut,
	type Webhooks,
	type WebhookTransport,
	webhooksClient,
	webhookTransport,
} from '../index';

/**
 * Delivering: fan-out, signing, the schedule, what a receiver's answer does to
 * a delivery and its subscription, and the lifecycle events — against a real
 * Postgres tenant and a real keyring. The network is a transport that records
 * what it is handed and answers per URL, except where the real one runs
 * against a server on this machine.
 */

const schema = `whd_${randomUUID().slice(0, 8)}`;
const { host, port, user, password, database } = TEST_DATABASE_CONFIG;
const url = `postgres://${user}:${password}@${host}:${port}/${database}?search_path=${schema}`;
const key = () => randomBytes(32).toString('base64url');

const billing = new Topic('Billing', {
	events: {
		'invoice.paid': z.object({ invoiceId: z.string() }),
		'invoice.voided': z.object({ invoiceId: z.string() }),
		'invoice.drafted': z.object({ invoiceId: z.string() }),
	},
});
const appDb = new KyselyDatabase('AppDb');
const tenant = appDb.schema('BillingHooksDb');
const pii = new Encryption('Pii');

const options = {
	topic: billing,
	events: ['invoice.paid', 'invoice.voided'] as const,
	database: tenant,
	encryption: pii,
};

/**
 * The construct, on an API of its own: an API refuses a second construct
 * delivering the events its first already does.
 */
const build = (extra: { disableAfter?: number } = {}) =>
	new RestApi('Api', { path: '.', defaultAuthorizer: 'none' }).webhooks(
		'BillingHooks',
		{ ...options, ...extra },
	);

const envParser = new EnvironmentParser({
	[providedKeyFor(tenant.id, 'database-schema', 'url')]: url,
	[providedKeyFor(tenant.id, 'database-schema', 'ownerUrl')]: url,
	[providedKeyFor(pii.id, 'encryption', 'url')]:
		`aes256gcm://local?keys=k1.${key()}&index=${key()}`,
});
const register = { envParser, context: serviceContext };

const raw = new pg.Pool({ connectionString: url.replace(/\?.*$/, '') });
const rows = async <T = any>(query: string, values: unknown[] = []) =>
	(await raw.query(
		`SET search_path TO ${schema}; ${query}`,
		values,
	)) as never as {
		rows: T[];
	};
const select = async <T = any>(query: string, values: unknown[] = []) => {
	const result = (await raw.query({
		text: query.replaceAll('{s}', schema),
		values,
	})) as { rows: T[] };
	return result.rows;
};

/** A transport that records each request and answers by URL. */
function receiver(
	answers: Record<string, number | number[] | Error> = {},
): WebhookTransport & { received: Request[] } {
	const received: Request[] = [];
	const counts = new Map<string, number>();
	const transport = (async (request: Request) => {
		received.push(request.clone());
		const n = counts.get(request.url) ?? 0;
		counts.set(request.url, n + 1);
		const answer = answers[request.url] ?? 200;
		if (answer instanceof Error) throw answer;
		const status = Array.isArray(answer)
			? (answer[Math.min(n, answer.length - 1)] as number)
			: answer;
		return new Response(null, { status });
	}) as WebhookTransport & { received: Request[] };
	transport.received = received;
	return transport;
}

/** A publisher that records the lifecycle events, in order. */
function recorder() {
	const published: WebhookLifecycleMessage[] = [];
	return {
		published,
		publish: async (messages: WebhookLifecycleMessage[]) => {
			published.push(...messages);
		},
		types: () => published.map((m) => m.type),
	};
}

let hooks: Webhooks<'BillingHooks', any, 'invoice.paid' | 'invoice.voided'>;
let deps: WebhookDeps;
let events: ReturnType<typeof recorder>;
let time: Date;
const advance = (ms: number) => {
	time = new Date(time.getTime() + ms);
};

const client = () =>
	webhooksClient<'invoice.paid' | 'invoice.voided'>(hooks, deps);

beforeAll(async () => {
	await raw.query(`CREATE SCHEMA ${schema}`);
	await rows(WEBHOOK_TABLES_SQL);
});
afterAll(async () => {
	await raw.query(`DROP SCHEMA ${schema} CASCADE`);
	await raw.end();
});

beforeEach(async () => {
	await rows(
		'TRUNCATE webhook_attempts, webhook_deliveries, webhook_subscriptions',
	);
	hooks = build();
	time = new Date('2026-11-28T12:00:00.000Z');
	hooks.clock = () => time;
	events = recorder();
	deps = { ...(await hooks.connect(register)), publisher: events };
});

describe('fan-out', () => {
	it('delivers to the active subscriptions that want the event, and no other', async () => {
		const transport = receiver();
		hooks.transport = transport;
		const paid = await client().subscribe({
			owner: 'acct_1',
			url: 'https://paid.example/hooks',
			events: ['invoice.paid'],
		});
		await client().subscribe({
			owner: 'acct_1',
			url: 'https://voided.example/hooks',
			events: ['invoice.voided'],
		});
		const off = await client().subscribe({
			owner: 'acct_2',
			url: 'https://off.example/hooks',
			events: ['invoice.paid'],
		});
		await client().disable(off.subscription.id, 'paused');

		const outcomes = await deliverEvent(hooks, deps, {
			type: 'invoice.paid',
			payload: { invoiceId: 'inv_1' },
		});

		expect(transport.received.map((r) => r.url)).toEqual([
			'https://paid.example/hooks',
		]);
		expect(outcomes).toMatchObject([
			{
				subscriptionId: paid.subscription.id,
				attempt: 1,
				status: 200,
				deliveryStatus: 'delivered',
			},
		]);
	});

	it('fans an event out once, however often the topic delivers it', async () => {
		const transport = receiver();
		hooks.transport = transport;
		await client().subscribe({
			owner: 'acct_1',
			url: 'https://paid.example/hooks',
			events: ['invoice.paid'],
		});
		const event = { type: 'invoice.paid', payload: { invoiceId: 'inv_2' } };

		await deliverEvent(hooks, deps, event);
		// The broker redelivers it, its keys in another order.
		advance(1000);
		expect(
			await deliverEvent(hooks, deps, {
				payload: { invoiceId: 'inv_2' },
				type: 'invoice.paid',
			}),
		).toEqual([]);

		expect(transport.received).toHaveLength(1);
		expect(
			await select('SELECT count(*)::int AS n FROM {s}.webhook_deliveries'),
		).toEqual([{ n: 1 }]);
	});

	it('sends nothing for an event the construct does not deliver', async () => {
		const transport = receiver();
		hooks.transport = transport;
		await client().subscribe({
			owner: 'acct_1',
			url: 'https://paid.example/hooks',
			events: ['invoice.paid'],
		});

		expect(
			await deliverEvent(hooks, deps, {
				type: 'invoice.drafted',
				payload: { invoiceId: 'inv_3' },
			}),
		).toEqual([]);
		expect(transport.received).toHaveLength(0);
	});
});

describe('signing', () => {
	it('signs each delivery so verifyWebhook accepts it and returns the event', async () => {
		const transport = receiver();
		hooks.transport = transport;
		const { secret } = await client().subscribe({
			owner: 'acct_1',
			url: 'https://paid.example/hooks',
			events: ['invoice.paid'],
		});

		await deliverEvent(hooks, deps, {
			type: 'invoice.paid',
			payload: { invoiceId: 'inv_1' },
		});

		const [request] = transport.received as [Request];
		const [delivery] = await client().deliveries({ owner: 'acct_1' });
		expect(request.method).toBe('POST');
		expect(request.headers.get('content-type')).toBe('application/json');
		expect(request.headers.get('webhook-id')).toBe(delivery?.id);
		expect(request.headers.get('webhook-timestamp')).toBe(
			String(time.getTime() / 1000),
		);

		expect(await verifyWebhook(secret, request, { now: time })).toEqual({
			id: delivery?.eventId,
			type: 'invoice.paid',
			occurredAt: '2026-11-28T12:00:00.000Z',
			payload: { invoiceId: 'inv_1' },
		});
	});

	it('signs with both secrets while a rotation overlaps', async () => {
		const transport = receiver();
		hooks.transport = transport;
		const { subscription, secret: old } = await client().subscribe({
			owner: 'acct_1',
			url: 'https://paid.example/hooks',
			events: ['invoice.paid'],
		});
		const { secret: rotated } = await client().rotateSecret(subscription.id, {
			overlapMs: 60_000,
		});

		await deliverEvent(hooks, deps, {
			type: 'invoice.paid',
			payload: { invoiceId: 'inv_1' },
		});
		const [during] = transport.received as [Request];
		expect(during.headers.get('webhook-signature')?.split(' ')).toHaveLength(2);
		await expect(
			verifyWebhook(old, during.clone(), { now: time }),
		).resolves.toMatchObject({ type: 'invoice.paid' });
		await expect(
			verifyWebhook(rotated, during.clone(), { now: time }),
		).resolves.toMatchObject({ type: 'invoice.paid' });

		// Past the overlap, only the new secret signs.
		advance(61_000);
		await deliverEvent(hooks, deps, {
			type: 'invoice.paid',
			payload: { invoiceId: 'inv_2' },
		});
		const after = transport.received[1] as Request;
		expect(after.headers.get('webhook-signature')?.split(' ')).toHaveLength(1);
		await expect(
			verifyWebhook(old, after.clone(), { now: time }),
		).rejects.toBeInstanceOf(WebhookSignatureInvalid);
		await expect(
			verifyWebhook(rotated, after.clone(), { now: time }),
		).resolves.toMatchObject({ payload: { invoiceId: 'inv_2' } });
	});

	it('is refused tampered with, or replayed late', async () => {
		const transport = receiver();
		hooks.transport = transport;
		const { secret } = await client().subscribe({
			owner: 'acct_1',
			url: 'https://paid.example/hooks',
			events: ['invoice.paid'],
		});
		await deliverEvent(hooks, deps, {
			type: 'invoice.paid',
			payload: { invoiceId: 'inv_1' },
		});
		const [request] = transport.received as [Request];
		const body = await request.clone().text();

		const tampered = new Request(request.url, {
			method: 'POST',
			headers: request.headers,
			body: body.replace('inv_1', 'inv_9'),
		});
		await expect(
			verifyWebhook(secret, tampered, { now: time }),
		).rejects.toBeInstanceOf(WebhookSignatureInvalid);

		await expect(
			verifyWebhook(secret, request.clone(), {
				now: new Date(time.getTime() + 301_000),
			}),
		).rejects.toBeInstanceOf(WebhookTimestampOutOfRange);
	});
});

describe('retries', () => {
	it('follows the schedule from the clock, then abandons the delivery', async () => {
		hooks.transport = receiver({ 'https://down.example/hooks': 500 });
		const { subscription } = await client().subscribe({
			owner: 'acct_1',
			url: 'https://down.example/hooks',
			events: ['invoice.paid'],
		});

		await deliverEvent(hooks, deps, {
			type: 'invoice.paid',
			payload: { invoiceId: 'inv_1' },
		});

		for (const delay of WEBHOOK_RETRY_SCHEDULE_MS) {
			const [pending] = await client().deliveries({ owner: 'acct_1' });
			expect(pending).toMatchObject({ status: 'pending', lastStatus: 500 });
			expect(pending?.nextAttemptAt).toEqual(new Date(time.getTime() + delay));

			// Not before it is due.
			advance(delay - 1000);
			expect(await sweepDue(hooks, deps)).toEqual([]);
			advance(1000);
			expect(await sweepDue(hooks, deps)).toHaveLength(1);
		}

		const [abandoned] = await client().deliveries({ owner: 'acct_1' });
		expect(abandoned).toMatchObject({
			status: 'abandoned',
			attempts: WEBHOOK_MAX_ATTEMPTS,
			nextAttemptAt: null,
			lastStatus: 500,
			lastError: 'answered 500',
		});
		expect(abandoned?.history).toHaveLength(8);
		expect(abandoned?.history.every((a) => a.status === 500)).toBe(true);

		// Abandoned is final: a later sweep sends nothing.
		advance(24 * 3_600_000);
		expect(await sweepDue(hooks, deps)).toEqual([]);

		expect(events.types()).toEqual([
			...Array(8).fill('delivery.failed'),
			'delivery.abandoned',
		]);
		expect(events.published.at(-2)?.payload).toMatchObject({
			attempt: 8,
			nextAttemptAt: null,
		});
		expect(
			await select(
				'SELECT consecutive_failures FROM {s}.webhook_subscriptions WHERE id = $1',
				[subscription.id],
			),
		).toEqual([{ consecutive_failures: 1 }]);
	});

	it('delivers on a later attempt, and resets the subscription’s failures', async () => {
		const transport = receiver({ 'https://flaky.example/hooks': [500, 200] });
		hooks.transport = transport;
		const { secret, subscription } = await client().subscribe({
			owner: 'acct_1',
			url: 'https://flaky.example/hooks',
			events: ['invoice.paid'],
		});
		await select(
			'UPDATE {s}.webhook_subscriptions SET consecutive_failures = 3 WHERE id = $1',
			[subscription.id],
		);

		await deliverEvent(hooks, deps, {
			type: 'invoice.paid',
			payload: { invoiceId: 'inv_1' },
		});
		advance(60_000);
		await sweepDue(hooks, deps);

		const [delivered] = await client().deliveries({ owner: 'acct_1' });
		expect(delivered).toMatchObject({
			status: 'delivered',
			attempts: 2,
			deliveredAt: time,
			lastStatus: 200,
			lastError: null,
		});
		// The same delivery, under the same id, signed afresh.
		const [first, second] = transport.received as [Request, Request];
		expect(second.headers.get('webhook-id')).toBe(
			first.headers.get('webhook-id'),
		);
		await expect(
			verifyWebhook(secret, second, { now: time }),
		).resolves.toMatchObject({ type: 'invoice.paid' });

		expect(events.types()).toEqual(['delivery.failed', 'delivery.succeeded']);
		expect(
			await select(
				'SELECT consecutive_failures FROM {s}.webhook_subscriptions WHERE id = $1',
				[subscription.id],
			),
		).toEqual([{ consecutive_failures: 0 }]);
	});

	it('treats a timeout, a refused address and a redirect as failed attempts', async () => {
		hooks.transport = receiver({
			'https://slow.example/hooks': new WebhookRequestTimedOut(
				'https://slow.example/hooks',
				10_000,
			),
			'https://moved.example/hooks': 302,
		});
		await client().subscribe({
			owner: 'acct_1',
			url: 'https://slow.example/hooks',
			events: ['invoice.paid'],
		});
		await client().subscribe({
			owner: 'acct_1',
			url: 'https://moved.example/hooks',
			events: ['invoice.paid'],
		});

		const outcomes = await deliverEvent(hooks, deps, {
			type: 'invoice.paid',
			payload: { invoiceId: 'inv_1' },
		});

		expect(
			outcomes.map(({ status, deliveryStatus }) => ({
				status,
				deliveryStatus,
			})),
		).toEqual(
			expect.arrayContaining([
				{ status: null, deliveryStatus: 'pending' },
				{ status: 302, deliveryStatus: 'pending' },
			]),
		);
		const errors = outcomes.map((o) => o.error);
		expect(errors).toEqual(
			expect.arrayContaining([
				expect.stringContaining('did not answer within 10000ms'),
				expect.stringContaining('redirects are not followed'),
			]),
		);
	});

	it('leaves a delivery claimed by one sweep to that sweep', async () => {
		// The first sweep's request hangs until released.
		let release: () => void = () => {};
		const hung = new Promise<void>((resolve) => {
			release = resolve;
		});
		const calls: string[] = [];
		hooks.transport = receiver({ 'https://slow.example/hooks': 500 });
		await client().subscribe({
			owner: 'acct_1',
			url: 'https://slow.example/hooks',
			events: ['invoice.paid'],
		});
		await deliverEvent(hooks, deps, {
			type: 'invoice.paid',
			payload: { invoiceId: 'inv_1' },
		});
		advance(60_000);

		hooks.transport = async (request) => {
			calls.push(request.url);
			await hung;
			return new Response(null, { status: 200 });
		};
		const first = sweepDue(hooks, deps);
		// Until the claim is visible.
		while (calls.length === 0) await new Promise((r) => setTimeout(r, 5));

		// A second sweep, even a minute on, finds it leased.
		advance(60_000);
		expect(await sweepDue(hooks, deps)).toEqual([]);

		release();
		expect(await first).toMatchObject([{ deliveryStatus: 'delivered' }]);
		expect(calls).toHaveLength(1);
	});
});

describe('what a receiver’s answer does to its subscription', () => {
	it('disables a subscription whose receiver answers 410, and abandons the delivery', async () => {
		const transport = receiver({ 'https://gone.example/hooks': 410 });
		hooks.transport = transport;
		const { subscription } = await client().subscribe({
			owner: 'acct_1',
			url: 'https://gone.example/hooks',
			events: ['invoice.paid'],
		});

		await deliverEvent(hooks, deps, {
			type: 'invoice.paid',
			payload: { invoiceId: 'inv_1' },
		});

		expect(await client().get(subscription.id)).toMatchObject({
			status: 'disabled',
			disabledReason: GONE_REASON,
		});
		expect(await client().deliveries({ owner: 'acct_1' })).toMatchObject([
			{ status: 'abandoned', attempts: 1, lastStatus: 410 },
		]);
		expect(events.types()).toEqual([
			'delivery.failed',
			'delivery.abandoned',
			'subscription.disabled',
		]);
		expect(events.published[2]?.payload).toEqual({
			subscriptionId: subscription.id,
			owner: 'acct_1',
			reason: 'gone',
		});

		// Nothing more is sent to it.
		await deliverEvent(hooks, deps, {
			type: 'invoice.paid',
			payload: { invoiceId: 'inv_2' },
		});
		expect(transport.received).toHaveLength(1);
	});

	it('disables a subscription after its threshold of abandoned deliveries in a row', async () => {
		hooks = build({ disableAfter: 2 });
		hooks.clock = () => time;
		hooks.transport = receiver({ 'https://down.example/hooks': 503 });
		const { subscription } = await client().subscribe({
			owner: 'acct_1',
			url: 'https://down.example/hooks',
			events: ['invoice.paid'],
		});

		const exhaust = async (invoiceId: string) => {
			await deliverEvent(hooks, deps, {
				type: 'invoice.paid',
				payload: { invoiceId },
			});
			for (const delay of WEBHOOK_RETRY_SCHEDULE_MS) {
				advance(delay);
				await sweepDue(hooks, deps);
			}
		};

		await exhaust('inv_1');
		expect(await client().get(subscription.id)).toMatchObject({
			status: 'active',
		});

		await exhaust('inv_2');
		expect(await client().get(subscription.id)).toMatchObject({
			status: 'disabled',
			disabledReason: '2 deliveries in a row were abandoned',
		});
		expect(events.types().filter((t) => t !== 'delivery.failed')).toEqual([
			'delivery.abandoned',
			'delivery.abandoned',
			'subscription.disabled',
		]);
	});
});

describe('redelivery', () => {
	it('sends a delivery again under the same webhook-id, as a new attempt, whatever its status', async () => {
		const transport = receiver({ 'https://paid.example/hooks': [200, 200] });
		hooks.transport = transport;
		const { secret } = await client().subscribe({
			owner: 'acct_1',
			url: 'https://paid.example/hooks',
			events: ['invoice.paid'],
		});
		const [outcome] = await deliverEvent(hooks, deps, {
			type: 'invoice.paid',
			payload: { invoiceId: 'inv_1' },
		});

		advance(3_600_000);
		expect(await client().redeliver(outcome!.deliveryId)).toMatchObject({
			attempt: 2,
			status: 200,
			deliveryStatus: 'delivered',
		});

		const [first, again] = transport.received as [Request, Request];
		expect(again.headers.get('webhook-id')).toBe(
			first.headers.get('webhook-id'),
		);
		// Signed now, so it verifies now.
		await expect(
			verifyWebhook(secret, again, { now: time }),
		).resolves.toMatchObject({ payload: { invoiceId: 'inv_1' } });
		expect(await client().deliveries({ owner: 'acct_1' })).toMatchObject([
			{ status: 'delivered', attempts: 2 },
		]);
	});

	it('delivers an abandoned delivery, and leaves a failed redelivery’s status alone', async () => {
		hooks.transport = receiver({
			'https://back.example/hooks': [410, 500, 200],
		});
		const { subscription } = await client().subscribe({
			owner: 'acct_1',
			url: 'https://back.example/hooks',
			events: ['invoice.paid'],
		});
		const [outcome] = await deliverEvent(hooks, deps, {
			type: 'invoice.paid',
			payload: { invoiceId: 'inv_1' },
		});
		expect(outcome?.deliveryStatus).toBe('abandoned');

		expect(await client().redeliver(outcome!.deliveryId)).toMatchObject({
			status: 500,
			deliveryStatus: 'abandoned',
		});
		expect(await client().redeliver(outcome!.deliveryId)).toMatchObject({
			status: 200,
			deliveryStatus: 'delivered',
		});
		// Its subscription stays as the 410 left it: enabling it is the app's call.
		expect(await client().get(subscription.id)).toMatchObject({
			status: 'disabled',
		});
	});

	it('refuses a delivery that does not exist', async () => {
		await expect(client().redeliver('msg_nope')).rejects.toBeInstanceOf(
			WebhookDeliveryNotFound,
		);
	});
});

describe('deliveries()', () => {
	it('lists an owner’s or a subscription’s deliveries, newest first, with their attempts', async () => {
		hooks.transport = receiver({ 'https://b.example/hooks': [500, 200] });
		const a = await client().subscribe({
			owner: 'acct_1',
			url: 'https://a.example/hooks',
			events: ['invoice.paid'],
		});
		await client().subscribe({
			owner: 'acct_1',
			url: 'https://b.example/hooks',
			events: ['invoice.voided'],
		});
		await client().subscribe({
			owner: 'acct_2',
			url: 'https://c.example/hooks',
			events: ['invoice.paid'],
		});

		await deliverEvent(hooks, deps, {
			type: 'invoice.paid',
			payload: { invoiceId: 'inv_1' },
		});
		await deliverEvent(hooks, deps, {
			type: 'invoice.voided',
			payload: { invoiceId: 'inv_1' },
		});
		advance(60_000);
		await sweepDue(hooks, deps);

		const owned = await client().deliveries({ owner: 'acct_1' });
		expect(owned.map((d) => d.type)).toEqual([
			'invoice.voided',
			'invoice.paid',
		]);
		expect(owned[0]).toMatchObject({
			status: 'delivered',
			attempts: 2,
			payload: { invoiceId: 'inv_1' },
		});
		expect(owned[0]?.history.map((h) => h.status)).toEqual([500, 200]);
		expect(owned[0]?.history[0]?.error).toBe('answered 500');
		expect(owned[0]?.history[0]?.latencyMs).toBeGreaterThanOrEqual(0);

		expect(
			await client().deliveries({ subscriptionId: a.subscription.id }),
		).toMatchObject([
			{ type: 'invoice.paid', subscriptionId: a.subscription.id },
		]);
		expect(
			await client().deliveries({ owner: 'acct_1' }, { limit: 1 }),
		).toHaveLength(1);
		expect(await client().deliveries({ owner: 'acct_nobody' })).toEqual([]);
	});
});

describe('lifecycle events', () => {
	it('publishes a rotation and a disable made through the client', async () => {
		const { subscription } = await client().subscribe({
			owner: 'acct_1',
			url: 'https://paid.example/hooks',
			events: ['invoice.paid'],
		});

		await client().rotateSecret(subscription.id, { overlapMs: 60_000 });
		await client().disable(subscription.id, 'closed account');

		expect(events.published).toEqual([
			{
				type: 'secret.rotated',
				payload: {
					subscriptionId: subscription.id,
					owner: 'acct_1',
					previousExpiresAt: '2026-11-28T12:01:00.000Z',
				},
			},
			{
				type: 'subscription.disabled',
				payload: {
					subscriptionId: subscription.id,
					owner: 'acct_1',
					reason: 'closed account',
				},
			},
		]);
	});

	it('never fails or repeats a delivery when publishing them fails', async () => {
		const transport = receiver();
		hooks.transport = transport;
		deps = {
			...deps,
			publisher: {
				publish: async () => {
					throw new WebhookAddressRefused('x', 'broker', '0.0.0.0');
				},
			},
			logger: { error: () => {} } as never,
		};
		await client().subscribe({
			owner: 'acct_1',
			url: 'https://paid.example/hooks',
			events: ['invoice.paid'],
		});

		expect(
			await deliverEvent(hooks, deps, {
				type: 'invoice.paid',
				payload: { invoiceId: 'inv_1' },
			}),
		).toMatchObject([{ deliveryStatus: 'delivered' }]);

		advance(24 * 3_600_000);
		expect(await sweepDue(hooks, deps)).toEqual([]);
		expect(transport.received).toHaveLength(1);
	});
});

describe('the default transport, against a server on this machine', () => {
	let server: Server;
	let base: string;
	let received: { req: IncomingMessage; body: string }[];
	let answer: (req: IncomingMessage, res: ServerResponse) => void;

	beforeEach(async () => {
		received = [];
		answer = (_req, res) => res.writeHead(204).end();
		server = createServer((req, res) => {
			let body = '';
			req.on('data', (chunk) => {
				body += chunk;
			});
			req.on('end', () => {
				received.push({ req, body });
				answer(req, res);
			});
		});
		await new Promise<void>((resolve) =>
			server.listen(0, '127.0.0.1', resolve),
		);
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});
	afterEach(async () => {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	});

	it('delivers a signed request the receiver verifies, delivering locally', async () => {
		hooks.transport = defaultTransport;
		hooks.clock = () => new Date();
		const { secret } = await client().subscribe({
			owner: 'acct_1',
			url: `${base}/hooks`,
			events: ['invoice.paid'],
		});

		expect(
			await deliverEvent(hooks, deps, {
				type: 'invoice.paid',
				payload: { invoiceId: 'inv_1' },
			}),
		).toMatchObject([{ status: 204, deliveryStatus: 'delivered' }]);

		const [{ req, body }] = received as [
			{ req: IncomingMessage; body: string },
		];
		expect(req.url).toBe('/hooks');
		expect(
			await verifyWebhook(secret, {
				headers: req.headers as Record<string, string>,
				body,
			}),
		).toMatchObject({ type: 'invoice.paid', payload: { invoiceId: 'inv_1' } });
	});

	it('follows no redirect', async () => {
		answer = (req, res) => {
			if (req.url === '/hooks') {
				res.writeHead(307, { location: `${base}/elsewhere` }).end();
			} else res.writeHead(200).end();
		};

		const response = await defaultTransport(
			new Request(`${base}/hooks`, { method: 'POST', body: '{}' }),
		);

		expect(response.status).toBe(307);
		expect(received.map(({ req }) => req.url)).toEqual(['/hooks']);
	});

	it('reads at most the cap of an answer', async () => {
		answer = (_req, res) => {
			res.writeHead(200, { 'content-type': 'text/plain' });
			res.end('x'.repeat(1024 * 1024));
		};

		const response = await webhookTransport({ maxResponseBytes: 1024 })(
			new Request(`${base}/hooks`, { method: 'POST', body: '{}' }),
		);

		expect(response.status).toBe(200);
		expect((await response.arrayBuffer()).byteLength).toBe(1024);
	});

	it('gives up on a receiver that does not answer in time', async () => {
		answer = () => {};

		await expect(
			webhookTransport({ timeoutMs: 100 })(
				new Request(`${base}/hooks`, { method: 'POST', body: '{}' }),
			),
		).rejects.toBeInstanceOf(WebhookRequestTimedOut);
	});

	it('never calls a private address when not delivering locally', async () => {
		const port = (server.address() as AddressInfo).port;
		// A public-looking name, pointed at this machine after it was registered.
		hooks.transport = webhookTransport({
			local: false,
			lookup: ((_host: string, _options: unknown, done: any) =>
				done(null, [{ address: '127.0.0.1', family: 4 }])) as never,
		});
		await client().subscribe({
			owner: 'acct_1',
			url: `https://receiver.example:${port}/hooks`,
			events: ['invoice.paid'],
		});
		// And one naming the address outright, over plain HTTP.
		await client().subscribe({
			owner: 'acct_2',
			url: `${base}/hooks`,
			events: ['invoice.paid'],
		});

		const outcomes = await deliverEvent(hooks, deps, {
			type: 'invoice.paid',
			payload: { invoiceId: 'inv_1' },
		});

		expect(received).toEqual([]);
		expect(outcomes.map((o) => o.deliveryStatus)).toEqual([
			'pending',
			'pending',
		]);
		expect(outcomes.map((o) => o.error)).toEqual(
			expect.arrayContaining([
				expect.stringContaining('resolves to 127.0.0.1'),
				expect.stringContaining('it is not https://'),
			]),
		);
		await expect(
			webhookTransport({ local: false })(
				new Request('https://169.254.169.254/latest', { method: 'POST' }),
			),
		).rejects.toThrow('not a public address');
	});
});

describe('worker.webhooks()', () => {
	const worker = new Worker('Jobs');

	it('is a topic subscriber and a sweeping cron, both depending on the hooks', () => {
		const { deliver, sweep } = worker.webhooks(build());

		expect(Subscriber.isSubscriber(deliver)).toBe(true);
		expect(deliver.topicName).toBe('Billing');
		expect(deliver.subscribedEvents).toEqual([
			'invoice.paid',
			'invoice.voided',
		]);
		expect(deliver.owner).toBe('Jobs');

		expect(Cron.isCron(sweep)).toBe(true);
		expect(sweep.schedule).toBe('rate(1 minute)');
		expect(sweep.owner).toBe('Jobs');

		for (const runnable of [deliver, sweep]) {
			expect(runnable.constructs).toEqual([
				'BillingHooks',
				'BillingHooksDb',
				'Pii',
				'BillingHooksEvents',
			]);
		}
	});

	it('sweeps on the schedule it is given', () => {
		const { sweep } = worker.webhooks(build(), {
			sweep: 'rate(5 minutes)',
		});
		expect(sweep.schedule).toBe('rate(5 minutes)');
	});

	it('delivers and sweeps through the services its runnables are handed', async () => {
		const { deliver, sweep } = worker.webhooks(hooks);
		const transport = receiver({ 'https://flaky.example/hooks': [500, 200] });
		hooks.transport = transport;
		await client().subscribe({
			owner: 'acct_1',
			url: 'https://flaky.example/hooks',
			events: ['invoice.paid'],
		});
		const services = {
			[tenant.service.serviceName]: deps.db,
			[pii.service.serviceName]: deps.cipher,
			[hooks.events.service.serviceName]: events,
			[hooks.service.serviceName]: client(),
		};
		const logger = { error: () => {} } as never;

		await deliver.handler({
			events: [{ type: 'invoice.paid', payload: { invoiceId: 'inv_1' } }],
			services,
			logger,
		} as never);
		advance(60_000);
		await sweep.fn({ services, logger } as never);

		expect(transport.received).toHaveLength(2);
		expect(events.types()).toEqual(['delivery.failed', 'delivery.succeeded']);
	});
});
