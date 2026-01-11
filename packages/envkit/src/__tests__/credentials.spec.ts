import { createCipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptCredentials } from '../credentials';

/**
 * Helper to encrypt secrets (mirrors CLI encryption logic)
 */
function encryptSecrets(secrets: Record<string, string>) {
	const masterKey = randomBytes(32);
	const iv = randomBytes(12);
	const plaintext = JSON.stringify(secrets);

	const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
	const ciphertext = Buffer.concat([
		cipher.update(plaintext, 'utf-8'),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();
	const combined = Buffer.concat([ciphertext, authTag]);

	return {
		encrypted: combined.toString('base64'),
		iv: iv.toString('hex'),
		masterKey: masterKey.toString('hex'),
	};
}

describe('decryptCredentials', () => {
	it('should decrypt credentials from encrypted payload', () => {
		const secrets = {
			DATABASE_URL: 'postgresql://user:pass@localhost/db',
			API_KEY: 'sk_test_123456',
		};

		const { encrypted, iv, masterKey } = encryptSecrets(secrets);
		const decrypted = decryptCredentials(encrypted, iv, masterKey);

		expect(decrypted).toEqual(secrets);
	});

	it('should handle empty secrets', () => {
		const secrets = {};

		const { encrypted, iv, masterKey } = encryptSecrets(secrets);
		const decrypted = decryptCredentials(encrypted, iv, masterKey);

		expect(decrypted).toEqual({});
	});

	it('should handle secrets with special characters', () => {
		const secrets = {
			PASSWORD: 'p@ss/word!#$%^&*(){}[]|\\:";\'<>,.?/',
			WEBHOOK_URL: 'https://api.example.com/webhook?token=abc&verify=true',
		};

		const { encrypted, iv, masterKey } = encryptSecrets(secrets);
		const decrypted = decryptCredentials(encrypted, iv, masterKey);

		expect(decrypted).toEqual(secrets);
	});

	it('should handle secrets with unicode characters', () => {
		const secrets = {
			MESSAGE: '你好世界 🔐 مرحبا العالم',
			EMOJI: '🚀💻🔑',
		};

		const { encrypted, iv, masterKey } = encryptSecrets(secrets);
		const decrypted = decryptCredentials(encrypted, iv, masterKey);

		expect(decrypted).toEqual(secrets);
	});

	it('should throw with wrong master key', () => {
		const secrets = { KEY: 'value' };
		const { encrypted, iv } = encryptSecrets(secrets);

		const wrongKey = '0'.repeat(64);

		expect(() => decryptCredentials(encrypted, iv, wrongKey)).toThrow();
	});

	it('should throw with wrong IV', () => {
		const secrets = { KEY: 'value' };
		const { encrypted, masterKey } = encryptSecrets(secrets);

		const wrongIv = '0'.repeat(24);

		expect(() => decryptCredentials(encrypted, wrongIv, masterKey)).toThrow();
	});

	it('should throw with tampered ciphertext', () => {
		const secrets = { KEY: 'value' };
		const { encrypted, iv, masterKey } = encryptSecrets(secrets);

		const tamperedBuffer = Buffer.from(encrypted, 'base64');
		tamperedBuffer[0] = tamperedBuffer[0] ^ 0xff;
		const tampered = tamperedBuffer.toString('base64');

		expect(() => decryptCredentials(tampered, iv, masterKey)).toThrow();
	});

	it('should handle large number of secrets', () => {
		const secrets: Record<string, string> = {};
		for (let i = 0; i < 50; i++) {
			secrets[`KEY_${i}`] = `value-${i}-${'x'.repeat(50)}`;
		}

		const { encrypted, iv, masterKey } = encryptSecrets(secrets);
		const decrypted = decryptCredentials(encrypted, iv, masterKey);

		expect(decrypted).toEqual(secrets);
	});

	it('should handle secrets with newlines', () => {
		const secrets = {
			PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----',
			MULTILINE: 'line1\nline2\nline3',
		};

		const { encrypted, iv, masterKey } = encryptSecrets(secrets);
		const decrypted = decryptCredentials(encrypted, iv, masterKey);

		expect(decrypted).toEqual(secrets);
	});
});

describe('Credentials export', () => {
	it('should return empty object in development mode (no globals defined)', async () => {
		// In test environment, __GKM_ENCRYPTED_CREDENTIALS__ is undefined
		// so Credentials should be an empty object
		const { Credentials } = await import('../credentials');
		expect(Credentials).toEqual({});
	});
});
