import type { ComposeServiceName, EventsBackend } from '../types';

/** Credentials for a specific service */
export interface ServiceCredentials {
	host: string;
	port: number;
	username: string;
	password: string;
	/** Database name (for postgres) */
	database?: string;
	/** Virtual host (for rabbitmq) */
	vhost?: string;
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
	/** Event backend type (if events are enabled) */
	eventsBackend?: EventsBackend;
	/** Service-specific credentials */
	services: {
		postgres?: ServiceCredentials;
		redis?: ServiceCredentials;
		rabbitmq?: ServiceCredentials;
		minio?: ServiceCredentials;
		mailpit?: ServiceCredentials;
		localstack?: ServiceCredentials;
		pgboss?: ServiceCredentials;
	};
	/** Generated connection URLs */
	urls: {
		DATABASE_URL?: string;
		REDIS_URL?: string;
		RABBITMQ_URL?: string;
		STORAGE_ENDPOINT?: string;
		SMTP_HOST?: string;
		SMTP_PORT?: string;
		EVENT_PUBLISHER_CONNECTION_STRING?: string;
		EVENT_SUBSCRIBER_CONNECTION_STRING?: string;
	};
	/** Custom user-defined secrets */
	custom: Record<string, string>;
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

/** Services that support automatic credential generation */
export type SecretServiceName = ComposeServiceName;
