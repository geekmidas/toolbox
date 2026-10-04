import { describe, expect, it, vi } from 'vitest';
import {
	CiphertextMalformed,
	CiphertextNotAuthentic,
	CurrentKeyCannotRetire,
	EncryptionKeyRetired,
	EncryptionUrlInvalid,
	generateKeyring,
	keyringCipher,
	parseKeyring,
	retireKey,
	rotateKeyring,
} from '../cipher';

describe('the local keyring cipher', () => {
	it('round-trips, and never writes the same ciphertext twice', async () => {
		const pii = keyringCipher('Pii', generateKeyring());

		const first = await pii.encrypt('ada@example.com');
		const second = await pii.encrypt('ada@example.com');

		expect(first).not.toBe(second);
		expect(first).toMatch(/^gkm1\.k1\./);
		expect(await pii.decrypt(first)).toBe('ada@example.com');
		expect(await pii.decrypt(second)).toBe('ada@example.com');
	});

	it('handles text that is not ASCII, and the empty string', async () => {
		const pii = keyringCipher('Pii', generateKeyring());

		for (const value of ['Ñandú 🦤 — 東京', '']) {
			expect(await pii.decrypt(await pii.encrypt(value))).toBe(value);
		}
	});

	it('gives a stable blind index, keyed so it cannot be recomputed without the key', async () => {
		const url = generateKeyring();
		const pii = keyringCipher('Pii', url);

		expect(await pii.index('ada@example.com')).toBe(
			await pii.index('ada@example.com'),
		);
		expect(await pii.index('ada@example.com')).not.toBe(
			await pii.index('bob@example.com'),
		);
		// Another keyring's index for the same value is unrelated.
		expect(
			await keyringCipher('Pii', generateKeyring()).index('ada@example.com'),
		).not.toBe(await pii.index('ada@example.com'));
	});

	it('refuses a ciphertext that was altered', async () => {
		const pii = keyringCipher('Pii', generateKeyring());
		const ciphertext = await pii.encrypt('secret');
		const [version, keyId, payload] = ciphertext.split('.');
		const bytes = Buffer.from(payload!, 'base64url');
		bytes[bytes.length - 1]! ^= 1;

		await expect(
			pii.decrypt(`${version}.${keyId}.${bytes.toString('base64url')}`),
		).rejects.toBeInstanceOf(CiphertextNotAuthentic);
	});

	it('refuses a ciphertext another construct wrote, even under the same keys', async () => {
		const url = generateKeyring();
		const written = await keyringCipher('Pii', url).encrypt('secret');

		await expect(
			keyringCipher('Billing', url).decrypt(written),
		).rejects.toBeInstanceOf(CiphertextNotAuthentic);
	});

	it('says what it was given when it is not a ciphertext', async () => {
		const pii = keyringCipher('Pii', generateKeyring());

		await expect(pii.decrypt('ada@example.com')).rejects.toBeInstanceOf(
			CiphertextMalformed,
		);
	});

	it('refuses a URL that holds no usable key', () => {
		expect(() => parseKeyring('Pii', 'not a url')).toThrow(
			EncryptionUrlInvalid,
		);
		expect(() =>
			parseKeyring('Pii', 'aes256gcm://local?keys=k1.c2hvcnQ&index=x'),
		).toThrow(/k1/);
	});
});

describe('rotating and retiring', () => {
	it('writes with the new key and still opens what the old one wrote', async () => {
		const v1 = generateKeyring();
		const old = await keyringCipher('Pii', v1).encrypt('kept');

		const v2 = rotateKeyring('Pii', v1);
		const pii = keyringCipher('Pii', v2);

		expect(await pii.encrypt('new')).toMatch(/^gkm1\.k2\./);
		expect(await pii.decrypt(old)).toBe('kept');
	});

	it('keeps the index key, so stored indexes still match', async () => {
		const v1 = generateKeyring();
		const before = await keyringCipher('Pii', v1).index('ada@example.com');

		const after = await keyringCipher('Pii', rotateKeyring('Pii', v1)).index(
			'ada@example.com',
		);

		expect(after).toBe(before);
	});

	it('moves a value onto the current key, and leaves a current one alone', async () => {
		const v1 = generateKeyring();
		const old = await keyringCipher('Pii', v1).encrypt('moved');
		const pii = keyringCipher('Pii', rotateKeyring('Pii', v1));

		const moved = await pii.reencrypt(old);
		expect(moved).toMatch(/^gkm1\.k2\./);
		expect(await pii.decrypt(moved)).toBe('moved');
		expect(await pii.reencrypt(moved)).toBe(moved);
	});

	it('reports a value still under an old key, once per key', async () => {
		const v1 = generateKeyring();
		const old = await keyringCipher('Pii', v1).encrypt('stale');
		const stale = vi.fn();
		const pii = keyringCipher('Pii', rotateKeyring('Pii', v1), stale);

		await pii.decrypt(old);
		await pii.decrypt(old);

		expect(stale).toHaveBeenCalledTimes(1);
		expect(stale).toHaveBeenCalledWith('k1', 'k2');
	});

	it('retires an old key, after which what it wrote no longer opens', async () => {
		const v1 = generateKeyring();
		const old = await keyringCipher('Pii', v1).encrypt('gone');
		const v3 = retireKey('Pii', rotateKeyring('Pii', v1), 'k1');

		expect(parseKeyring('Pii', v3).keys.map(({ id }) => id)).toEqual(['k2']);
		await expect(keyringCipher('Pii', v3).decrypt(old)).rejects.toBeInstanceOf(
			EncryptionKeyRetired,
		);
	});

	it('will not retire the current key', () => {
		expect(() => retireKey('Pii', generateKeyring(), 'k1')).toThrow(
			CurrentKeyCannotRetire,
		);
	});

	it('numbers past the highest key, however many were retired', () => {
		let url = generateKeyring();
		for (let i = 0; i < 3; i++) url = rotateKeyring('Pii', url);
		url = retireKey('Pii', retireKey('Pii', url, 'k1'), 'k2');

		expect(
			parseKeyring('Pii', rotateKeyring('Pii', url)).keys.map(({ id }) => id),
		).toEqual(['k5', 'k4', 'k3']);
	});
});
