import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { getOrCreateKey, readKey } from './keystore';
import type { EmbeddableSecrets, StageSecrets } from './types';

/** Default secrets directory relative to project root */
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
 * Get the secrets directory path.
 */
export function getSecretsDir(cwd = process.cwd()): string {
	return join(cwd, SECRETS_DIR);
}

/**
 * Get the secrets file path for a stage.
 */
export function getSecretsPath(stage: string, cwd = process.cwd()): string {
	return join(getSecretsDir(cwd), `${stage}.json`);
}

/**
 * Check if secrets exist for a stage.
 */
export function secretsExist(stage: string, cwd = process.cwd()): boolean {
	return existsSync(getSecretsPath(stage, cwd));
}

/**
 * Initialize an empty StageSecrets object for a stage.
 */
export function initStageSecrets(stage: string): StageSecrets {
	const now = new Date().toISOString();
	return {
		stage,
		createdAt: now,
		updatedAt: now,
		services: {},
		urls: {},
		custom: {},
	};
}

/**
 * Encrypt secrets using a key.
 */
function encryptSecretsData(
	secrets: StageSecrets,
	keyHex: string,
): EncryptedSecretsFile {
	const key = Buffer.from(keyHex, 'hex');
	const iv = randomBytes(IV_LENGTH);

	// Serialize secrets to JSON
	const plaintext = JSON.stringify(secrets);

	// Encrypt
	const cipher = createCipheriv(ALGORITHM, key, iv);
	const ciphertext = Buffer.concat([
		cipher.update(plaintext, 'utf-8'),
		cipher.final(),
	]);

	// Get auth tag
	const authTag = cipher.getAuthTag();

	// Combine ciphertext + auth tag
	const combined = Buffer.concat([ciphertext, authTag]);

	return {
		version: 1,
		encrypted: combined.toString('base64'),
		iv: iv.toString('hex'),
	};
}

/**
 * Decrypt secrets using a key.
 */
function decryptSecretsData(
	data: EncryptedSecretsFile,
	keyHex: string,
): StageSecrets {
	const key = Buffer.from(keyHex, 'hex');
	const ivBuffer = Buffer.from(data.iv, 'hex');
	const combined = Buffer.from(data.encrypted, 'base64');

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

	return JSON.parse(plaintext.toString('utf-8')) as StageSecrets;
}

/**
 * Read secrets for a stage (encrypted).
 * Requires the decryption key to be present at ~/.gkm/{project}/{stage}.key
 *
 * @returns StageSecrets or null if not found
 */
export async function readStageSecrets(
	stage: string,
	cwd = process.cwd(),
): Promise<StageSecrets | null> {
	const path = getSecretsPath(stage, cwd);

	if (!existsSync(path)) {
		return null;
	}

	const content = await readFile(path, 'utf-8');
	const data = JSON.parse(content);

	// Check if this is an encrypted file (has version field)
	if (data.version === 1 && data.encrypted && data.iv) {
		const projectName = basename(cwd);
		const key = await readKey(stage, projectName);

		if (!key) {
			throw new Error(
				`Decryption key not found for stage "${stage}". ` +
					`Expected key at: ~/.gkm/${projectName}/${stage}.key`,
			);
		}

		return decryptSecretsData(data as EncryptedSecretsFile, key);
	}

	// Legacy: unencrypted format (for backwards compatibility)
	return data as StageSecrets;
}

/**
 * Write secrets for a stage (encrypted).
 * Creates or uses existing encryption key at ~/.gkm/{project}/{stage}.key
 */
export async function writeStageSecrets(
	secrets: StageSecrets,
	cwd = process.cwd(),
): Promise<void> {
	const dir = getSecretsDir(cwd);
	const path = getSecretsPath(secrets.stage, cwd);
	const projectName = basename(cwd);

	// Ensure directory exists
	await mkdir(dir, { recursive: true });

	// Get or create encryption key
	const key = await getOrCreateKey(secrets.stage, projectName);

	// Encrypt and write
	const encrypted = encryptSecretsData(secrets, key);
	await writeFile(path, JSON.stringify(encrypted, null, 2), 'utf-8');
}

