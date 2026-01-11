import { describe, expect, it } from 'vitest';
import {
	createStageSecrets,
	generateConnectionUrls,
	generatePostgresUrl,
	generateRabbitmqUrl,
	generateRedisUrl,
	generateSecurePassword,
	generateServiceCredentials,
	generateServicesCredentials,
	rotateServicePassword,
} from '../generator';
import type { ServiceCredentials, StageSecrets } from '../types';

describe('generateSecurePassword', () => {
	it('should generate password of default length (32)', () => {
		const password = generateSecurePassword();
		expect(password).toHaveLength(32);
	});

	it('should generate password of custom length', () => {
		const password = generateSecurePassword(16);
		expect(password).toHaveLength(16);
	});

	it('should generate different passwords each call', () => {
		const password1 = generateSecurePassword();
		const password2 = generateSecurePassword();
		expect(password1).not.toBe(password2);
	});

	it('should only contain URL-safe base64 characters', () => {
		const password = generateSecurePassword(64);
		// base64url uses A-Z, a-z, 0-9, -, _
		expect(password).toMatch(/^[A-Za-z0-9_-]+$/);
	});
});

describe('generateServiceCredentials', () => {
	it('should generate postgres credentials with defaults', () => {
		const creds = generateServiceCredentials('postgres');

		expect(creds.host).toBe('postgres');
		expect(creds.port).toBe(5432);
		expect(creds.username).toBe('app');
		expect(creds.database).toBe('app');
		expect(creds.password).toHaveLength(32);
	});

	it('should generate redis credentials with defaults', () => {
		const creds = generateServiceCredentials('redis');

		expect(creds.host).toBe('redis');
		expect(creds.port).toBe(6379);
		expect(creds.username).toBe('default');
		expect(creds.password).toHaveLength(32);
	});

	it('should generate rabbitmq credentials with defaults', () => {
		const creds = generateServiceCredentials('rabbitmq');

		expect(creds.host).toBe('rabbitmq');
		expect(creds.port).toBe(5672);
		expect(creds.username).toBe('app');
		expect(creds.vhost).toBe('/');
		expect(creds.password).toHaveLength(32);
	});
});

describe('generateServicesCredentials', () => {
	it('should generate credentials for multiple services', () => {
		const creds = generateServicesCredentials(['postgres', 'redis']);

		expect(creds.postgres).toBeDefined();
		expect(creds.redis).toBeDefined();
		expect(creds.rabbitmq).toBeUndefined();
	});

	it('should generate unique passwords for each service', () => {
		const creds = generateServicesCredentials([
			'postgres',
			'redis',
			'rabbitmq',
		]);

		expect(creds.postgres!.password).not.toBe(creds.redis!.password);
		expect(creds.redis!.password).not.toBe(creds.rabbitmq!.password);
	});
});

describe('generatePostgresUrl', () => {
	it('should generate valid postgres URL', () => {
		const creds: ServiceCredentials = {
			host: 'postgres',
			port: 5432,
			username: 'app',
			password: 'secret123',
			database: 'mydb',
		};

		const url = generatePostgresUrl(creds);
		expect(url).toBe('postgresql://app:secret123@postgres:5432/mydb');
	});

	it('should encode special characters in password', () => {
		const creds: ServiceCredentials = {
			host: 'postgres',
			port: 5432,
			username: 'app',
			password: 'pass@word/test',
			database: 'mydb',
		};

		const url = generatePostgresUrl(creds);
		expect(url).toBe(
			'postgresql://app:pass%40word%2Ftest@postgres:5432/mydb',
		);
	});
});

describe('generateRedisUrl', () => {
	it('should generate valid redis URL', () => {
		const creds: ServiceCredentials = {
			host: 'redis',
			port: 6379,
			username: 'default',
			password: 'secret123',
		};

		const url = generateRedisUrl(creds);
		expect(url).toBe('redis://:secret123@redis:6379');
	});

	it('should encode special characters in password', () => {
		const creds: ServiceCredentials = {
			host: 'redis',
			port: 6379,
			username: 'default',
			password: 'pass@word/test',
		};

		const url = generateRedisUrl(creds);
		expect(url).toBe('redis://:pass%40word%2Ftest@redis:6379');
	});
});

describe('generateRabbitmqUrl', () => {
	it('should generate valid rabbitmq URL with default vhost', () => {
		const creds: ServiceCredentials = {
			host: 'rabbitmq',
			port: 5672,
			username: 'app',
			password: 'secret123',
			vhost: '/',
		};

		const url = generateRabbitmqUrl(creds);
		expect(url).toBe('amqp://app:secret123@rabbitmq:5672/%2F');
	});

	it('should handle custom vhost', () => {
		const creds: ServiceCredentials = {
			host: 'rabbitmq',
			port: 5672,
			username: 'app',
			password: 'secret123',
			vhost: '/myapp',
		};

		const url = generateRabbitmqUrl(creds);
		expect(url).toBe('amqp://app:secret123@rabbitmq:5672/%2Fmyapp');
	});
});

