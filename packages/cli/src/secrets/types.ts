import type { ComposeServiceName } from '../types';

/** Credentials for a specific service */
export interface ServiceCredentials {
	host: string;
	port: number;
	username: string;
	password: string;
	/** Database name (for postgres) */
	database?: string;
	/** Bucket name (for minio) */
	bucket?: string;
	/** Access key ID (for localstack) */
	accessKeyId?: string;
	/** Region (for localstack) */
	region?: string;
}

/** Stage secrets configuration */
export interface StageSecrets {
	/** Stage name (e.g., 'production', 'staging') */
	stage: string;
	/** ISO timestamp when secrets were created */
	createdAt: string;
	/** ISO timestamp when secrets were last updated */
	updatedAt: string;
	/** Service-specific credentials */
	services: {
		postgres?: ServiceCredentials;
		redis?: ServiceCredentials;
		minio?: ServiceCredentials;
		mailpit?: ServiceCredentials;
		localstack?: ServiceCredentials;
		pgboss?: ServiceCredentials;
	};
	/** Generated connection URLs */
	urls: {
		DATABASE_URL?: string;
		REDIS_URL?: string;
		STORAGE_ENDPOINT?: string;
		SMTP_HOST?: string;
		SMTP_PORT?: string;
		EVENT_PUBLISHER_CONNECTION_STRING?: string;
		EVENT_SUBSCRIBER_CONNECTION_STRING?: string;
	};
	/**
	 * Values injected by key: those set with `gkm secrets:set` — a third
	 * party's credentials — and those generated once for the stage, such as an
	 * auth server's signing secret.
	 */
	custom: Record<string, string>;
	/**
	 * Random, generated once per stage: what every password a deploy derives
	 * is salted with. Without it a derived password is a function of the
	 * project and stage names, which anyone reading the repo has.
	 */
	seed?: string;
}

/** Encrypted payload for build-time injection */
export interface EncryptedPayload {
	/** Base64 encoded encrypted data (ciphertext + auth tag) */
	encrypted: string;
	/** Hex encoded IV */
	iv: string;
	/** Hex encoded ephemeral master key (for deployment) */
	masterKey: string;
}

/** Secrets that get encrypted and embedded in the bundle */
export type EmbeddableSecrets = Record<string, string>;

/**
 * The containers that get a generated credential. Not `rabbitmq`: its
 * container runs as the local user, and a topic's broker URL is reconcile's.
 */
export type SecretServiceName = Exclude<ComposeServiceName, 'rabbitmq'>;
