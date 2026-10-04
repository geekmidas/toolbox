/**
 * The `kms://` cipher: envelope encryption under an AWS KMS key.
 *
 * Each `encrypt` asks KMS for a fresh data key, seals the plaintext with it
 * locally, and stores the data key *as KMS encrypted it* beside the data. The
 * plaintext data key is used once and dropped, and the master key never leaves
 * KMS — every decrypt is a KMS call IAM can refuse and CloudTrail records.
 *
 * Rotation is KMS's: it keeps every backing version of the key, and the
 * encrypted data key names the one that wrapped it, so nothing here tracks a
 * version and `reencrypt` has nothing to move. The ciphertext's key field is
 * `kms` for that reason.
 *
 * The blind index is a KMS HMAC key's `GenerateMac`: deterministic, and the
 * key is as unextractable as the encryption key.
 *
 * In its own module, loaded only when a URL says `kms://`, so a project that
 * never deploys to AWS never needs `@aws-sdk/client-kms` installed.
 */

import {
	DecryptCommand,
	GenerateDataKeyCommand,
	GenerateMacCommand,
	KMSClient,
} from '@aws-sdk/client-kms';
import {
	associatedData,
	type Cipher,
	CiphertextNotAuthentic,
	EncryptionUrlInvalid,
	formatCiphertext,
	open,
	parseCiphertext,
	seal,
} from './cipher';

/** The ciphertext's key field: the version lives inside KMS's own blob. */
const KMS_KEY_ID = 'kms';

export function kmsCipher(
	construct: string,
	url: string,
	client?: KMSClient,
): Cipher {
	const parsed = new URL(url);
	const region = parsed.hostname;
	const keyId = parsed.searchParams.get('key');
	const indexKeyId = parsed.searchParams.get('index');
	if (!region || !keyId || !indexKeyId) {
		throw new EncryptionUrlInvalid(
			construct,
			'a kms:// URL names a region, a key and an index key',
		);
	}

	const kms = client ?? new KMSClient({ region });
	// What KMS checks on every decrypt, and what CloudTrail shows each call was
	// for — a data key minted for one construct will not open for another.
	const context = { construct };
	const aad = associatedData(construct, KMS_KEY_ID);

	return {
		async encrypt(plaintext) {
			const dataKey = await kms.send(
				new GenerateDataKeyCommand({
					KeyId: keyId,
					KeySpec: 'AES_256',
					EncryptionContext: context,
				}),
			);
			const wrapped = Buffer.from(dataKey.CiphertextBlob!);
			const sealed = seal(
				Buffer.from(dataKey.Plaintext!),
				Buffer.from(plaintext, 'utf8'),
				aad,
			);

			const length = Buffer.alloc(2);
			length.writeUInt16BE(wrapped.length);
			return formatCiphertext(
				KMS_KEY_ID,
				Buffer.concat([length, wrapped, sealed]),
			);
		},

		async decrypt(ciphertext) {
			const { payload } = parseCiphertext(construct, ciphertext);
			const length = payload.length >= 2 ? payload.readUInt16BE(0) : 0;
			const wrapped = payload.subarray(2, 2 + length);
			if (!length || wrapped.length !== length) {
				throw new CiphertextNotAuthentic(construct);
			}

			const dataKey = await kms.send(
				new DecryptCommand({
					CiphertextBlob: wrapped,
					EncryptionContext: context,
				}),
			);
			const plaintext = open(
				Buffer.from(dataKey.Plaintext!),
				payload.subarray(2 + length),
				aad,
			);
			if (!plaintext) throw new CiphertextNotAuthentic(construct);

			return plaintext.toString('utf8');
		},

		async index(value) {
			const { Mac } = await kms.send(
				new GenerateMacCommand({
					KeyId: indexKeyId,
					MacAlgorithm: 'HMAC_SHA_256',
					Message: Buffer.from(value, 'utf8'),
				}),
			);
			return Buffer.from(Mac!).toString('base64url');
		},

		// KMS keeps every version it rotated through, so a value is never under
		// a key that could be retired from under it.
		async reencrypt(ciphertext) {
			parseCiphertext(construct, ciphertext);
			return ciphertext;
		},
	};
}
