import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { getOrCreateKey, readKey } from './keystore';
import type { SecretsStore } from './store.js';
import type { StageSecrets } from './types';

/** Where the files live, relative to the project root. */
const SECRETS_DIR = '.gkm/secrets';

/** AES-256-GCM configuration */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

/** Encrypted secrets file structure */
interface EncryptedSecretsFile {
	/** Version for future format changes */
	version: 1;
	/** Base64 encoded encrypted data (ciphertext + auth tag) */
	encrypted: string;
	/** Hex encoded IV */
	iv: string;
}

/**
 * A stage's secrets as an encrypted file on this machine:
 * `.gkm/secrets/<stage>.json`, with its key at `~/.gkm/<project>/<stage>.key`.
 *
 * The local stage's store, always — its secrets belong to the machine running
 * `gkm dev` — and a deployed stage's when `secrets.store` is `'file'`.
 */
export class FileSecretsStore implements SecretsStore {
	readonly name = 'file';

	constructor(private readonly root: string) {}

	/** The file a stage's secrets are kept in. */
	path(stage: string): string {
		return join(this.root, SECRETS_DIR, `${stage}.json`);
	}

	async read(stage: string): Promise<StageSecrets | null> {
		const path = this.path(stage);
		if (!existsSync(path)) return null;

		const data = JSON.parse(await readFile(path, 'utf-8'));

		// Legacy: unencrypted format (for backwards compatibility)
		if (!(data.version === 1 && data.encrypted && data.iv)) {
			return data as StageSecrets;
		}

		const project = basename(this.root);
		const key = await readKey(stage, project);
		if (!key) throw new MissingSecretsKey(stage, project);

		return decrypt(data as EncryptedSecretsFile, key);
	}

	async write(stage: string, secrets: StageSecrets): Promise<void> {
		await mkdir(join(this.root, SECRETS_DIR), { recursive: true });

		const key = await getOrCreateKey(stage, basename(this.root));
		await writeFile(
			this.path(stage),
			JSON.stringify(encrypt(secrets, key), null, 2),
			'utf-8',
		);
	}
}

/** A stage's secrets file exists, and the key that opens it does not. */
export class MissingSecretsKey extends Error {
	constructor(
		readonly stage: string,
		readonly project: string,
	) {
		super(
			`Decryption key not found for stage "${stage}". ` +
				`Expected key at: ~/.gkm/${project}/${stage}.key`,
		);
		this.name = 'MissingSecretsKey';
	}
}

function encrypt(secrets: StageSecrets, keyHex: string): EncryptedSecretsFile {
	const key = Buffer.from(keyHex, 'hex');
	const iv = randomBytes(IV_LENGTH);

	const cipher = createCipheriv(ALGORITHM, key, iv);
	const ciphertext = Buffer.concat([
		cipher.update(JSON.stringify(secrets), 'utf-8'),
		cipher.final(),
	]);

	// Ciphertext and auth tag, together
	const combined = Buffer.concat([ciphertext, cipher.getAuthTag()]);

	return {
		version: 1,
		encrypted: combined.toString('base64'),
		iv: iv.toString('hex'),
	};
}

function decrypt(data: EncryptedSecretsFile, keyHex: string): StageSecrets {
	const key = Buffer.from(keyHex, 'hex');
	const combined = Buffer.from(data.encrypted, 'base64');

	const decipher = createDecipheriv(
		ALGORITHM,
		key,
		Buffer.from(data.iv, 'hex'),
	);
	decipher.setAuthTag(combined.subarray(-AUTH_TAG_LENGTH));

	const plaintext = Buffer.concat([
		decipher.update(combined.subarray(0, -AUTH_TAG_LENGTH)),
		decipher.final(),
	]);

	return JSON.parse(plaintext.toString('utf-8')) as StageSecrets;
}
