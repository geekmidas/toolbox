/**
 * The cipher behind an `Encryption` construct, and the format it writes.
 *
 * Every ciphertext names the key that wrote it — `gkm1.<keyId>.<payload>` — so
 * `decrypt` never has to guess, a rotated key still opens what it wrote, and
 * retiring a key is a decision made against data rather than a hope. The
 * format version leads, so the day it has to change, both can be read.
 *
 * Two backends, picked by the scheme of the construct's URL, the way a queue's
 * connection string picks its broker:
 *
 * - `aes256gcm://` — a keyring this process holds: AES-256-GCM with the newest
 *   key, HMAC-SHA256 for the blind index. Local, test and server stages.
 * - `kms://` — envelope encryption under an AWS KMS key, and a KMS HMAC key for
 *   the index. The key material never leaves KMS. See `./kms`.
 */

import {
	createCipheriv,
	createDecipheriv,
	createHmac,
	randomBytes,
} from 'node:crypto';

/** What a handler is given: `services.pii.encrypt(…)` and the rest. */
export interface Cipher {
	/** Plaintext in, a self-describing ciphertext string out. */
	encrypt(plaintext: string): Promise<string>;
	/** Opens any ciphertext this construct wrote, under whichever key wrote it. */
	decrypt(ciphertext: string): Promise<string>;
	/**
	 * A blind index: the same value always gives the same string, so an
	 * encrypted column can still be looked up by an indexed column beside it.
	 *
	 * Deterministic on purpose, which is also why its key never rotates — a
	 * rotated index key would make every stored index miss.
	 */
	index(value: string): Promise<string>;
	/**
	 * The same plaintext under the current key — what a sweep runs over a
	 * column before an old key is retired. Unchanged when it is already current.
	 */
	reencrypt(ciphertext: string): Promise<string>;
}

/** The format every ciphertext leads with. */
export const CIPHERTEXT_VERSION = 'gkm1';

/** AES-256-GCM's nonce and tag, in bytes. */
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export const LOCAL_SCHEME = 'aes256gcm:';

export class EncryptionUrlInvalid extends Error {
	constructor(
		readonly construct: string,
		readonly reason: string,
	) {
		super(
			`${construct}'s encryption URL is not usable: ${reason}. gkm composes it — derived locally, generated into a server stage's secrets on its first deploy, provisioned on AWS — so it should not be set by hand.`,
		);
		this.name = 'EncryptionUrlInvalid';
	}
}

export class UnknownEncryptionScheme extends Error {
	constructor(
		readonly construct: string,
		readonly scheme: string,
	) {
		super(
			`${construct}'s encryption URL uses '${scheme}', which no cipher handles. Expected 'aes256gcm:' (a local keyring) or 'kms:' (AWS KMS).`,
		);
		this.name = 'UnknownEncryptionScheme';
	}
}

export class CiphertextMalformed extends Error {
	constructor(readonly construct: string) {
		super(
			`${construct} was asked to decrypt something it did not write: a ciphertext starts '${CIPHERTEXT_VERSION}.<key>.'. Check the column holds what \`encrypt\` returned, untrimmed.`,
		);
		this.name = 'CiphertextMalformed';
	}
}

export class EncryptionKeyRetired extends Error {
	constructor(
		readonly construct: string,
		readonly keyId: string,
	) {
		super(
			`${construct} has no key '${keyId}' any more, so a value it wrote cannot be read. It was retired before every value was re-encrypted; restore it from the stage's secrets history, run the sweep, then retire it again.`,
		);
		this.name = 'EncryptionKeyRetired';
	}
}

export class CiphertextNotAuthentic extends Error {
	constructor(readonly construct: string) {
		super(
			`${construct} could not authenticate a ciphertext: it was altered, or written by a different Encryption construct. Ciphertexts are bound to the construct that wrote them.`,
		);
		this.name = 'CiphertextNotAuthentic';
	}
}

export class CurrentKeyCannotRetire extends Error {
	constructor(
		readonly construct: string,
		readonly keyId: string,
	) {
		super(
			`'${keyId}' is ${construct}'s current key — everything new is written with it. Rotate first, sweep, then retire '${keyId}'.`,
		);
		this.name = 'CurrentKeyCannotRetire';
	}
}

/** A ciphertext's three parts. */
export function parseCiphertext(
	construct: string,
	ciphertext: string,
): { keyId: string; payload: Buffer } {
	const [version, keyId, payload, ...rest] = ciphertext.split('.');
	if (version !== CIPHERTEXT_VERSION || !keyId || !payload || rest.length) {
		throw new CiphertextMalformed(construct);
	}
	return { keyId, payload: Buffer.from(payload, 'base64url') };
}

export function formatCiphertext(keyId: string, payload: Buffer): string {
	return `${CIPHERTEXT_VERSION}.${keyId}.${payload.toString('base64url')}`;
}

/**
 * What the cipher authenticates alongside the data: the construct and the key.
 *
 * Binding the construct means a value copied from one `Encryption` into
 * another's column fails instead of decrypting under the wrong policy.
 */
export function associatedData(construct: string, keyId: string): Buffer {
	return Buffer.from(`${CIPHERTEXT_VERSION}:${construct}:${keyId}`);
}