describe('generateConnectionUrls', () => {
	it('should generate DATABASE_URL for postgres', () => {
		const urls = generateConnectionUrls({
			postgres: {
				host: 'postgres',
				port: 5432,
				username: 'app',
				password: 'secret',
				database: 'app',
			},
		});

		expect(urls.DATABASE_URL).toBe(
			'postgresql://app:secret@postgres:5432/app',
		);
		expect(urls.REDIS_URL).toBeUndefined();
		expect(urls.RABBITMQ_URL).toBeUndefined();
	});

	it('should generate all URLs when all services present', () => {
		const urls = generateConnectionUrls({
			postgres: {
				host: 'postgres',
				port: 5432,
				username: 'app',
				password: 'pg-pass',
				database: 'app',
			},
			redis: {
				host: 'redis',
				port: 6379,
				username: 'default',
				password: 'redis-pass',
			},
			rabbitmq: {
				host: 'rabbitmq',
				port: 5672,
				username: 'app',
				password: 'rmq-pass',
				vhost: '/',
			},
		});

		expect(urls.DATABASE_URL).toBeDefined();
		expect(urls.REDIS_URL).toBeDefined();
		expect(urls.RABBITMQ_URL).toBeDefined();
	});
});

describe('createStageSecrets', () => {
	it('should create stage secrets with stage name', () => {
		const secrets = createStageSecrets('production', ['postgres']);

		expect(secrets.stage).toBe('production');
		expect(secrets.createdAt).toBeDefined();
		expect(secrets.updatedAt).toBeDefined();
		expect(secrets.custom).toEqual({});
	});

	it('should include service credentials', () => {
		const secrets = createStageSecrets('staging', ['postgres', 'redis']);

		expect(secrets.services.postgres).toBeDefined();
		expect(secrets.services.redis).toBeDefined();
		expect(secrets.services.rabbitmq).toBeUndefined();
	});

	it('should generate connection URLs', () => {
		const secrets = createStageSecrets('production', [
			'postgres',
			'redis',
			'rabbitmq',
		]);

		expect(secrets.urls.DATABASE_URL).toBeDefined();
		expect(secrets.urls.REDIS_URL).toBeDefined();
		expect(secrets.urls.RABBITMQ_URL).toBeDefined();
	});
});

describe('rotateServicePassword', () => {
	it('should rotate password for specified service', () => {
		const original = createStageSecrets('production', ['postgres', 'redis']);
		const originalPassword = original.services.postgres!.password;

		const rotated = rotateServicePassword(original, 'postgres');

		expect(rotated.services.postgres!.password).not.toBe(originalPassword);
		expect(rotated.services.redis!.password).toBe(
			original.services.redis!.password,
		);
	});

	it('should update updatedAt timestamp', () => {
		// Create with a fixed past timestamp
		const original: StageSecrets = {
			stage: 'production',
			createdAt: '2024-01-01T00:00:00.000Z',
			updatedAt: '2024-01-01T00:00:00.000Z',
			services: {
				postgres: {
					host: 'postgres',
					port: 5432,
					username: 'app',
					password: 'original-pass',
					database: 'app',
				},
			},
			urls: {
				DATABASE_URL: 'postgresql://app:original-pass@postgres:5432/app',
			},
			custom: {},
		};

		const rotated = rotateServicePassword(original, 'postgres');

		expect(rotated.updatedAt).not.toBe(original.updatedAt);
	});

	it('should regenerate connection URL', () => {
		const original = createStageSecrets('production', ['postgres']);
		const originalUrl = original.urls.DATABASE_URL;

		const rotated = rotateServicePassword(original, 'postgres');

		expect(rotated.urls.DATABASE_URL).not.toBe(originalUrl);
	});

	it('should throw for unconfigured service', () => {
		const secrets = createStageSecrets('production', ['postgres']);

		expect(() => rotateServicePassword(secrets, 'redis')).toThrow(
			'Service "redis" not configured in secrets',
		);
	});

	it('should preserve other service credentials', () => {
		const original = createStageSecrets('production', [
			'postgres',
			'redis',
			'rabbitmq',
		]);

		const rotated = rotateServicePassword(original, 'postgres');

		expect(rotated.services.redis).toEqual(original.services.redis);
		expect(rotated.services.rabbitmq).toEqual(original.services.rabbitmq);
	});
});
