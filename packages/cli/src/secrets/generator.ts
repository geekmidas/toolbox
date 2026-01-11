import { randomBytes } from 'node:crypto';
import type { ComposeServiceName } from '../types';
import type { ServiceCredentials, StageSecrets } from './types';

/**
 * Generate a secure random password using URL-safe base64 characters.
 * @param length Password length (default: 32)
 */
export function generateSecurePassword(length = 32): string {
	return randomBytes(Math.ceil((length * 3) / 4))
		.toString('base64url')
		.slice(0, length);
}

/** Default service configurations */
const SERVICE_DEFAULTS: Record<
	ComposeServiceName,
	Omit<ServiceCredentials, 'password'>
> = {
	postgres: {
		host: 'postgres',
		port: 5432,
		username: 'app',
		database: 'app',
	},
	redis: {
		host: 'redis',
		port: 6379,
		username: 'default',
	},
	rabbitmq: {
		host: 'rabbitmq',
		port: 5672,
		username: 'app',
		vhost: '/',
	},
};

/**
 * Generate credentials for a specific service.
 */
export function generateServiceCredentials(
	service: ComposeServiceName,
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
	services: ComposeServiceName[],
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
 * Generate connection URL for RabbitMQ.
 */
export function generateRabbitmqUrl(creds: ServiceCredentials): string {
	const { username, password, host, port, vhost } = creds;
	const encodedVhost = encodeURIComponent(vhost ?? '/');
	return `amqp://${username}:${encodeURIComponent(password)}@${host}:${port}/${encodedVhost}`;
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

	if (services.rabbitmq) {
		urls.RABBITMQ_URL = generateRabbitmqUrl(services.rabbitmq);
	}

	return urls;
}

/**
 * Create a new StageSecrets object with generated credentials.
 */
export function createStageSecrets(
	stage: string,
	services: ComposeServiceName[],
): StageSecrets {
	const now = new Date().toISOString();
	const serviceCredentials = generateServicesCredentials(services);
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
	service: ComposeServiceName,
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
