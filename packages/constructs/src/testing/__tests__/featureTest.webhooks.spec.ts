import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EnvironmentParser } from '@geekmidas/envkit';
import { providedKeyFor } from '@geekmidas/manifest';
import { serviceContext } from '@geekmidas/services';
import type { Browser } from '@geekmidas/testkit/browser';
import { HttpResponse, http } from 'msw';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { z } from 'zod/v4';
import { TEST_DATABASE_CONFIG } from '../../../../testkit/test/globalSetup';
import { KyselyDatabase } from '../../database/kysely';
import { Encryption } from '../../encryption';
import { RestApi } from '../../rest-api';
import { Topic } from '../../topic/Topic';
import {
	fetchTransport,
	WEBHOOK_TABLES_SQL,
	type WebhooksClient,
	type WebhookTables,
} from '../../webhooks';
import { Worker } from '../../worker';
import {
	durationMs,
	InvalidClockDuration,
	InvalidClockTime,
	testClock,
} from '../clock';
import { featureTest } from '../featureTest';
import type { TestManifest } from '../manifest';
import {
	onTestSeams,
	testTransport,
	WebhookReceiverNotFaked,
} from '../webhooks';

/**
 * A `Webhooks` construct in a feature test: its tenant's tables there from the
 * committed migration, its subscriptions made through a real request in the
 * test's transaction, its deliveries answered by MSW and never the network,
 * and its time the test's clock.
 *
 * The delivery engine is not what is tested here: `deliverBilling` and
 * `retryBilling` stand in for it, doing only what reaches the seams.
 */

const schema = `ft_hooks_${randomUUID().slice(0, 8)}`;
const { host, port, user, password, database } = TEST_DATABASE_CONFIG;
const TENANT_URL = `postgres://${user}:${password}@${host}:${port}/${database}?search_path=${schema}`;
const API_URL = 'http://api.hooks.test';
/** What `gkm migration BillingHooks` committed, in the fixture app. */
const MIGRATION = join(
	import.meta.dirname,
	'__fixtures__/webhooks/db/billing-hooks-db/migrations/20261128000000_webhooks.sql',
);

const billing = new Topic('Billing', {
	events: {
		'invoice.paid': z.object({ invoiceId: z.string() }),
		'invoice.voided': z.object({ invoiceId: z.string() }),
	},
});
const appDb = new KyselyDatabase('AppDb');
// Not exported on its own: reached through the webhooks, as an app writes it.
const tenant = appDb.schema<WebhookTables, 'BillingHooksDb'>('BillingHooksDb');
const pii = new Encryption('Pii');
const api = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' });

const billingHooks = api.webhooks('BillingHooks', {
	topic: billing,
	events: ['invoice.paid'],
	database: tenant,
	encryption: pii,
});

const env = {
	API_URL,
	[providedKeyFor(tenant.id, 'database-schema', 'url')]: TENANT_URL,
	[providedKeyFor(tenant.id, 'database-schema', 'ownerUrl')]: TENANT_URL,
	[providedKeyFor(pii.id, 'encryption', 'url')]:
		`aes256gcm://local?keys=k1.${randomBytes(32).toString('base64url')}&index=${randomBytes(32).toString('base64url')}`,
};

const register = api
	.post('/hooks')
	.dependsOn([billingHooks])
	.body(
		z.object({ url: z.string(), events: z.array(z.enum(['invoice.paid'])) }),
	)
	.output(z.object({ id: z.string(), secret: z.string() }))
	.handle(async ({ body, services }) => {
		const { subscription, secret } = await services.billingHooks.subscribe({
			owner: 'acme',
			...body,
		});
		return { id: subscription.id, secret };
	});

const payInvoice = api
	.post('/invoices/:id/pay')
	.params(z.object({ id: z.string() }))
	.output(z.object({ invoiceId: z.string() }))
	.event(billing, {
		type: 'invoice.paid',
		payload: (invoice) => ({ invoiceId: invoice.invoiceId }),
	})
	.handle(async ({ params }) => ({ invoiceId: params.id }));

/** What the stand-ins saw happen to each request they sent. */
const outcomes: { url: string; status?: number; error?: unknown }[] = [];

/** One request to each of acme's subscriptions, through the construct's seam. */
async function sendToAcme(
	client: { list: (owner: string) => Promise<{ url: string }[]> },
	body: unknown,
) {
	for (const { url } of await client.list('acme')) {
		try {
			const response = await billingHooks.transport(
				new Request(url, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body),
				}),
			);
			outcomes.push({ url, status: response.status });
		} catch (error) {
			outcomes.push({ url, error });
		}
	}
}

