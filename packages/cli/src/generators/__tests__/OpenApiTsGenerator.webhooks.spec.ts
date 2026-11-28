import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';
import { Encryption } from '@geekmidas/constructs/encryption';
import { WebhookEventDeclaredTwice } from '@geekmidas/constructs/endpoints';
import { RestApi } from '@geekmidas/constructs/rest-api';
import { Topic } from '@geekmidas/constructs/topic';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { OpenApiTsGenerator } from '../OpenApiTsGenerator';

/**
 * The generated client's `webhooks` interface — what a receiver of this API's
 * webhooks types its handler by — built from the `Webhooks` the API owns.
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

const app = new KyselyDatabase('App');
const pii = new Encryption('Pii');

function shippingHooks(api: RestApi<string>, events?: string[]) {
	return api.webhooks('ShippingHooks', {
		topic: shipping,
		...(events ? { events } : {}),
		database: app.schema('ShippingHooksDb'),
		encryption: pii,
	});
}

describe('OpenApiTsGenerator webhooks', () => {
	it('maps each event an owned Webhooks delivers to the envelope a receiver is sent', async () => {
		const api = new RestApi('Shop', { path: '.', defaultAuthorizer: 'none' });
		shippingHooks(api, ['shipment.sent', 'shipment.lost']);
		const health = api.get('/health').handle(async () => ({}));

		const content = await new OpenApiTsGenerator().generate([health]);

		expect(content).toContain('export interface webhooks {');
		expect(content).toContain(
			"'shipment.sent': { id: string; type: 'shipment.sent'; occurredAt: string; payload: WebhookShipment };",
		);
		expect(content).toContain(
			"'shipment.lost': { id: string; type: 'shipment.lost'; occurredAt: string; payload: { shipmentId: string; at: number } };",
		);
		// The registered payload is declared, so the name it is typed by exists.
		expect(content).toContain('export interface WebhookShipment {');
		// Not delivered, so not in the receiver's contract.
		expect(content).not.toContain('shipment.audited');
	});

	it('leaves out webhooks the API only depends on', async () => {
		const shop = new RestApi('Shop', { path: '.', defaultAuthorizer: 'none' });
		const admin = new RestApi('Admin', {
			path: '.',
			defaultAuthorizer: 'none',
		});
		const hooks = shippingHooks(shop);
		const redeliver = admin
			.post('/redeliver')
			.dependsOn([hooks])
			.handle(async () => ({}));

		const content = await new OpenApiTsGenerator().generate([redeliver]);

		expect(content).not.toContain('interface webhooks');
	});

	it('declares no webhooks interface when the API owns none', async () => {
		const api = new RestApi('Quiet', { path: '.' });
		const health = api.get('/health').handle(async () => ({}));

		const content = await new OpenApiTsGenerator().generate([health]);

		expect(content).not.toContain('interface webhooks');
	});

	it('refuses two APIs in one client delivering the same event type', async () => {
		const couriers = new Topic('Couriers', {
			events: { 'shipment.sent': z.object({ ref: z.string() }) },
		});
		const shop = new RestApi('Shop', { path: '.', defaultAuthorizer: 'none' });
		const partners = new RestApi('Partners', {
			path: '.',
			defaultAuthorizer: 'none',
		});
		shippingHooks(shop);
		partners.webhooks('CourierHooks', {
			topic: couriers,
			database: app.schema('CourierHooksDb'),
			encryption: pii,
		});

		await expect(
			new OpenApiTsGenerator().generate([
				shop.get('/a').handle(async () => ({})),
				partners.get('/b').handle(async () => ({})),
			]),
		).rejects.toBeInstanceOf(WebhookEventDeclaredTwice);
	});
});
