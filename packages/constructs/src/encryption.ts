/**
 * `Encryption` — a key that encrypts what the application stores.
 *
 * ```ts
 * export const pii = new Encryption('Pii');
 *
 * // an endpoint that `.dependsOn([pii])`
 * const email = await services.pii.encrypt(body.email);
 * const emailIndex = await services.pii.index(body.email);
 * await db.insertInto('users').values({ email, emailIndex }).execute();
 *
 * // and to find them again, without decrypting a column
 * db.selectFrom('users').where('emailIndex', '=', await services.pii.index(q));
 * ```
 *
 * The app names no cipher and holds no key. The construct provides one URL,
 * `<ID>_URL`, and its scheme picks the backend the way a queue's connection
 * string picks its broker:
 *
 * - **AWS** — `kms://`: envelope encryption under a KMS key that rotates
 *   yearly, and a KMS HMAC key for the index. Only a function that depends on
 *   the construct is granted either key.
 * - **Server, local, tests** — `aes256gcm://`: a keyring the process holds.
 *   Derived locally, so `gkm dev` and `gkm test` need nothing set; generated
 *   into a server stage's secrets on its first deploy, and rotated there with
 *   `gkm encryption:rotate`.
 *
 * Every ciphertext names the key that wrote it, so a rotated key still opens
 * what it wrote. Retiring one is explicit — `reencrypt` the column, then
 * `gkm encryption:retire` — and a value still under an old key says so when it
 * is decrypted, once per key per process.
 */

import {
	type ConstructName,
	canonicalId,
	type Declaration,
	KMS_SCHEME,
	provideKey,
	serviceKey,
} from '@geekmidas/manifest';
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import type { Construct } from './construct-interface';
import {
	type Cipher,
	keyringCipher,
	LOCAL_SCHEME,
	UnknownEncryptionScheme,
} from './encryption/cipher';

export type { Cipher } from './encryption/cipher';
export {
	CiphertextMalformed,
	CiphertextNotAuthentic,
	CurrentKeyCannotRetire,
	EncryptionKeyRetired,
	EncryptionUrlInvalid,
	formatKeyring,
	generateKeyring,
	type Keyring,
	keyringCipher,
	parseKeyring,
	retireKey,
	rotateKeyring,
	UnknownEncryptionScheme,
} from './encryption/cipher';

export class Encryption<TName extends string = string>
	implements Construct<TName, Cipher>
{
	readonly id: TName;
	readonly service: Service<Uncapitalize<TName>, Cipher>;

	/**
	 * Declared once and read by both `declare()` and `connect()`, so the key the
	 * target publishes and the key the client reads cannot drift.
	 */
	private readonly key: string;

	/**
	 * One cipher per process, held as the promise: a keyring is parsed once and
	 * a KMS client is built once, however many handlers register it at once.
	 */
	private cipher?: Promise<Cipher>;

	constructor(id: ConstructName<TName>) {
		const canonical = canonicalId(id as string);

		this.id = canonical as TName;
		this.key = provideKey(canonical, 'url');

		// A field, not a getter: consumers cache services by object identity.
		this.service = {
			serviceName: serviceKey(canonical) as Uncapitalize<TName>,
			register: (options) => this.connect(options),
		};
	}

	declare(): Declaration[] {
		return [{ kind: 'encryption', id: this.id, provides: [this.key] }];
	}

	private connect(options: ServiceRegisterOptions): Promise<Cipher> {
		this.cipher ??= this.open(options);
		return this.cipher;
	}

	private async open(options: ServiceRegisterOptions): Promise<Cipher> {
		const { url } = options.envParser
			.create((get) => ({ url: get(this.key).string() }))
			.parse();
		const scheme = url.slice(0, url.indexOf(':') + 1);

		if (scheme === LOCAL_SCHEME) {
			return keyringCipher(this.id, url, (stale, current) =>
				console.warn(
					`${this.id} decrypted a value still under '${stale}' (current: '${current}'). reencrypt it, and retire '${stale}' once nothing is left under it.`,
				),
			);
		}

		if (scheme === KMS_SCHEME) {
			// Loaded only here, so a project that never deploys to AWS never
			// needs `@aws-sdk/client-kms` installed.
			const { kmsCipher } = await import('./encryption/kms');
			return kmsCipher(this.id, url);
		}

		throw new UnknownEncryptionScheme(this.id, scheme);
	}
}
