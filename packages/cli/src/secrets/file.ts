import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { GkmError } from '../errors';
import {
	getKeyPath,
	getOrCreateKey,
	type KeystoreProject,
	projectKey,
	readKey,
} from './keystore';
import type { SecretsStore } from './store.js';
import type { StageSecrets } from './types';

/** Where the files live, relative to the project root. */
const SECRETS_DIR = '.gkm/secrets';

/** AES-256-GCM configuration */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

/** Encrypted secrets file structure */
export interface EncryptedSecretsFile {
	/** Version for future format changes */
	version: 1;
	/** Base64 encoded encrypted data (ciphertext + auth tag) */
	encrypted: string;
	/** Hex encoded IV */
	iv: string;
}

/**
 * A stage's secrets as an encrypted file on this machine:
 * `.gkm/secrets/<stage>.json`, with its key in the CLI's home at
 * `keys/<namespace>/<project>/<stage>.key`.
 *
 * The local stage's store, always — its secrets belong to the machine running
 * `gkm dev` — and a deployed stage's when `secrets.store` is `'file'`.
 */
export class FileSecretsStore implements SecretsStore {
	readonly name = 'file';
	private readonly project: KeystoreProject;

	/**
	 * @param project - Whose keys: a workspace's `keystoreProject()`. Outside a
	 *   workspace there is no config to name the project, so it is named the
	 *   way a workspace without `name` is — its package name, else its folder.
	 */
	constructor(
		private readonly root: string,
		project?: KeystoreProject,
	) {
		this.project = project ?? {
			key: projectKey({ name: packageName(root) ?? basename(root) }),
			legacy: [basename(root)],
		};
	}

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

		const key = await readKey(stage, this.project);
		if (!key) {
			throw new MissingSecretsKey(
				stage,
				this.project.key,
				getKeyPath(stage, this.project),
			);
		}

		return decrypt(data as EncryptedSecretsFile, key);
	}

	async write(stage: string, secrets: StageSecrets): Promise<void> {
		await mkdir(join(this.root, SECRETS_DIR), { recursive: true });

		const key = await getOrCreateKey(stage, this.project);
		await writeFile(
			this.path(stage),
			JSON.stringify(encrypt(secrets, key), null, 2),
			'utf-8',
		);
	}
}

/** A stage's secrets file exists, and the key that opens it does not. */
export class MissingSecretsKey extends GkmError {
	constructor(
		readonly stage: string,
		readonly project: string,
		readonly path: string,
	) {
		super(
			`Decryption key not found for stage "${stage}". ` +
				`Expected key at: ${path}. Copy the stage's key there from whoever created it, or set secrets.store to a store this machine can reach.`,
		);
		this.name = 'MissingSecretsKey';
	}
}

/** A project's package name without its scope, as a workspace name reads it. */
function packageName(root: string): string | undefined {
	try {
		const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
		return typeof pkg.name === 'string'
			? pkg.name.replace(/^@[^/]+\//, '')
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * Encrypt a JSON value with a stage key: AES-256-GCM, the file format every
 * stage's secrets are kept in.
 */
export function encrypt(
	secrets: unknown,
	keyHex: string,
): EncryptedSecretsFile {
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

/** Decrypt what {@link encrypt} wrote. */
export function decrypt<T = StageSecrets>(
	data: EncryptedSecretsFile,
	keyHex: string,
): T {
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

	return JSON.parse(plaintext.toString('utf-8')) as T;
}
