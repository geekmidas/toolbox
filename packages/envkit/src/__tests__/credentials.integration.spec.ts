import { createCipheriv, randomBytes } from 'node:crypto';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

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

/**
 * Simulates the credentials.ts module code that runs at runtime
 */
const credentialsModuleCode = `
const { createDecipheriv } = require('node:crypto');

const AUTH_TAG_LENGTH = 16;

function decryptCredentials(encrypted, iv, masterKey) {
	const key = Buffer.from(masterKey, 'hex');
	const ivBuffer = Buffer.from(iv, 'hex');
	const combined = Buffer.from(encrypted, 'base64');

	const ciphertext = combined.subarray(0, -AUTH_TAG_LENGTH);
	const authTag = combined.subarray(-AUTH_TAG_LENGTH);

	const decipher = createDecipheriv('aes-256-gcm', key, ivBuffer);
	decipher.setAuthTag(authTag);

	const plaintext = Buffer.concat([
		decipher.update(ciphertext),
		decipher.final(),
	]);

	return JSON.parse(plaintext.toString('utf-8'));
}

// This simulates runtime behavior
const Credentials = (() => {
	if (typeof __GKM_ENCRYPTED_CREDENTIALS__ === 'undefined' ||
		typeof __GKM_CREDENTIALS_IV__ === 'undefined') {
		return {};
	}

	const masterKey = process.env.GKM_MASTER_KEY;
	if (!masterKey) {
		return {};
	}

	try {
		return decryptCredentials(
			__GKM_ENCRYPTED_CREDENTIALS__,
			__GKM_CREDENTIALS_IV__,
			masterKey
		);
	} catch (error) {
		return {};
	}
})();

module.exports = { Credentials };
`;

describe('Credentials runtime integration', () => {
	it('should decrypt credentials when globals and master key are set', () => {
		const secrets = {
			DATABASE_URL: 'postgresql://user:pass@localhost/db',
			API_KEY: 'sk_test_123456',
			WEBHOOK_SECRET: 'whsec_abc123',
		};

		const { encrypted, iv, masterKey } = encryptSecrets(secrets);

		// Create a VM context with the build-time injected globals
		const context = vm.createContext({
			__GKM_ENCRYPTED_CREDENTIALS__: encrypted,
			__GKM_CREDENTIALS_IV__: iv,
			process: {
				env: {
					GKM_MASTER_KEY: masterKey,
				},
			},
			require: require,
			Buffer: Buffer,
			module: { exports: {} },
		});

		// Run the credentials module code
		vm.runInContext(credentialsModuleCode, context);

		// Get the exported Credentials
		const { Credentials } = context.module.exports;

		expect(Credentials).toEqual(secrets);
	});

	it('should return empty object when globals are not defined', () => {
		const context = vm.createContext({
			process: { env: {} },
			require: require,
			Buffer: Buffer,
			module: { exports: {} },
		});

		vm.runInContext(credentialsModuleCode, context);

		const { Credentials } = context.module.exports;
		expect(Credentials).toEqual({});
	});

	it('should return empty object when master key is missing', () => {
		const secrets = { KEY: 'value' };
		const { encrypted, iv } = encryptSecrets(secrets);

		const context = vm.createContext({
			__GKM_ENCRYPTED_CREDENTIALS__: encrypted,
			__GKM_CREDENTIALS_IV__: iv,
			process: { env: {} }, // No GKM_MASTER_KEY
			require: require,
			Buffer: Buffer,
			module: { exports: {} },
		});

		vm.runInContext(credentialsModuleCode, context);

		const { Credentials } = context.module.exports;
		expect(Credentials).toEqual({});
	});

	it('should return empty object when master key is wrong', () => {
		const secrets = { KEY: 'value' };
		const { encrypted, iv } = encryptSecrets(secrets);

		const context = vm.createContext({
			__GKM_ENCRYPTED_CREDENTIALS__: encrypted,
			__GKM_CREDENTIALS_IV__: iv,
			process: {
				env: {
					GKM_MASTER_KEY: '0'.repeat(64), // Wrong key
				},
			},
			require: require,
			Buffer: Buffer,
			module: { exports: {} },
		});

		vm.runInContext(credentialsModuleCode, context);

		const { Credentials } = context.module.exports;
		expect(Credentials).toEqual({});
	});

	it('should handle complex secrets with special characters', () => {
		const secrets = {
			PRIVATE_KEY:
				'-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----',
			JSON_CONFIG: '{"key": "value", "nested": {"a": 1}}',
			UNICODE: '你好世界 🔐',
		};

		const { encrypted, iv, masterKey } = encryptSecrets(secrets);

		const context = vm.createContext({
			__GKM_ENCRYPTED_CREDENTIALS__: encrypted,
			__GKM_CREDENTIALS_IV__: iv,
			process: {
				env: { GKM_MASTER_KEY: masterKey },
			},
			require: require,
			Buffer: Buffer,
			module: { exports: {} },
		});

		vm.runInContext(credentialsModuleCode, context);

		const { Credentials } = context.module.exports;
		expect(Credentials).toEqual(secrets);
	});

	it('should work with EnvironmentParser pattern', () => {
		const secrets = {
			DATABASE_URL: 'postgresql://user:pass@localhost/db',
			PORT: '3000',
		};

		const { encrypted, iv, masterKey } = encryptSecrets(secrets);

		// Simulate: {...process.env, ...Credentials}
		const processEnv = {
			NODE_ENV: 'production',
			HOST: 'localhost',
		};

		const context = vm.createContext({
			__GKM_ENCRYPTED_CREDENTIALS__: encrypted,
			__GKM_CREDENTIALS_IV__: iv,
			process: {
				env: {
					...processEnv,
					GKM_MASTER_KEY: masterKey,
				},
			},
			require: require,
			Buffer: Buffer,
			module: { exports: {} },
		});

		vm.runInContext(credentialsModuleCode, context);

		const { Credentials } = context.module.exports;

		// Simulate what user code does
		const combinedEnv = { ...processEnv, ...Credentials };

		expect(combinedEnv).toEqual({
			NODE_ENV: 'production',
			HOST: 'localhost',
			DATABASE_URL: 'postgresql://user:pass@localhost/db',
			PORT: '3000',
		});
	});
});
