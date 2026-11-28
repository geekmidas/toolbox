import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	verifyWebhook,
	WebhookHeadersMissing,
	WebhookSecretInvalid,
	WebhookSignatureInvalid,
	WebhookTimestampOutOfRange,
} from '../webhooks';

/**
 * A receiver's check, against requests signed the way Standard Webhooks
 * signs them — computed here independently, with Node's HMAC, rather than by
 * the sender's code.
 */

const secret = () => `whsec_${randomBytes(24).toString('base64')}`;

function sign(key: string, id: string, timestamp: number, body: string) {
	const mac = createHmac('sha256', Buffer.from(key.slice(6), 'base64'))
		.update(`${id}.${timestamp}.${body}`)
		.digest('base64');
	return `v1,${mac}`;
}

type Events = {
	'invoice.paid': { type: 'invoice.paid'; payload: { invoiceId: string } };
};

const event = {
	id: 'evt_1',
	type: 'invoice.paid',
	occurredAt: '2026-11-28T12:00:00.000Z',
	payload: { invoiceId: 'inv_1' },
};
const body = JSON.stringify(event);
const now = () => Math.floor(Date.now() / 1000);

function request(headers: Record<string, string>, raw = body) {
	return new Request('https://receiver.example/hooks', {
		method: 'POST',
		headers,
		body: raw,
	});
}

describe('verifyWebhook', () => {
	it('returns the event of a request signed with the secret', async () => {
		const key = secret();
		const timestamp = now();
		const verified = await verifyWebhook<Events>(
			key,
			request({
				'webhook-id': 'msg_1',
				'webhook-timestamp': String(timestamp),
				'webhook-signature': sign(key, 'msg_1', timestamp, body),
			}),
		);

		expect(verified).toEqual(event);
		// Typed by the map it was given.
		expect(verified.payload.invoiceId).toBe('inv_1');
	});

	it('accepts any one of several signatures, and any one of several secrets', async () => {
		const [current, previous] = [secret(), secret()];
		const timestamp = now();
		const headers = {
			'webhook-id': 'msg_2',
			'webhook-timestamp': String(timestamp),
			'webhook-signature': `${sign(current, 'msg_2', timestamp, body)} ${sign(previous, 'msg_2', timestamp, body)}`,
		};

		await expect(verifyWebhook(previous, request(headers))).resolves.toEqual(
			event,
		);
		await expect(
			verifyWebhook([secret(), current], request(headers)),
		).resolves.toEqual(event);
	});

	it('reads a raw body and plain headers, as frameworks hand them over', async () => {
		const key = secret();
		const timestamp = now();
		await expect(
			verifyWebhook(key, {
				headers: {
					'Webhook-Id': 'msg_3',
					'Webhook-Timestamp': String(timestamp),
					'Webhook-Signature': sign(key, 'msg_3', timestamp, body),
				},
				body,
			}),
		).resolves.toEqual(event);
	});

	it('refuses a tampered body, and another secret', async () => {
		const key = secret();
		const timestamp = now();
		const headers = {
			'webhook-id': 'msg_4',
			'webhook-timestamp': String(timestamp),
			'webhook-signature': sign(key, 'msg_4', timestamp, body),
		};

		await expect(
			verifyWebhook(key, request(headers, body.replace('inv_1', 'inv_2'))),
		).rejects.toBeInstanceOf(WebhookSignatureInvalid);
		await expect(
			verifyWebhook(secret(), request(headers)),
		).rejects.toBeInstanceOf(WebhookSignatureInvalid);
		// Another id under the same signature is a forgery too.
		await expect(
			verifyWebhook(key, request({ ...headers, 'webhook-id': 'msg_5' })),
		).rejects.toBeInstanceOf(WebhookSignatureInvalid);
	});

	it('refuses a stale timestamp, and one from the future', async () => {
		const key = secret();
		for (const timestamp of [now() - 301, now() + 301]) {
			await expect(
				verifyWebhook(
					key,
					request({
						'webhook-id': 'msg_6',
						'webhook-timestamp': String(timestamp),
						'webhook-signature': sign(key, 'msg_6', timestamp, body),
					}),
				),
			).rejects.toBeInstanceOf(WebhookTimestampOutOfRange);
		}

		const old = now() - 600;
		await expect(
			verifyWebhook(
				key,
				request({
					'webhook-id': 'msg_7',
					'webhook-timestamp': String(old),
					'webhook-signature': sign(key, 'msg_7', old, body),
				}),
				{ toleranceSeconds: 900 },
			),
		).resolves.toEqual(event);
	});

	it('names the headers a request is missing', async () => {
		const error = await verifyWebhook(
			secret(),
			request({ 'webhook-id': 'msg_8' }),
		).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(WebhookHeadersMissing);
		expect((error as WebhookHeadersMissing).missing).toEqual([
			'webhook-timestamp',
			'webhook-signature',
		]);
	});

	it('refuses a secret that is not base64', async () => {
		const timestamp = now();
		await expect(
			verifyWebhook(
				'whsec_not*base64',
				request({
					'webhook-id': 'msg_9',
					'webhook-timestamp': String(timestamp),
					'webhook-signature': 'v1,abc',
				}),
			),
		).rejects.toBeInstanceOf(WebhookSecretInvalid);
	});
});
