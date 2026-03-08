import { createDecipheriv } from 'node:crypto';

/**
 * Build-time injected encrypted credentials.
 * These are replaced by tsdown/esbuild --define at build time.
 */
declare const __GKM_ENCRYPTED_CREDENTIALS__: string | undefined;
declare const __GKM_CREDENTIALS_IV__: string | undefined;

/** AES-256-GCM auth tag length */
const AUTH_TAG_LENGTH = 16;

/**
 * Decrypt credentials from encrypted payload.
 * Exported for testing purposes.
 */
export function decryptCredentials(
	encrypted: string,
	iv: string,
	masterKey: string,
): Record<string, string> {
	const key = Buffer.from(masterKey, 'hex');
	const ivBuffer = Buffer.from(iv, 'hex');
	const combined = Buffer.from(encrypted, 'base64');

	// Split ciphertext and auth tag
	const ciphertext = combined.subarray(0, -AUTH_TAG_LENGTH);
	const authTag = combined.subarray(-AUTH_TAG_LENGTH);

	// Decrypt using AES-256-GCM
	const decipher = createDecipheriv('aes-256-gcm', key, ivBuffer);
	decipher.setAuthTag(authTag);

	const plaintext = Buffer.concat([
		decipher.update(ciphertext),
		decipher.final(),
	]);

	return JSON.parse(plaintext.toString('utf-8'));
}

/**
 * Credentials object for use with EnvironmentParser.
 *
 * Resolution order:
 * 1. **Dev mode (gkm dev/exec)**: Checks `globalThis.__gkm_credentials__` for
 *    credentials injected by the CLI preload script. This approach survives
 *    CJS/ESM module duplication (where mutating the export would only affect one copy).
 * 2. **Production mode**: Decrypts build-time embedded credentials using the
 *    `GKM_MASTER_KEY` environment variable (AES-256-GCM).
 * 3. **Fallback**: Returns empty object (allows graceful fallback to process.env).
 *
 * @example
 * ```typescript
 * import { EnvironmentParser } from '@geekmidas/envkit';
 * import { Credentials } from '@geekmidas/envkit/credentials';
 *
 * export const envParser = new EnvironmentParser({...process.env, ...Credentials})
 *   .create((get) => ({
 *     database: {
 *       url: get('DATABASE_URL').string(),
 *     },
 *   }))
 *   .parse();
 * ```
 */
export const Credentials: Record<string, string> = (() => {
	// Dev mode: check if gkm exec/dev preload injected credentials via globalThis
	// This survives CJS/ESM module duplication where Object.assign on the
	// export would only mutate one copy of the module's Credentials object.
	const injected = (globalThis as Record<string, unknown>)
		.__gkm_credentials__ as Record<string, string> | undefined;
	if (injected) {
		return injected;
	}

	// Development mode - no credentials embedded at build time
	if (
		typeof __GKM_ENCRYPTED_CREDENTIALS__ === 'undefined' ||
		typeof __GKM_CREDENTIALS_IV__ === 'undefined'
	) {
		return {};
	}

	// Production mode - decrypt credentials using master key
	const masterKey = process.env.GKM_MASTER_KEY;

	if (!masterKey) {
		// Log warning but don't throw - allows graceful fallback to env vars
		console.error(
			'[gkm] GKM_MASTER_KEY environment variable is required to decrypt credentials.',
		);
		console.error(
			'[gkm] Falling back to environment variables. Some secrets may be missing.',
		);
		return {};
	}

	try {
		return decryptCredentials(
			__GKM_ENCRYPTED_CREDENTIALS__,
			__GKM_CREDENTIALS_IV__,
			masterKey,
		);
	} catch (error) {
		console.error('[gkm] Failed to decrypt credentials:', error);
		console.error('[gkm] Falling back to environment variables.');
		return {};
	}
})();

export default Credentials;