const worker = new Worker('Jobs');

/** What `worker.webhooks(hooks)` will return, exported the way apps will. */
const standIns = () => ({
	deliver: worker
		.topic(billing)
		.subscribe(['invoice.paid'])
		.dependsOn([billingHooks])
		.handle(async ({ events, services }) => {
			for (const event of events) {
				await sendToAcme(services.billingHooks, event);
			}
		}),
	sweep: worker
		.cron('rate(1 minute)')
		.dependsOn([billingHooks])
		.output(z.object({ at: z.string() }))
		.handle(async ({ services }) => {
			await sendToAcme(services.billingHooks, { type: 'sweep' });
			return { at: billingHooks.clock().toISOString() };
		}),
});
export const { deliver: deliverBilling, sweep: retryBilling } = standIns();

const source = (file: string, name: string) => ({ file, export: name });

const manifest: TestManifest = {
	stage: 'test',
	constructs: {
		Billing: { kind: 'topic', source: source('constructs', 'billing') },
		Pii: { kind: 'encryption', source: source('constructs', 'pii') },
		Api: { kind: 'rest-api', source: source('constructs', 'api') },
		BillingHooks: {
			kind: 'webhooks',
			source: source('constructs', 'billingHooks'),
		},
	},
	endpoints: ['register', 'payInvoice'].map((name) => ({
		surface: 'Api',
		source: source('endpoints', name),
	})),
	subscribers: [{ source: source('subscribers', 'deliverBilling') }],
	env,
};

const it = featureTest<
	Browser,
	{ billingHooksDb: WebhookTables },
	{},
	{ billingHooks: WebhooksClient<'invoice.paid'> }
>({
	manifest,
	modules: {
		constructs: { billing, pii, api, billingHooks },
		endpoints: { register, payInvoice },
		subscribers: { deliverBilling, retryBilling },
	},
});

const post = (path: string, body: unknown = {}) =>
	[
		`${API_URL}${path}`,
		{
			method: 'POST',
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json' },
		},
	] as const;

beforeAll(async () => {
	// What `gkm test` does before the suite starts: apply the tenant's
	// committed migrations — here, the one `gkm migration` wrote.
	const client = new pg.Client(TEST_DATABASE_CONFIG);
	await client.connect();
	try {
		await client.query(`CREATE SCHEMA "${schema}"`);
		await client.query(`SET search_path TO "${schema}"`);
		await client.query(await readFile(MIGRATION, 'utf-8'));
	} finally {
		await client.end();
	}
});

afterAll(async () => {
	const client = new pg.Client(TEST_DATABASE_CONFIG);
	await client.connect();
	await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
	await client.end();
});

