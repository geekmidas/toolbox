import {
	CreateKeyCommand,
	type CreateKeyCommandInput,
	KMSClient,
	ScheduleKeyDeletionCommand,
} from '@aws-sdk/client-kms';
import { kmsUrl } from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CiphertextNotAuthentic } from '../cipher';
import { kmsCipher } from '../kms';

/**
 * Against floci — the AWS emulator the test stack already runs for SNS and
 * SQS — so every call is a real KMS call: a data key it wrapped, a context it
 * checks, a MAC it computed.
 */
const endpoint = `http://localhost:${process.env.LOCALSTACK_HOST_PORT || 4566}`;
const region = 'eu-west-1';

const kms = new KMSClient({
	region,
	endpoint,
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});
let url: string;
const keys: string[] = [];

async function createKey(input: CreateKeyCommandInput): Promise<string> {
	const arn = (await kms.send(new CreateKeyCommand(input))).KeyMetadata!.Arn!;
	keys.push(arn);
	return arn;
}

beforeAll(async () => {
	// What the cipher's own client reads — the default chain, as on a Lambda.
	vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
	vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');

	url = kmsUrl({
		region,
		endpoint,
		key: await createKey({}),
		index: await createKey({
			KeyUsage: 'GENERATE_VERIFY_MAC',
			KeySpec: 'HMAC_256',
		}),
	});
});

afterAll(async () => {
	vi.unstubAllEnvs();
	for (const KeyId of keys) {
		await kms.send(
			new ScheduleKeyDeletionCommand({ KeyId, PendingWindowInDays: 7 }),
		);
	}
});

describe('the KMS cipher', () => {
	it('seals with a data key KMS wrapped, and opens through KMS', async () => {
		const pii = kmsCipher('Pii', url);

		const ciphertext = await pii.encrypt('ada@example.com');
		expect(ciphertext).toMatch(/^gkm1\.kms\./);
		expect(await pii.decrypt(ciphertext)).toBe('ada@example.com');
	});

	it('never writes the same ciphertext twice', async () => {
		const pii = kmsCipher('Pii', url);

		expect(await pii.encrypt('same')).not.toBe(await pii.encrypt('same'));
	});

	it('binds the data key to the construct, so KMS refuses another', async () => {
		const ciphertext = await kmsCipher('Pii', url).encrypt('secret');

		await expect(kmsCipher('Billing', url).decrypt(ciphertext)).rejects.toThrow(
			/ciphertext is invalid/i,
		);
	});

	it('refuses a ciphertext whose data was altered', async () => {
		const pii = kmsCipher('Pii', url);
		const [version, keyId, payload] = (await pii.encrypt('secret')).split('.');
		const bytes = Buffer.from(payload!, 'base64url');
		bytes[bytes.length - 1]! ^= 1;

		await expect(
			pii.decrypt(`${version}.${keyId}.${bytes.toString('base64url')}`),
		).rejects.toBeInstanceOf(CiphertextNotAuthentic);
	});

	it('indexes through the HMAC key: the same every time, different per value', async () => {
		const pii = kmsCipher('Pii', url);

		expect(await pii.index('ada@example.com')).toBe(
			await pii.index('ada@example.com'),
		);
		expect(await pii.index('ada@example.com')).not.toBe(
			await pii.index('bob@example.com'),
		);
	});

	it('has nothing to move on reencrypt — KMS keeps every version it rotated through', async () => {
		const pii = kmsCipher('Pii', url);
		const ciphertext = await pii.encrypt('kept');

		expect(await pii.reencrypt(ciphertext)).toBe(ciphertext);
	});
});
