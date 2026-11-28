import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { providedKeyFor } from '@geekmidas/manifest';
import type { Browser } from '@geekmidas/testkit/browser';
import { HttpResponse, http } from 'msw';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { z } from 'zod/v4';
import { verifyWebhook } from '../../../../client/src/webhooks';
import { TEST_DATABASE_CONFIG } from '../../../../testkit/test/globalSetup';
import { KyselyDatabase } from '../../database/kysely';
import { Encryption } from '../../encryption';
import { RestApi } from '../../rest-api';
import { Topic } from '../../topic/Topic';
import type { WebhooksClient, WebhookTables } from '../../webhooks';
import { Worker } from '../../worker';
import { featureTest } from '../featureTest';
import type { TestManifest } from '../manifest';

/**
 * The delivery engine in a feature test, as an app exports it:
 * `worker.webhooks(hooks)` destructured into a subscriber and a cron. A
 * request publishes, the deliverer signs and sends through MSW, a failed
 * attempt waits for the test's clock, and the sweep sends it again.
 */

const schema = `ft_delivery_${randomUUID().slice(0, 8)}`;
const { host, port, user, password, database } = TEST_DATABASE_CONFIG;
const TENANT_URL = `postgres://${user}:${password}@${host}:${port}/${database}?search_path=${schema}`;
const API_URL = 'http://api.delivery.test';
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

const worker = new Worker('Jobs');

export const { deliver: deliverBilling, sweep: retryBilling } =
	worker.webhooks(billingHooks);

/** What a reaction to the construct's own lifecycle saw. */
const succeeded: unknown[] = [];
export const onDelivered = worker
	.topic(billingHooks.events)
	.subscribe(['delivery.succeeded'])
	.handle(async ({ events }) => {
		succeeded.push(...events.map((event) => event.payload));
	});

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
	subscribers: [
		{ source: source('subscribers', 'deliverBilling') },
		{ source: source('subscribers', 'onDelivered') },
	],
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
		subscribers: { deliverBilling, retryBilling, onDelivered },
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

describe('worker.webhooks() in a featureTest', () => {
	it('retries a failed delivery on the test’s clock, and records it', async ({
		browser,
		clock,
		cron,
		msw,
		services,
	}) => {
		const received: Request[] = [];
		let calls = 0;
		msw.use(
			http.post('https://acme.test/hooks', ({ request }) => {
				received.push(request.clone());
				return ++calls === 1
					? new HttpResponse(null, { status: 500 })
					: new HttpResponse(null, { status: 200 });
			}),
		);

		const response = await browser.fetch(
			...post('/hooks', {
				url: 'https://acme.test/hooks',
				events: ['invoice.paid'],
			}),
		);
		const { secret } = await response.json();
		await browser.fetch(...post('/invoices/inv_1/pay'));
		expect(calls).toBe(1);

		clock.advance('1m');
		await cron(retryBilling).run();

		expect(calls).toBe(2);
		expect(
			await verifyWebhook(secret, received[1] as Request, {
				now: clock.now(),
			}),
		).toMatchObject({ type: 'invoice.paid', payload: { invoiceId: 'inv_1' } });

		const hooks = await services.get('billingHooks');
		const [delivery] = await hooks.deliveries({ owner: 'acme' });
		expect(delivery).toMatchObject({ status: 'delivered', attempts: 2 });
	});

	it('runs a subscriber to the construct’s lifecycle topic', async ({
		browser,
		msw,
	}) => {
		succeeded.length = 0;
		msw.use(
			http.post(
				'https://acme.test/hooks',
				() => new HttpResponse(null, { status: 204 }),
			),
		);
		await browser.fetch(
			...post('/hooks', {
				url: 'https://acme.test/hooks',
				events: ['invoice.paid'],
			}),
		);

		await browser.fetch(...post('/invoices/inv_3/pay'));

		expect(succeeded).toMatchObject([
			{
				owner: 'acme',
				eventType: 'invoice.paid',
				attempts: 1,
				status: 204,
			},
		]);
	});

	it('records a delivery nothing answers as a failed attempt, without failing the request', async ({
		browser,
		services,
	}) => {
		await browser.fetch(
			...post('/hooks', {
				url: 'https://nobody.test/hooks',
				events: ['invoice.paid'],
			}),
		);

		const paid = await browser.fetch(...post('/invoices/inv_2/pay'));
		expect(paid.status).toBe(200);

		const hooks = await services.get('billingHooks');
		const [delivery] = await hooks.deliveries({ owner: 'acme' });
		expect(delivery).toMatchObject({ status: 'pending', attempts: 1 });
		expect(delivery?.lastError).toContain('reached no handler');
	});
});
