import { randomBytes } from 'node:crypto';
import type {
	SecretServiceName,
	ServiceCredentials,
	StageSecrets,
} from './types';

/**
 * Generate a secure random password using URL-safe base64 characters.
 * @param length Password length (default: 32)
 */
export function generateSecurePassword(length = 32): string {
	return randomBytes(Math.ceil((length * 3) / 4))
		.toString('base64url')
		.slice(0, length);
}

/** Default service configurations (localhost for local dev via Docker port mapping) */
const SERVICE_DEFAULTS: Record<
	SecretServiceName,
	Omit<ServiceCredentials, 'password'>
> = {
	postgres: {
		host: 'localhost',
		port: 5432,
		username: 'app',
		database: 'app',
	},
	redis: {
		host: 'localhost',
		port: 6379,
		username: 'default',
	},
	minio: {
		host: 'localhost',
		port: 9000,
		username: 'app',
		bucket: 'app',
	},
	mailpit: {
		host: 'localhost',
		port: 1025,
		username: 'app',
	},
	localstack: {
		host: 'localhost',
		port: 4566,
		username: 'localstack',
		region: 'us-east-1',
	},
};

/** Default credentials for pgboss (not a Docker service, reuses postgres) */
const PGBOSS_DEFAULTS: Omit<ServiceCredentials, 'password'> = {
	host: 'localhost',
	port: 5432,
	username: 'pgboss',
	database: 'app',
};

/**
 * Generate credentials for a specific service.
 */
export function generateServiceCredentials(
	service: SecretServiceName,
): ServiceCredentials {
	const defaults = SERVICE_DEFAULTS[service];
	return {
		...defaults,
		password: generateSecurePassword(),
	};
}

/**
 * Generate credentials for multiple services.
 */
export function generateServicesCredentials(
	services: SecretServiceName[],
): StageSecrets['services'] {
	const result: StageSecrets['services'] = {};

	for (const service of services) {
		result[service] = generateServiceCredentials(service);
	}

	return result;
}

/**
 * Generate connection URL for PostgreSQL.
 */
export function generatePostgresUrl(creds: ServiceCredentials): string {
	const { username, password, host, port, database } = creds;
	return `postgresql://${username}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

/**
 * Generate connection URL for Redis.
 */
export function generateRedisUrl(creds: ServiceCredentials): string {
	const { password, host, port } = creds;
	return `redis://:${encodeURIComponent(password)}@${host}:${port}`;
}

/**
 * Generate endpoint URL for MinIO (S3-compatible).
 */
export function generateMinioEndpoint(creds: ServiceCredentials): string {
	const { host, port } = creds;
	return `http://${host}:${port}`;
}

/**
 * Generate a LocalStack-compatible access key ID.
 * Must start with 'LSIA' prefix and be at least 20 characters.
 * @see https://docs.localstack.cloud/aws/capabilities/config/credentials/
 */
export function generateLocalStackAccessKeyId(): string {
	const suffix = randomBytes(12).toString('base64url').slice(0, 16);
	return `LSIA${suffix}`;
}

/**
 * Generate connection URL for pg-boss (uses PostgreSQL protocol).
 * Format: pgboss://user:pass@host:port/db?schema=pgboss
 */
export function generatePgBossUrl(creds: ServiceCredentials): string {
	const { username, password, host, port, database } = creds;
	return `pgboss://${username}:${encodeURIComponent(password)}@${host}:${port}/${database}?schema=pgboss`;
}

/**
 * Generate connection URLs from service credentials.
 */
export function generateConnectionUrls(
	services: StageSecrets['services'],
): StageSecrets['urls'] {
	const urls: StageSecrets['urls'] = {};

	if (services.postgres) {
		urls.DATABASE_URL = generatePostgresUrl(services.postgres);
	}

	if (services.redis) {
		urls.REDIS_URL = generateRedisUrl(services.redis);
	}

	if (services.minio) {
		urls.STORAGE_ENDPOINT = generateMinioEndpoint(services.minio);
	}

	// A topic's or queue's own broker URL is reconcile's, derived from the
	// declaration. This pair is what a worker's crons schedule through.
	if (services.pgboss) {
		const pgbossUrl = generatePgBossUrl(services.pgboss);
		urls.EVENT_PUBLISHER_CONNECTION_STRING = pgbossUrl;
		urls.EVENT_SUBSCRIBER_CONNECTION_STRING = pgbossUrl;
	}

	if (services.mailpit) {
		urls.SMTP_HOST = services.mailpit.host;
		urls.SMTP_PORT = String(services.mailpit.port);
	}

	return urls;
}

/**
 * Generate LocalStack service credentials with LSIA-prefixed access key.
 */
export function generateLocalStackCredentials(): ServiceCredentials {
	const defaults = SERVICE_DEFAULTS.localstack;
	return {
		...defaults,
		password: generateSecurePassword(),
		accessKeyId: generateLocalStackAccessKeyId(),
	};
}

/**
 * Create a new StageSecrets object with generated credentials.
 * @param stage - The deployment stage (e.g., 'development', 'production')
 * @param services - List of services to generate credentials for
 * @param options - Optional configuration
 * @param options.projectName - Project name used to derive the database name (e.g., 'myapp' → 'myapp_dev')
 */
export function createStageSecrets(
	stage: string,
	services: SecretServiceName[],
	options?: { projectName?: string },
): StageSecrets {
	const now = new Date().toISOString();
	const serviceCredentials = generateServicesCredentials(services);

	// Override service defaults with project-derived names if provided
	if (options?.projectName) {
		if (serviceCredentials.postgres) {
			serviceCredentials.postgres.database = `${options.projectName.replace(/-/g, '_')}_dev`;
		}
		if (serviceCredentials.minio) {
			serviceCredentials.minio.bucket = options.projectName;
			serviceCredentials.minio.username = options.projectName;
		}
	}

	// Always create pgboss credentials when postgres is available.
	// pgboss reuses postgres host/port/database but with a dedicated user,
	// so subscribers work out of the box without explicit events config.
	if (serviceCredentials.postgres && !serviceCredentials.pgboss) {
		serviceCredentials.pgboss = {
			...PGBOSS_DEFAULTS,
			password: generateSecurePassword(),
			host: serviceCredentials.postgres.host,
			port: serviceCredentials.postgres.port,
			database: serviceCredentials.postgres.database,
		};
	}

	const urls = generateConnectionUrls(serviceCredentials);

	return {
		stage,
		createdAt: now,
		updatedAt: now,
		services: serviceCredentials,
		urls,
		custom: {},
	};
}

/**
 * Rotate password for a specific service.
 */
export function rotateServicePassword(
	secrets: StageSecrets,
	service: SecretServiceName,
): StageSecrets {
	const currentCreds = secrets.services[service];
	if (!currentCreds) {
		throw new Error(`Service "${service}" not configured in secrets`);
	}

	const newCreds: ServiceCredentials = {
		...currentCreds,
		password: generateSecurePassword(),
	};

	const newServices = {
		...secrets.services,
		[service]: newCreds,
	};

	return {
		...secrets,
		updatedAt: new Date().toISOString(),
		services: newServices,
		urls: generateConnectionUrls(newServices),
	};
}
