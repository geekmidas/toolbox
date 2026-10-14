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
	type CipherDriver,
	keyringCipher,
	LOCAL_SCHEME,
	UnknownEncryptionScheme,
} from './encryption/cipher';

export type { Cipher, CipherDriver } from './encryption/cipher';
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

const drivers = new Map<string, CipherDriver>();

/** Make a cipher available for its scheme. Idempotent. */
export function registerCipherDriver(driver: CipherDriver): void {
	drivers.set(driver.scheme, driver);
}

/**
 * A key whose URL names a cipher this process registered no driver for —
 * `kms:` in an entry built for a target whose keys are local.
 */
export class UnregisteredEncryptionScheme extends Error {
	constructor(
		readonly construct: string,
		readonly scheme: string,
	) {
		super(
			`${construct}'s key is a '${scheme}' URL, and this build registered no cipher for it. ` +
				(scheme === KMS_SCHEME
					? "A KMS key is an AWS target's: build for it (gkm build --provider aws), which registers the KMS cipher and needs @aws-sdk/client-kms installed."
					: 'Register its driver with registerCipherDriver before the first request.'),
		);
		this.name = 'UnregisteredEncryptionScheme';
	}
}

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

		// Registered by the entry a build generates, only for a target whose
		// keys live there — so no other process imports that cipher's SDK.
		const driver = drivers.get(scheme);
		if (driver) return driver.open(this.id, url);
		if (scheme === KMS_SCHEME) {
			throw new UnregisteredEncryptionScheme(this.id, scheme);
		}

		throw new UnknownEncryptionScheme(this.id, scheme);
	}
}
