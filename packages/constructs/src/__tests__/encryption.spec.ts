import { EnvironmentParser } from '@geekmidas/envkit';
import { describe, expect, it, vi } from 'vitest';
import {
	Encryption,
	generateKeyring,
	rotateKeyring,
	UnknownEncryptionScheme,
} from '../encryption';

const register = (construct: Encryption, env: Record<string, string>) =>
	construct.service.register({
		envParser: new EnvironmentParser(env),
		context: {} as never,
	});

describe('Encryption', () => {
	it('declares one URL, whose scheme picks the cipher', () => {
		expect(new Encryption('Pii').declare()).toEqual([
			{ kind: 'encryption', id: 'Pii', provides: ['PII_URL'] },
		]);
	});

	it('is a service named for the construct, so handlers reach services.pii', () => {
		expect(new Encryption('Pii').service.serviceName).toBe('pii');
	});

	it('encrypts, decrypts and indexes with the keyring it is given', async () => {
		const pii = await register(new Encryption('Pii'), {
			PII_URL: generateKeyring(),
		});

		const ciphertext = await pii.encrypt('ada@example.com');
		expect(await pii.decrypt(ciphertext)).toBe('ada@example.com');
		expect(await pii.index('ada@example.com')).toBe(
			await pii.index('ada@example.com'),
		);
	});

	it('builds its cipher once, however many registrations ask at once', async () => {
		const pii = new Encryption('Pii');
		const env = { PII_URL: generateKeyring() };

		const [a, b] = await Promise.all([register(pii, env), register(pii, env)]);

		expect(a).toBe(b);
	});

	it('says which old key a value is still under, once', async () => {
		const v1 = generateKeyring();
		const old = await (
			await register(new Encryption('Pii'), { PII_URL: v1 })
		).encrypt('stale');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		try {
			const pii = await register(new Encryption('Pii'), {
				PII_URL: rotateKeyring('Pii', v1),
			});
			await pii.decrypt(old);
			await pii.decrypt(old);

			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn.mock.calls[0]![0]).toContain("'k1' (current: 'k2')");
		} finally {
			warn.mockRestore();
		}
	});

	it('refuses a URL no cipher handles, naming the scheme', async () => {
		await expect(
			register(new Encryption('Pii'), { PII_URL: 'vault://somewhere' }),
		).rejects.toBeInstanceOf(UnknownEncryptionScheme);
	});
});