/**
 * Convert StageSecrets to embeddable format (flat key-value pairs).
 * This is what gets encrypted and embedded in the bundle.
 */
export function toEmbeddableSecrets(secrets: StageSecrets): EmbeddableSecrets {
	return {
		...secrets.urls,
		...secrets.custom,
		// Also include individual service credentials if needed
		...(secrets.services.postgres && {
			POSTGRES_USER: secrets.services.postgres.username,
			POSTGRES_PASSWORD: secrets.services.postgres.password,
			POSTGRES_DB: secrets.services.postgres.database ?? 'app',
			POSTGRES_HOST: secrets.services.postgres.host,
			POSTGRES_PORT: String(secrets.services.postgres.port),
		}),
		...(secrets.services.redis && {
			REDIS_PASSWORD: secrets.services.redis.password,
			REDIS_HOST: secrets.services.redis.host,
			REDIS_PORT: String(secrets.services.redis.port),
		}),
		...(secrets.services.rabbitmq && {
			RABBITMQ_USER: secrets.services.rabbitmq.username,
			RABBITMQ_PASSWORD: secrets.services.rabbitmq.password,
			RABBITMQ_HOST: secrets.services.rabbitmq.host,
			RABBITMQ_PORT: String(secrets.services.rabbitmq.port),
			RABBITMQ_VHOST: secrets.services.rabbitmq.vhost ?? '/',
		}),
	};
}

/**
 * Update a custom secret in the secrets file.
 */
export async function setCustomSecret(
	stage: string,
	key: string,
	value: string,
	cwd = process.cwd(),
): Promise<StageSecrets> {
	const secrets = await readStageSecrets(stage, cwd);

	if (!secrets) {
		throw new Error(
			`Secrets not found for stage "${stage}". Run "gkm secrets:init --stage ${stage}" first.`,
		);
	}

	const updated: StageSecrets = {
		...secrets,
		updatedAt: new Date().toISOString(),
		custom: {
			...secrets.custom,
			[key]: value,
		},
	};

	await writeStageSecrets(updated, cwd);
	return updated;
}

/**
 * Mask a password for display (show first 4 and last 2 chars).
 */
export function maskPassword(password: string): string {
	if (password.length <= 8) {
		return '********';
	}
	return `${password.slice(0, 4)}${'*'.repeat(password.length - 6)}${password.slice(-2)}`;
}

/**
 * Result of environment variable validation.
 */
export interface EnvValidationResult {
	/** Whether all required environment variables are present */
	valid: boolean;
	/** List of missing environment variable names */
	missing: string[];
	/** List of environment variables that are provided */
	provided: string[];
	/** List of environment variables that were required */
	required: string[];
}

/**
 * Validate that all required environment variables are present in secrets.
 *
 * @param requiredVars - Array of environment variable names required by the application
 * @param secrets - Stage secrets to validate against
 * @returns Validation result with missing and provided variables
 *
 * @example
 * ```typescript
 * const required = ['DATABASE_URL', 'API_KEY', 'JWT_SECRET'];
 * const secrets = await readStageSecrets('production');
 * const result = validateEnvironmentVariables(required, secrets);
 *
 * if (!result.valid) {
 *   console.error(`Missing environment variables: ${result.missing.join(', ')}`);
 * }
 * ```
 */
export function validateEnvironmentVariables(
	requiredVars: string[],
	secrets: StageSecrets,
): EnvValidationResult {
	const embeddable = toEmbeddableSecrets(secrets);
	const availableVars = new Set(Object.keys(embeddable));

	const missing: string[] = [];
	const provided: string[] = [];

	for (const varName of requiredVars) {
		if (availableVars.has(varName)) {
			provided.push(varName);
		} else {
			missing.push(varName);
		}
	}

	return {
		valid: missing.length === 0,
		missing: missing.sort(),
		provided: provided.sort(),
		required: [...requiredVars].sort(),
	};
}
