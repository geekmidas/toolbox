import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { KyselyDatabase } from '../../database/kysely';
import { Encryption } from '../../encryption';
import { RestApi } from '../../rest-api';
import { Topic } from '../../topic/Topic';
import { CallbackDeclaredTwice } from '../callbacks';
import { Endpoint } from '../Endpoint';
import {
	WEBHOOK_DELIVERY_DESCRIPTION,
	WebhookEventDeclaredTwice,
} from '../webhooks';

/**
 * What a service sends to its users — the events a `Webhooks` construct
 * delivers to the URLs they register, documented by the API that owns it, and
 * requests an endpoint makes back to a URL its caller gave it.
 *
 * Only documents are built, so nothing here connects to the database.
 */
const Invoice = z
	.object({ invoiceId: z.string(), amount: z.number() })
	.meta({ id: 'WebhookInvoice' });

const billing = new Topic('Billing', {
	events: {
		'invoice.paid': Invoice,
		'invoice.voided': z.object({ invoiceId: z.string(), reason: z.string() }),
		'ledger.rebalanced': z.object({ at: z.string() }),
	},
});

const accounts = new Topic('Accounts', {
	events: {
		'account.opened': z.object({ accountId: z.string() }),
	},
});

const app = new KyselyDatabase('App');
const pii = new Encryption('Pii');

/** A `Webhooks` owned by `api`, stored in its own tenant of `App`. */
function hooksOn(
	api: RestApi<string>,
	id: string,
	topic: Topic<string, any>,
	events?: string[],
) {
	return api.webhooks(id, {
		topic,
		...(events ? { events } : {}),
		database: app.schema(`${id}Db`),
		encryption: pii,
	});
}

function webhooksOf(doc: { webhooks?: unknown }): Record<string, any> {
	return (doc.webhooks ?? {}) as Record<string, any>;
}

