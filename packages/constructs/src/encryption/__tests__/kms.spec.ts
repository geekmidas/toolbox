import { createHmac, randomBytes } from 'node:crypto';
import { KMSClient } from '@aws-sdk/client-kms';
import { kmsUrl } from '@geekmidas/manifest';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CiphertextNotAuthentic, open, seal } from '../cipher';
import { kmsCipher } from '../kms';

/**
 * KMS, as far as this cipher uses it: a master key that wraps data keys under
 * an encryption context, and an HMAC key. Real crypto, so a context or blob
 * mismatch fails the way KMS fails it.
 */
const master = randomBytes(32);
const hmac = randomBytes(32);
const calls: string[] = [];

const context = (body: { EncryptionContext?: Record<string, string> }) =>
	Buffer.from(JSON.stringify(body.EncryptionContext ?? {}));

const server = setupServer(
	http.post('https://kms.eu-west-1.amazonaws.com/', async ({ request }) => {
		const action = request.headers.get('x-amz-target')!.split('.')[1]!;
		const body = (await request.json()) as Record<string, any>;
		calls.push(action);

		switch (action) {
			case 'GenerateDataKey': {
				const plaintext = randomBytes(32);
				return HttpResponse.json({
					KeyId: body.KeyId,
					Plaintext: plaintext.toString('base64'),
					CiphertextBlob: seal(master, plaintext, context(body)).toString(
						'base64',
					),
				});
			}
			case 'Decrypt': {
				const plaintext = open(
					master,
					Buffer.from(body.CiphertextBlob, 'base64'),
					context(body),
				);
				if (!plaintext) {
					return HttpResponse.json(
						{ __type: 'InvalidCiphertextException', message: 'invalid' },
						{ status: 400 },
					);
				}
				return HttpResponse.json({ Plaintext: plaintext.toString('base64') });
			}
			case 'GenerateMac':
				return HttpResponse.json({
					Mac: createHmac('sha256', hmac)
						.update(Buffer.from(body.Message, 'base64'))
						.digest('base64'),
				});
			default:
				return HttpResponse.json({}, { status: 400 });
		}
	}),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
	server.resetHandlers();
	calls.length = 0;
});
afterAll(() => server.close());

const client = new KMSClient({
	region: 'eu-west-1',
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});
const url = kmsUrl({
	region: 'eu-west-1',
	key: 'arn:aws:kms:eu-west-1:123456789012:key/enc',
	index: 'arn:aws:kms:eu-west-1:123456789012:key/mac',
});

describe('the KMS cipher', () => {
	it('seals with a fresh data key from KMS, and opens through KMS', async () => {
		const pii = kmsCipher('Pii', url, client);

		const ciphertext = await pii.encrypt('ada@example.com');
		expect(ciphertext).toMatch(/^gkm1\.kms\./);
		expect(await pii.decrypt(ciphertext)).toBe('ada@example.com');
		expect(calls).toEqual(['GenerateDataKey', 'Decrypt']);
	});

	it('binds the data key to the construct, so another cannot open it', async () => {
		const ciphertext = await kmsCipher('Pii', url, client).encrypt('secret');

		await expect(
			kmsCipher('Billing', url, client).decrypt(ciphertext),
		).rejects.toThrow();
	});

	it('refuses a ciphertext whose data was altered', async () => {
		const pii = kmsCipher('Pii', url, client);
		const [version, keyId, payload] = (await pii.encrypt('secret')).split('.');
		const bytes = Buffer.from(payload!, 'base64url');
		bytes[bytes.length - 1]! ^= 1;

		await expect(
			pii.decrypt(`${version}.${keyId}.${bytes.toString('base64url')}`),
		).rejects.toBeInstanceOf(CiphertextNotAuthentic);
	});

	it('indexes through the HMAC key, the same every time', async () => {
		const pii = kmsCipher('Pii', url, client);

		expect(await pii.index('ada@example.com')).toBe(
			await pii.index('ada@example.com'),
		);
		expect(calls).toEqual(['GenerateMac', 'GenerateMac']);
	});

	it('has nothing to move on reencrypt — KMS keeps every version it rotated through', async () => {
		const pii = kmsCipher('Pii', url, client);
		const ciphertext = await pii.encrypt('kept');

		expect(await pii.reencrypt(ciphertext)).toBe(ciphertext);
	});
});