describe('featureTest with webhooks', () => {
	test('the fixture carries the migration gkm migration writes, and it leaves nothing pending', async () => {
		expect(await readFile(MIGRATION, 'utf-8')).toBe(
			`${WEBHOOK_TABLES_SQL.trim()}\n`,
		);
		expect(
			await billingHooks.pendingMigration({
				envParser: new EnvironmentParser(env),
				context: serviceContext,
			}),
		).toBeUndefined();
	});

	it('subscribes through an endpoint, in the test’s transaction', async ({
		browser,
		services,
		db,
	}) => {
		const response = await browser.fetch(
			...post('/hooks', {
				url: 'https://acme.test/hooks',
				events: ['invoice.paid'],
			}),
		);
		expect(response.status).toBe(200);
		const { id, secret } = await response.json();
		expect(secret).toMatch(/^whsec_/);

		const hooks = await services.get('billingHooks');
		expect(await hooks.list('acme')).toEqual([
			expect.objectContaining({ id, url: 'https://acme.test/hooks' }),
		]);
		// The tenant is the test's, though the app never exports it on its own.
		const tenantDb = await db.get('billingHooksDb');
		expect(
			await tenantDb.selectFrom('webhook_subscriptions').select('id').execute(),
		).toEqual([{ id }]);
	});

	it('rolls the last test’s subscription back', async ({ db }) => {
		const tenantDb = await db.get('billingHooksDb');
		expect(
			await tenantDb.selectFrom('webhook_subscriptions').select('id').execute(),
		).toEqual([]);
	});

	it('delivers what a request publishes through MSW, to the handler the test added', async ({
		browser,
		msw,
	}) => {
		outcomes.length = 0;
		const received: unknown[] = [];
		msw.use(
			http.post('https://acme.test/hooks', async ({ request }) => {
				received.push(await request.json());
				return new HttpResponse(null, { status: 204 });
			}),
		);
		await browser.fetch(
			...post('/hooks', {
				url: 'https://acme.test/hooks',
				events: ['invoice.paid'],
			}),
		);

		await browser.fetch(...post('/invoices/inv_1/pay'));

		// The subscriber ran in-process, found by the name it is exported as.
		expect(received).toEqual([
			{ type: 'invoice.paid', payload: { invoiceId: 'inv_1' } },
		]);
		expect(outcomes).toEqual([{ url: 'https://acme.test/hooks', status: 204 }]);
	});

	it('fails a delivery nothing answers as a connection would — and the last test’s handler is gone', async ({
		browser,
	}) => {
		outcomes.length = 0;
		// A real host: had it left the process, it would have answered.
		await browser.fetch(
			...post('/hooks', {
				url: 'https://example.com/hooks',
				events: ['invoice.paid'],
			}),
		);
		await browser.fetch(
			...post('/hooks', {
				url: 'https://acme.test/hooks',
				events: ['invoice.paid'],
			}),
		);

		await browser.fetch(...post('/invoices/inv_2/pay'));

		expect(outcomes).toHaveLength(2);
		for (const { error, status } of outcomes) {
			expect(status).toBeUndefined();
			expect(error).toBeInstanceOf(WebhookReceiverNotFaked);
			expect(error).toBeInstanceOf(TypeError);
		}
	});

	it('refuses an unmatched request made through the transport directly', async () => {
		const failure = await billingHooks
			.transport(new Request('http://localhost:1/hooks', { method: 'POST' }))
			.catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(WebhookReceiverNotFaked);
		expect((failure as WebhookReceiverNotFaked).url).toBe(
			'http://localhost:1/hooks',
		);
	});

	it('reckons the construct’s time by the test’s clock', async ({ clock }) => {
		const start = clock.now();
		expect(billingHooks.clock()).toEqual(start);

		clock.advance('1m');
		expect(billingHooks.clock().getTime()).toBe(start.getTime() + 60_000);
		clock.advance(500);
		expect(billingHooks.clock().getTime()).toBe(start.getTime() + 60_500);

		clock.set('2030-01-01T00:00:00Z');
		expect(billingHooks.clock()).toEqual(new Date('2030-01-01T00:00:00Z'));
	});

	it('starts each test’s clock at the real time again', async ({ clock }) => {
		expect(Math.abs(clock.now().getTime() - Date.now())).toBeLessThan(60_000);
	});

	it('runs a cron on demand, on the test’s clock and network', async ({
		browser,
		clock,
		cron,
		msw,
	}) => {
		outcomes.length = 0;
		msw.use(
			http.post('https://acme.test/hooks', () =>
				HttpResponse.text('', { status: 500 }),
			),
		);
		await browser.fetch(
			...post('/hooks', {
				url: 'https://acme.test/hooks',
				events: ['invoice.paid'],
			}),
		);
		clock.set('2031-06-01T12:00:00Z');
		clock.advance('1h');

		expect(await cron(retryBilling).run()).toEqual({
			at: '2031-06-01T13:00:00.000Z',
		});
		expect(outcomes).toEqual([{ url: 'https://acme.test/hooks', status: 500 }]);
	});
});

describe('the test seams', () => {
	test('a construct gets its own transport and clock back', () => {
		const hooks = api.webhooks('SeamHooks', {
			topic: billing,
			database: tenant,
			encryption: pii,
		});
		const fixed = new Date('2020-01-01T00:00:00Z');

		const restore = onTestSeams([hooks], () => fixed);
		expect(hooks.transport).toBe(testTransport);
		expect(hooks.clock()).toBe(fixed);

		restore();
		expect(hooks.transport).toBe(fetchTransport);
		expect(Math.abs(hooks.clock().getTime() - Date.now())).toBeLessThan(5_000);
	});

	test('the clock parses s, m, h and d, and refuses anything else', () => {
		expect(durationMs('30s')).toBe(30_000);
		expect(durationMs('1m')).toBe(60_000);
		expect(durationMs('2h')).toBe(7_200_000);
		expect(durationMs('1d')).toBe(86_400_000);
		expect(durationMs(250)).toBe(250);
		expect(() => durationMs('1 week')).toThrow(InvalidClockDuration);
		expect(() => testClock().set('not a date')).toThrow(InvalidClockTime);
	});
});