describe('webhooks in the OpenAPI document', () => {
	it('lists the webhooks each API owns in its own document only', async () => {
		const api = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' });
		const accountsApi = new RestApi('AccountsApi', {
			path: '.',
			defaultAuthorizer: 'none',
		});
		hooksOn(api, 'BillingHooks', billing, ['invoice.paid', 'invoice.voided']);
		hooksOn(accountsApi, 'AccountHooks', accounts);

		const [billingDoc, accountsDoc] = await Promise.all([
			Endpoint.buildOpenApiSchema([
				api.get('/health').handle(async () => ({})),
			]),
			Endpoint.buildOpenApiSchema([
				accountsApi.get('/health').handle(async () => ({})),
			]),
		]);

		expect(Object.keys(webhooksOf(billingDoc))).toEqual([
			'invoice.paid',
			'invoice.voided',
		]);
		expect(Object.keys(webhooksOf(accountsDoc))).toEqual(['account.opened']);
	});

	it('is not listed by another API that only depends on it', async () => {
		const api = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' });
		const admin = new RestApi('Admin', {
			path: '.',
			defaultAuthorizer: 'none',
		});
		const billingHooks = hooksOn(api, 'BillingHooks', billing);

		const redeliver = admin
			.post('/deliveries/redeliver')
			.dependsOn([billingHooks])
			.handle(async () => ({}));

		const adminDoc = await Endpoint.buildOpenApiSchema([redeliver]);

		expect(adminDoc).not.toHaveProperty('webhooks');
		// Depending on it is still an edge — it is only the document it skips.
		expect(redeliver.constructs).toContain('BillingHooks');
	});

	it('documents the envelope sent, the signature headers and the answers', async () => {
		const api = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' });
		hooksOn(api, 'BillingHooks', billing, ['invoice.paid', 'invoice.voided']);

		const doc = await Endpoint.buildOpenApiSchema([
			api.get('/health').handle(async () => ({})),
		]);
		const paid = webhooksOf(doc)['invoice.paid'].post;

		expect(paid.operationId).toBe('invoicePaidWebhook');
		expect(paid.summary).toBe('BillingHooks: invoice.paid');
		expect(paid.requestBody.required).toBe(true);
		expect(paid.requestBody.content['application/json'].schema).toEqual({
			type: 'object',
			properties: {
				id: expect.objectContaining({ type: 'string' }),
				type: { type: 'string', const: 'invoice.paid' },
				occurredAt: { type: 'string', format: 'date-time' },
				payload: { $ref: '#/components/schemas/WebhookInvoice' },
			},
			required: ['id', 'type', 'occurredAt', 'payload'],
		});

		expect(paid.parameters.map((p: any) => [p.name, p.in, p.required])).toEqual(
			[
				['webhook-id', 'header', true],
				['webhook-timestamp', 'header', true],
				['webhook-signature', 'header', true],
			],
		);
		const [, timestamp, signature] = paid.parameters;
		expect(timestamp.schema).toEqual({ type: 'integer' });
		expect(timestamp.description).toContain('unix seconds');
		expect(signature.description).toContain('v1,');
		expect(signature.description).toContain('HMAC-SHA256');
		expect(signature.description).toContain('space-separated');

		expect(paid.description).toBe(WEBHOOK_DELIVERY_DESCRIPTION);
		expect(paid.description).toContain(
			'immediately, then retried after 1m, 5m, 30m, 2h, 5h, 10h and 10h',
		);
		expect(paid.description).toContain('`410 Gone`');
		expect(paid.description).toContain('Redirects are not followed');

		expect(Object.keys(paid.responses).sort()).toEqual(['2XX', '410']);
		expect(paid.responses['410'].description).toContain(
			'stop sending to this URL',
		);
	});

	it('names a registered payload schema by reference', async () => {
		const api = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' });
		hooksOn(api, 'BillingHooks', billing);

		const doc = await Endpoint.buildOpenApiSchema([
			api.get('/health').handle(async () => ({})),
		]);

		expect((doc.components?.schemas as any).WebhookInvoice).toMatchObject({
			type: 'object',
			properties: { invoiceId: { type: 'string' } },
		});
		// An unregistered one is written in place.
		expect(
			webhooksOf(doc)['invoice.voided'].post.requestBody.content[
				'application/json'
			].schema.properties.payload,
		).toMatchObject({
			type: 'object',
			properties: { reason: { type: 'string' } },
		});
	});

	it('reaches endpoints built before the webhooks, from any branch', async () => {
		const api = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' });
		const early = api
			.route('/v1')
			.get('/early')
			.handle(async () => ({}));

		hooksOn(api, 'BillingHooks', billing);

		const doc = await Endpoint.buildOpenApiSchema([early]);

		expect(Object.keys(webhooksOf(doc))).toEqual(billing.eventTypes);
	});

	it('is kept by `.auth()`, whose copy shares the owned list', async () => {
		const authenticator = { id: 'auth' } as any;
		const api = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' });
		const authed = api.auth(authenticator);

		// Owned before and after the copy, through either of them.
		hooksOn(api, 'BillingHooks', billing, ['invoice.paid']);
		hooksOn(authed, 'AccountHooks', accounts);

		const [fromCopy, fromOriginal] = await Promise.all([
			Endpoint.buildOpenApiSchema([authed.get('/me').handle(async () => ({}))]),
			Endpoint.buildOpenApiSchema([
				api.get('/health').handle(async () => ({})),
			]),
		]);

		expect(Object.keys(webhooksOf(fromCopy))).toEqual([
			'invoice.paid',
			'account.opened',
		]);
		expect(Object.keys(webhooksOf(fromOriginal))).toEqual([
			'invoice.paid',
			'account.opened',
		]);
	});

	it('has no webhooks key when the API owns none', async () => {
		const api = new RestApi('Plain', { path: '.' });
		const ping = api.get('/ping').handle(async () => ({}));

		const doc = await Endpoint.buildOpenApiSchema([ping]);

		expect(doc).not.toHaveProperty('webhooks');
	});

	it('refuses a second construct on one API delivering the same event type', () => {
		const other = new Topic('Accounting', {
			events: { 'invoice.paid': z.object({ ref: z.string() }) },
		});
		const api = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' });
		hooksOn(api, 'BillingHooks', billing);

		expect(() => hooksOn(api, 'AccountingHooks', other)).toThrow(
			WebhookEventDeclaredTwice,
		);
	});

	it('refuses a document whose APIs deliver the same event type', async () => {
		const other = new Topic('Accounting', {
			events: { 'invoice.paid': z.object({ ref: z.string() }) },
		});
		const api = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' });
		const second = new RestApi('Second', {
			path: '.',
			defaultAuthorizer: 'none',
		});
		hooksOn(api, 'BillingHooks', billing);
		hooksOn(second, 'AccountingHooks', other);

		await expect(
			Endpoint.buildOpenApiSchema([
				api.get('/a').handle(async () => ({})),
				second.get('/b').handle(async () => ({})),
			]),
		).rejects.toBeInstanceOf(WebhookEventDeclaredTwice);
	});
});

