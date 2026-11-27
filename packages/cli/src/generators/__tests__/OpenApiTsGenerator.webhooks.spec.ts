import { WebhookEventDeclaredTwice } from '@geekmidas/constructs/endpoints';
import { RestApi } from '@geekmidas/constructs/rest-api';
import { Topic } from '@geekmidas/constructs/topic';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { OpenApiTsGenerator } from '../OpenApiTsGenerator';

/**
 * The generated client's `webhooks` interface — what a receiver of this API's
 * webhooks types its handler by.
 */
const Shipment = z
	.object({ shipmentId: z.string(), carrier: z.string() })
	.meta({ id: 'WebhookShipment' });

const shipping = new Topic('Shipping', {
	events: {
		'shipment.sent': Shipment,
		'shipment.lost': z.object({ shipmentId: z.string(), at: z.number() }),
		'shipment.audited': z.object({ by: z.string() }),
	},
});

describe('OpenApiTsGenerator webhooks', () => {
	it('maps each delivered event type to the body a receiver is sent', async () => {
		const api = new RestApi('Shop', { path: '.' }).webhooks(shipping, {
			signature: { header: 'Webhook-Signature' },
			events: ['shipment.sent', 'shipment.lost'],
		});
		const health = api.get('/health').handle(async () => ({}));

		const content = await new OpenApiTsGenerator().generate([health]);

		expect(content).toContain('export interface webhooks {');
		expect(content).toContain(
			"'shipment.sent': { type: 'shipment.sent'; payload: WebhookShipment };",
		);
		expect(content).toContain(
			"'shipment.lost': { type: 'shipment.lost'; payload: { shipmentId: string; at: number } };",
		);
		// The registered payload is declared, so the name it is typed by exists.
		expect(content).toContain('export interface WebhookShipment {');
		// Not delivered, so not in the receiver's contract.
		expect(content).not.toContain('shipment.audited');
	});

	it('declares no webhooks interface when nothing is delivered', async () => {
		const api = new RestApi('Quiet', { path: '.' });
		const health = api.get('/health').handle(async () => ({}));

		const content = await new OpenApiTsGenerator().generate([health]);

		expect(content).not.toContain('interface webhooks');
	});

	it('refuses two topics delivering the same event type', async () => {
		const other = new Topic('Couriers', {
			events: { 'shipment.sent': z.object({ ref: z.string() }) },
		});
		const api = new RestApi('Twice', { path: '.' })
			.webhooks(shipping)
			.webhooks(other);
		const health = api.get('/health').handle(async () => ({}));

		await expect(
			new OpenApiTsGenerator().generate([health]),
		).rejects.toBeInstanceOf(WebhookEventDeclaredTwice);
	});
});
