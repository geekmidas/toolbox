import type { ComposeServiceName } from '../types';

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
		rabbitmq?: ServiceCredentials;
	};
	/** Generated connection URLs */
	urls: {
		DATABASE_URL?: string;
		REDIS_URL?: string;
		RABBITMQ_URL?: string;
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
