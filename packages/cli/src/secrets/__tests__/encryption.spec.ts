import { describe, expect, it } from 'vitest';
import {
	decryptSecrets,
	encryptSecrets,
	generateDefineOptions,
} from '../encryption';
import type { EmbeddableSecrets, EncryptedPayload } from '../types';

describe('encryptSecrets', () => {
	it('should return encrypted payload with all required fields', () => {
		const secrets: EmbeddableSecrets = {
			DATABASE_URL: 'postgresql://test:pass@localhost/db',
		};

		const payload = encryptSecrets(secrets);

		expect(payload.encrypted).toBeDefined();
		expect(payload.iv).toBeDefined();
		expect(payload.masterKey).toBeDefined();
	});

	it('should generate different ciphertext for same input', () => {
		const secrets: EmbeddableSecrets = {
			DATABASE_URL: 'postgresql://test:pass@localhost/db',
		};

		const payload1 = encryptSecrets(secrets);
		const payload2 = encryptSecrets(secrets);

		expect(payload1.encrypted).not.toBe(payload2.encrypted);
		expect(payload1.iv).not.toBe(payload2.iv);
		expect(payload1.masterKey).not.toBe(payload2.masterKey);
	});

	it('should generate hex-encoded IV of correct length', () => {
		const secrets: EmbeddableSecrets = { KEY: 'value' };
		const payload = encryptSecrets(secrets);

		// 12 bytes = 24 hex characters
		expect(payload.iv).toHaveLength(24);
		expect(payload.iv).toMatch(/^[0-9a-f]+$/);
	});

	it('should generate hex-encoded master key of correct length', () => {
		const secrets: EmbeddableSecrets = { KEY: 'value' };
		const payload = encryptSecrets(secrets);

		// 32 bytes = 64 hex characters
		expect(payload.masterKey).toHaveLength(64);
		expect(payload.masterKey).toMatch(/^[0-9a-f]+$/);
	});

	it('should produce base64-encoded ciphertext', () => {
		const secrets: EmbeddableSecrets = { KEY: 'value' };
		const payload = encryptSecrets(secrets);

		// Should be valid base64
		expect(() => Buffer.from(payload.encrypted, 'base64')).not.toThrow();
	});
});

describe('decryptSecrets', () => {
	it('should decrypt back to original secrets', () => {
		const secrets: EmbeddableSecrets = {
			DATABASE_URL: 'postgresql://test:pass@localhost/db',
			REDIS_URL: 'redis://localhost:6379',
			CUSTOM_KEY: 'custom-value',
		};

		const payload = encryptSecrets(secrets);
		const decrypted = decryptSecrets(
			payload.encrypted,
			payload.iv,
			payload.masterKey,
		);

		expect(decrypted).toEqual(secrets);
	});

	it('should handle empty secrets', () => {
		const secrets: EmbeddableSecrets = {};

		const payload = encryptSecrets(secrets);
		const decrypted = decryptSecrets(
			payload.encrypted,
			payload.iv,
			payload.masterKey,
		);

		expect(decrypted).toEqual({});
	});

	it('should handle secrets with special characters', () => {
		const secrets: EmbeddableSecrets = {
			PASSWORD: 'p@ss/word!#$%^&*(){}[]|\\:";\'<>,.?/',
			URL: 'https://user:pass@host.com/path?query=value&foo=bar',
		};

		const payload = encryptSecrets(secrets);
		const decrypted = decryptSecrets(
			payload.encrypted,
			payload.iv,
			payload.masterKey,
		);

		expect(decrypted).toEqual(secrets);
	});

	it('should handle secrets with unicode characters', () => {
		const secrets: EmbeddableSecrets = {
			MESSAGE: '你好世界 🔐 مرحبا',
		};

		const payload = encryptSecrets(secrets);
		const decrypted = decryptSecrets(
			payload.encrypted,
			payload.iv,
			payload.masterKey,
		);

		expect(decrypted).toEqual(secrets);
	});

	it('should throw with wrong master key', () => {
		const secrets: EmbeddableSecrets = { KEY: 'value' };
		const payload = encryptSecrets(secrets);

		// Generate a different key
		const wrongKey = '0'.repeat(64);

		expect(() =>
			decryptSecrets(payload.encrypted, payload.iv, wrongKey),
		).toThrow();
	});

	it('should throw with wrong IV', () => {
		const secrets: EmbeddableSecrets = { KEY: 'value' };
		const payload = encryptSecrets(secrets);

		// Use wrong IV
		const wrongIv = '0'.repeat(24);

		expect(() =>
			decryptSecrets(payload.encrypted, wrongIv, payload.masterKey),
		).toThrow();
	});

	it('should throw with tampered ciphertext', () => {
		const secrets: EmbeddableSecrets = { KEY: 'value' };
		const payload = encryptSecrets(secrets);

		// Tamper with ciphertext
		const tamperedBuffer = Buffer.from(payload.encrypted, 'base64');
		tamperedBuffer[0] = tamperedBuffer[0] ^ 0xff;
		const tampered = tamperedBuffer.toString('base64');

		expect(() =>
			decryptSecrets(tampered, payload.iv, payload.masterKey),
		).toThrow();
	});
});

describe('generateDefineOptions', () => {
	it('should return define options for bundler', () => {
		const payload: EncryptedPayload = {
			encrypted: 'base64-ciphertext',
			iv: 'hex-iv-value',
			masterKey: 'hex-master-key',
		};

		const options = generateDefineOptions(payload);

		expect(options.__GKM_ENCRYPTED_CREDENTIALS__).toBe(
			JSON.stringify('base64-ciphertext'),
		);
		expect(options.__GKM_CREDENTIALS_IV__).toBe(JSON.stringify('hex-iv-value'));
	});

	it('should not include master key in define options', () => {
		const payload: EncryptedPayload = {
			encrypted: 'encrypted',
			iv: 'iv',
			masterKey: 'secret-key',
		};

		const options = generateDefineOptions(payload);

		expect(options).not.toHaveProperty('__GKM_MASTER_KEY__');
		expect(JSON.stringify(options)).not.toContain('secret-key');
	});
});

describe('encryption roundtrip', () => {
	it('should handle large secrets', () => {
		const secrets: EmbeddableSecrets = {};
		for (let i = 0; i < 100; i++) {
			secrets[`KEY_${i}`] = `value-${i}-${'x'.repeat(100)}`;
		}

		const payload = encryptSecrets(secrets);
		const decrypted = decryptSecrets(
			payload.encrypted,
			payload.iv,
			payload.masterKey,
		);

		expect(decrypted).toEqual(secrets);
	});

	it('should handle secrets with newlines and whitespace', () => {
		const secrets: EmbeddableSecrets = {
			MULTILINE: 'line1\nline2\nline3',
			TABS: 'col1\tcol2\tcol3',
			SPACES: '  leading and trailing  ',
		};

		const payload = encryptSecrets(secrets);
		const decrypted = decryptSecrets(
			payload.encrypted,
			payload.iv,
			payload.masterKey,
		);

		expect(decrypted).toEqual(secrets);
	});
});
