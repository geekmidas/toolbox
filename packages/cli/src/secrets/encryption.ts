import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { EmbeddableSecrets, EncryptedPayload } from './types';

/** AES-256-GCM configuration */
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Encrypt secrets for embedding in a bundle.
 * Uses AES-256-GCM with a randomly generated ephemeral key.
 *
 * @param secrets - Key-value pairs to encrypt
 * @returns Encrypted payload with ephemeral master key
 */
export function encryptSecrets(secrets: EmbeddableSecrets): EncryptedPayload {
	// Generate ephemeral key and IV
	const masterKey = randomBytes(KEY_LENGTH);
	const iv = randomBytes(IV_LENGTH);

	// Serialize secrets to JSON
	const plaintext = JSON.stringify(secrets);

	// Encrypt
	const cipher = createCipheriv(ALGORITHM, masterKey, iv);
	const ciphertext = Buffer.concat([
		cipher.update(plaintext, 'utf-8'),
		cipher.final(),
	]);

	// Get auth tag
	const authTag = cipher.getAuthTag();

	// Combine ciphertext + auth tag
	const combined = Buffer.concat([ciphertext, authTag]);

	return {
		encrypted: combined.toString('base64'),
		iv: iv.toString('hex'),
		masterKey: masterKey.toString('hex'),
	};
}

/**
 * Decrypt secrets from an encrypted payload.
 * Used at runtime to decrypt embedded credentials.
 *
 * @param encrypted - Base64 encoded ciphertext + auth tag
 * @param iv - Hex encoded IV
 * @param masterKey - Hex encoded master key
 * @returns Decrypted secrets
 */
export function decryptSecrets(
	encrypted: string,
	iv: string,
	masterKey: string,
): EmbeddableSecrets {
	// Decode inputs
	const key = Buffer.from(masterKey, 'hex');
	const ivBuffer = Buffer.from(iv, 'hex');
	const combined = Buffer.from(encrypted, 'base64');

	// Split ciphertext and auth tag
	const ciphertext = combined.subarray(0, -AUTH_TAG_LENGTH);
	const authTag = combined.subarray(-AUTH_TAG_LENGTH);

	// Decrypt
	const decipher = createDecipheriv(ALGORITHM, key, ivBuffer);
	decipher.setAuthTag(authTag);

	const plaintext = Buffer.concat([
		decipher.update(ciphertext),
		decipher.final(),
	]);

	return JSON.parse(plaintext.toString('utf-8')) as EmbeddableSecrets;
}

/**
 * Generate the define options for tsdown/esbuild.
 * These will be injected at build time.
 */
export function generateDefineOptions(
	payload: EncryptedPayload,
): Record<string, string> {
	return {
		__GKM_ENCRYPTED_CREDENTIALS__: JSON.stringify(payload.encrypted),
		__GKM_CREDENTIALS_IV__: JSON.stringify(payload.iv),
	};
}
