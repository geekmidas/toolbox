/**
 * What a stage's secrets are, independent of where they are kept: building
 * them, changing them, and handing them to a process. Where they are kept is a
 * {@link SecretsStore}'s business — see `secretsStoreFor`.
 */

import type { SecretsStore } from './store.js';
import type { EmbeddableSecrets, StageSecrets } from './types';

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
		...(secrets.services.minio && {
			STORAGE_ACCESS_KEY_ID: secrets.services.minio.username,
			STORAGE_SECRET_ACCESS_KEY: secrets.services.minio.password,
			STORAGE_BUCKET: secrets.services.minio.bucket ?? 'app',
			STORAGE_REGION: 'eu-west-1',
			STORAGE_FORCE_PATH_STYLE: 'true',
		}),
		...(secrets.services.mailpit && {
			SMTP_HOST: secrets.services.mailpit.host,
			SMTP_PORT: String(secrets.services.mailpit.port),
			SMTP_USER: secrets.services.mailpit.username,
			SMTP_PASS: secrets.services.mailpit.password,
			SMTP_SECURE: 'false',
			MAIL_FROM: 'noreply@localhost',
		}),
		...(secrets.services.localstack && {
			AWS_ACCESS_KEY_ID:
				secrets.services.localstack.accessKeyId ??
				secrets.services.localstack.username,
			AWS_SECRET_ACCESS_KEY: secrets.services.localstack.password,
			AWS_REGION: secrets.services.localstack.region ?? 'us-east-1',
			AWS_ENDPOINT_URL: `http://${secrets.services.localstack.host}:${secrets.services.localstack.port}`,
		}),
		...(secrets.services.pgboss && {
			PGBOSS_DB_USER: secrets.services.pgboss.username,
			PGBOSS_DB_PASSWORD: secrets.services.pgboss.password,
		}),
	};
}

/** The same secrets with one custom value set, and `updatedAt` moved on. */
export function withCustomSecret(
	secrets: StageSecrets,
	key: string,
	value: string,
): StageSecrets {
	return {
		...secrets,
		updatedAt: new Date().toISOString(),
		custom: { ...secrets.custom, [key]: value },
	};
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
 * const secrets = await secretsStoreFor(workspace, 'production').then((s) => s.read('production'));
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
