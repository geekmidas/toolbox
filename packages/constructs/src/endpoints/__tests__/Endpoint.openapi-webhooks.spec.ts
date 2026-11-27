import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { RestApi } from '../../rest-api';
import { Topic } from '../../topic/Topic';
import { CallbackDeclaredTwice } from '../callbacks';
import { Endpoint } from '../Endpoint';
import { WebhookEventDeclaredTwice, WebhookEventNotOnTopic } from '../webhooks';

/**
 * What a service sends to its users — topic events delivered to the URLs they
 * register, and requests an endpoint makes back to a URL its caller gave it.
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

describe('webhooks in the OpenAPI document', () => {
	it('documents each delivered event with its payload and the signature header', async () => {
		const api = new RestApi('Hooks', { path: '.' }).webhooks(billing, {
			signature: {
				header: 'Webhook-Signature',
				description: 'HMAC-SHA256 of the raw body, hex',
			},
			events: ['invoice.paid', 'invoice.voided'],
		});
		const health = api.get('/health').handle(async () => ({}));

		const doc = await Endpoint.buildOpenApiSchema([health]);

		expect(Object.keys(doc.webhooks ?? {})).toEqual([
			'invoice.paid',
			'invoice.voided',
		]);

		const paid = (doc.webhooks as any)['invoice.paid'].post;
		expect(paid.parameters).toEqual([
			{
				name: 'Webhook-Signature',
				in: 'header',
				required: true,
				description: 'HMAC-SHA256 of the raw body, hex',
				schema: { type: 'string' },
			},
		]);
		expect(paid.requestBody.content['application/json'].schema).toEqual({
			type: 'object',
			properties: {
				type: { type: 'string', const: 'invoice.paid' },
				payload: { $ref: '#/components/schemas/WebhookInvoice' },
			},
			required: ['type', 'payload'],
		});
		expect(paid.responses).toHaveProperty('2XX');
		expect(paid.operationId).toBe('invoicePaidWebhook');

		// A registered payload schema is defined in components, where its
		// reference points.
		expect((doc.components?.schemas as any).WebhookInvoice).toMatchObject({
			type: 'object',
			properties: { invoiceId: { type: 'string' } },
		});

		const voided = (doc.webhooks as any)['invoice.voided'].post;
		expect(
			voided.requestBody.content['application/json'].schema.properties.payload,
		).toMatchObject({
			type: 'object',
			properties: { reason: { type: 'string' } },
		});
	});

	it('reaches endpoints built before the topic was registered, from any branch', async () => {
		const api = new RestApi('Late', { path: '.' });
		const branch = api.route('/v1');
		const early = branch.get('/early').handle(async () => ({}));

		api.webhooks(billing);

		const doc = await Endpoint.buildOpenApiSchema([early]);

		expect(Object.keys(doc.webhooks ?? {})).toEqual(billing.eventTypes);
		// No signature declared, so no header is required of the receiver.
		expect((doc.webhooks as any)['invoice.paid'].post).not.toHaveProperty(
			'parameters',
		);
	});

	it('is kept by `.auth()`, which copies the surface', async () => {
		const authenticator = { id: 'auth' } as any;
		const api = new RestApi('Authed', { path: '.' })
			.webhooks(billing, { events: ['invoice.paid'] })
			.auth(authenticator);
		const me = api.get('/me').handle(async () => ({}));

		const doc = await Endpoint.buildOpenApiSchema([me]);

		expect(Object.keys(doc.webhooks ?? {})).toEqual(['invoice.paid']);
	});

	it('has no webhooks key when no surface declares one', async () => {
		const api = new RestApi('Plain', { path: '.' });
		const ping = api.get('/ping').handle(async () => ({}));

		const doc = await Endpoint.buildOpenApiSchema([ping]);

		expect(doc).not.toHaveProperty('webhooks');
	});

	it('refuses two topics delivering the same event type', async () => {
		const other = new Topic('Accounting', {
			events: { 'invoice.paid': z.object({ ref: z.string() }) },
		});
		const api = new RestApi('Clash', { path: '.' })
			.webhooks(billing)
			.webhooks(other);
		const ping = api.get('/ping').handle(async () => ({}));

		await expect(Endpoint.buildOpenApiSchema([ping])).rejects.toBeInstanceOf(
			WebhookEventDeclaredTwice,
		);
	});

	it('refuses an event the topic does not carry', () => {
		const api = new RestApi('Typo', { path: '.' });

		expect(() =>
			api.webhooks(billing, { events: ['invoice.lost' as any] }),
		).toThrow(WebhookEventNotOnTopic);
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
