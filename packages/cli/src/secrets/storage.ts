import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EmbeddableSecrets, StageSecrets } from './types';

/** Default secrets directory relative to project root */
const SECRETS_DIR = '.gkm/secrets';

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
 * Read secrets for a stage.
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
	return JSON.parse(content) as StageSecrets;
}

/**
 * Write secrets for a stage.
 */
export async function writeStageSecrets(
	secrets: StageSecrets,
	cwd = process.cwd(),
): Promise<void> {
	const dir = getSecretsDir(cwd);
	const path = getSecretsPath(secrets.stage, cwd);

	// Ensure directory exists
	await mkdir(dir, { recursive: true });

	// Write with pretty formatting
	await writeFile(path, JSON.stringify(secrets, null, 2), 'utf-8');
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