/** `iv | tag | ciphertext`, under one AES-256-GCM key. */
export function seal(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	cipher.setAAD(aad);
	const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

/** The inverse of {@link seal}; `undefined` when it does not authenticate. */
export function open(
	key: Buffer,
	sealed: Buffer,
	aad: Buffer,
): Buffer | undefined {
	if (sealed.length < IV_BYTES + TAG_BYTES) return undefined;

	const decipher = createDecipheriv(
		'aes-256-gcm',
		key,
		sealed.subarray(0, IV_BYTES),
	);
	decipher.setAAD(aad);
	decipher.setAuthTag(sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));

	try {
		return Buffer.concat([
			decipher.update(sealed.subarray(IV_BYTES + TAG_BYTES)),
			decipher.final(),
		]);
	} catch {
		return undefined;
	}
}

/** A local keyring: newest key first, and the index key that never rotates. */
export interface Keyring {
	keys: { id: string; key: Buffer }[];
	index: Buffer;
}

/** Parse `aes256gcm://local?keys=k2.<key>,k1.<key>&index=<key>`. */
export function parseKeyring(construct: string, url: string): Keyring {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new EncryptionUrlInvalid(construct, 'it is not a URL');
	}

	const keys = (parsed.searchParams.get('keys') ?? '')
		.split(',')
		.filter(Boolean)
		.map((entry) => {
			const [id, encoded] = entry.split('.');
			const key = Buffer.from(encoded ?? '', 'base64url');
			if (!id || key.length !== KEY_BYTES) {
				throw new EncryptionUrlInvalid(
					construct,
					`'${id ?? entry}' is not a 256-bit key`,
				);
			}
			return { id, key };
		});
	if (keys.length === 0) {
		throw new EncryptionUrlInvalid(construct, 'it holds no keys');
	}

	const index = Buffer.from(
		parsed.searchParams.get('index') ?? '',
		'base64url',
	);
	if (index.length !== KEY_BYTES) {
		throw new EncryptionUrlInvalid(construct, 'its index key is missing');
	}

	return { keys, index };
}

export function formatKeyring(keyring: Keyring): string {
	const keys = keyring.keys
		.map(({ id, key }) => `${id}.${key.toString('base64url')}`)
		.join(',');
	return `${LOCAL_SCHEME}//local?keys=${keys}&index=${keyring.index.toString('base64url')}`;
}

/** A keyring with one fresh key, `k1`, and a fresh index key. */
export function generateKeyring(): string {
	return formatKeyring({
		keys: [{ id: 'k1', key: randomBytes(KEY_BYTES) }],
		index: randomBytes(KEY_BYTES),
	});
}

/**
 * The keyring with a new current key in front, and every older one kept.
 *
 * Nothing is dropped: what the old keys wrote still has to open until a sweep
 * has re-encrypted it — see {@link retireKey}.
 */
export function rotateKeyring(construct: string, url: string): string {
	const keyring = parseKeyring(construct, url);
	const next =
		Math.max(...keyring.keys.map(({ id }) => Number(id.slice(1)) || 0)) + 1;

	return formatKeyring({
		...keyring,
		keys: [{ id: `k${next}`, key: randomBytes(KEY_BYTES) }, ...keyring.keys],
	});
}

/** The keyring without `keyId`, which must not be the current key. */
export function retireKey(
	construct: string,
	url: string,
	keyId: string,
): string {
	const keyring = parseKeyring(construct, url);
	if (keyring.keys[0]?.id === keyId) {
		throw new CurrentKeyCannotRetire(construct, keyId);
	}
	if (!keyring.keys.some(({ id }) => id === keyId)) {
		throw new EncryptionKeyRetired(construct, keyId);
	}

	return formatKeyring({
		...keyring,
		keys: keyring.keys.filter(({ id }) => id !== keyId),
	});
}

/** Says, once per key per process, that a value is still under an old key. */
export type StaleKeyReporter = (keyId: string, current: string) => void;

/** The `aes256gcm://` cipher: a keyring held in process. */
export function keyringCipher(
	construct: string,
	url: string,
	onStaleKey: StaleKeyReporter = () => {},
): Cipher {
	const keyring = parseKeyring(construct, url);
	const current = keyring.keys[0]!;
	const byId = new Map(keyring.keys.map(({ id, key }) => [id, key]));
	const reported = new Set<string>();

	const decrypt = async (ciphertext: string) => {
		const { keyId, payload } = parseCiphertext(construct, ciphertext);
		const key = byId.get(keyId);
		if (!key) throw new EncryptionKeyRetired(construct, keyId);

		const plaintext = open(key, payload, associatedData(construct, keyId));
		if (!plaintext) throw new CiphertextNotAuthentic(construct);

		if (keyId !== current.id && !reported.has(keyId)) {
			reported.add(keyId);
			onStaleKey(keyId, current.id);
		}

		return plaintext.toString('utf8');
	};

	const encrypt = async (plaintext: string) =>
		formatCiphertext(
			current.id,
			seal(
				current.key,
				Buffer.from(plaintext, 'utf8'),
				associatedData(construct, current.id),
			),
		);

	return {
		encrypt,
		decrypt,
		index: async (value) =>
			createHmac('sha256', keyring.index)
				.update(value, 'utf8')
				.digest('base64url'),
		reencrypt: async (ciphertext) => {
			const { keyId } = parseCiphertext(construct, ciphertext);
			if (keyId === current.id) return ciphertext;
			return encrypt(await decrypt(ciphertext));
		},
	};
}
