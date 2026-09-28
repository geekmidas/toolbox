import { createCipheriv, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** What `gkm build` embeds, and the key a deploy provides. */
function encrypt(secrets: Record<string, string>) {
	const key = randomBytes(32);
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const ciphertext = Buffer.concat([
		cipher.update(JSON.stringify(secrets), 'utf-8'),
		cipher.final(),
	]);
	return {
		encrypted: Buffer.concat([ciphertext, cipher.getAuthTag()]).toString(
			'base64',
		),
		iv: iv.toString('hex'),
		masterKey: key.toString('hex'),
	};
}

type Globals = {
	__gkm_credentials__?: Record<string, string>;
	__GKM_ENCRYPTED_CREDENTIALS__?: string;
	__GKM_CREDENTIALS_IV__?: string;
};
const g = globalThis as Globals;

/** The real module, evaluated fresh against the current globals and env. */
async function load() {
	vi.resetModules();
	return (await import('../credentials')).Credentials;
}

describe('Credentials', () => {
	afterEach(() => {
		delete g.__gkm_credentials__;
		delete g.__GKM_ENCRYPTED_CREDENTIALS__;
		delete g.__GKM_CREDENTIALS_IV__;
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it('uses what gkm dev / exec injected, whatever else is set', async () => {
		g.__gkm_credentials__ = { API_KEY: 'from-preload' };
		g.__GKM_ENCRYPTED_CREDENTIALS__ = 'ignored';
		g.__GKM_CREDENTIALS_IV__ = 'ignored';

		expect(await load()).toEqual({ API_KEY: 'from-preload' });
	});

	it('is empty when nothing was embedded at build time', async () => {
		expect(await load()).toEqual({});
	});

	it('decrypts the embedded credentials with the master key', async () => {
		const { encrypted, iv, masterKey } = encrypt({ DB_URL: 'postgres://x' });
		g.__GKM_ENCRYPTED_CREDENTIALS__ = encrypted;
		g.__GKM_CREDENTIALS_IV__ = iv;
		vi.stubEnv('GKM_MASTER_KEY', masterKey);

		expect(await load()).toEqual({ DB_URL: 'postgres://x' });
	});

	it('warns and falls back to the environment without a master key', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { encrypted, iv } = encrypt({ DB_URL: 'x' });
		g.__GKM_ENCRYPTED_CREDENTIALS__ = encrypted;
		g.__GKM_CREDENTIALS_IV__ = iv;
		vi.stubEnv('GKM_MASTER_KEY', '');

		expect(await load()).toEqual({});
		expect(error.mock.calls.flat().join(' ')).toContain(
			'GKM_MASTER_KEY environment variable is required',
		);
	});

	it('warns and falls back when the key does not decrypt them', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { encrypted, iv } = encrypt({ DB_URL: 'x' });
		g.__GKM_ENCRYPTED_CREDENTIALS__ = encrypted;
		g.__GKM_CREDENTIALS_IV__ = iv;
		vi.stubEnv('GKM_MASTER_KEY', randomBytes(32).toString('hex'));

		expect(await load()).toEqual({});
		expect(error.mock.calls.flat().join(' ')).toContain(
			'Failed to decrypt credentials',
		);
	});
});