describe('callbacks in the OpenAPI document', () => {
	const api = new RestApi('Callbacks', { path: '.' });

	it('documents the request an endpoint makes back to its caller', async () => {
		const ExportReady = z
			.object({ exportId: z.string(), downloadUrl: z.url() })
			.meta({ id: 'CallbackExportReady' });

		const startExport = api
			.post('/exports')
			.body(z.object({ callbackUrl: z.url() }))
			.callback('exportReady', {
				url: '{$request.body#/callbackUrl}',
				description: 'Sent when the export can be downloaded',
				body: ExportReady,
				response: { status: 204, description: 'Acknowledged' },
			})
			.callback('exportFailed', {
				url: '{$request.body#/callbackUrl}/failed',
				method: 'put',
				body: z.object({ reason: z.string() }),
				response: { schema: z.object({ retry: z.boolean() }) },
			})
			.handle(async () => ({}));

		const doc = await Endpoint.buildOpenApiSchema([startExport]);
		const callbacks = (doc.paths['/exports'] as any).post.callbacks;

		expect(callbacks.exportReady).toEqual({
			'{$request.body#/callbackUrl}': {
				post: {
					description: 'Sent when the export can be downloaded',
					requestBody: {
						required: true,
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/CallbackExportReady' },
							},
						},
					},
					responses: { '204': { description: 'Acknowledged' } },
				},
			},
		});
		expect((doc.components?.schemas as any).CallbackExportReady).toMatchObject({
			type: 'object',
			properties: { exportId: { type: 'string' } },
		});

		const failed =
			callbacks.exportFailed['{$request.body#/callbackUrl}/failed'];
		expect(Object.keys(failed)).toEqual(['put']);
		expect(
			failed.put.responses['200'].content['application/json'].schema,
		).toMatchObject({
			type: 'object',
			properties: { retry: { type: 'boolean' } },
		});
	});

	it('has no callbacks on an endpoint that declares none', async () => {
		const plain = api.get('/plain').handle(async () => ({}));

		const doc = await Endpoint.buildOpenApiSchema([plain]);

		expect((doc.paths['/plain'] as any).get).not.toHaveProperty('callbacks');
	});

	it('leaves the builder it branched from without the callback', async () => {
		const base = api.post('/jobs');
		const withCallback = base.callback('done', {
			url: '{$request.body#/url}',
		});

		const [bare, notified] = await Promise.all([
			base.handle(async () => ({})).toOpenApi3Route(),
			withCallback.handle(async () => ({})).toOpenApi3Route(),
		]);

		expect((bare['/jobs'] as any).post).not.toHaveProperty('callbacks');
		expect((notified['/jobs'] as any).post.callbacks).toHaveProperty('done');
	});

	it('refuses a callback name declared twice', () => {
		const builder = api
			.post('/twice')
			.callback('done', { url: '{$request.body#/url}' });

		expect(() =>
			builder.callback('done', { url: '{$request.body#/other}' }),
		).toThrow(CallbackDeclaredTwice);
	});
});
