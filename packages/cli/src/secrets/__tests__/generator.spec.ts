import { describe, expect, it } from 'vitest';
import {
	createStageSecrets,
	generateConnectionUrls,
	generateEventConnectionStrings,
	generateLocalStackAccessKeyId,
	generateLocalStackCredentials,
	generateMinioEndpoint,
	generatePgBossUrl,
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

		expect(creds.host).toBe('localhost');
		expect(creds.port).toBe(5432);
		expect(creds.username).toBe('app');
		expect(creds.database).toBe('app');
		expect(creds.password).toHaveLength(32);
	});

	it('should generate redis credentials with defaults', () => {
		const creds = generateServiceCredentials('redis');

		expect(creds.host).toBe('localhost');
		expect(creds.port).toBe(6379);
		expect(creds.username).toBe('default');
		expect(creds.password).toHaveLength(32);
	});

	it('should generate rabbitmq credentials with defaults', () => {
		const creds = generateServiceCredentials('rabbitmq');

		expect(creds.host).toBe('localhost');
		expect(creds.port).toBe(5672);
		expect(creds.username).toBe('app');
		expect(creds.vhost).toBe('/');
		expect(creds.password).toHaveLength(32);
	});

	it('should generate minio credentials with defaults', () => {
		const creds = generateServiceCredentials('minio');

		expect(creds.host).toBe('localhost');
		expect(creds.port).toBe(9000);
		expect(creds.username).toBe('app');
		expect(creds.bucket).toBe('app');
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
		expect(url).toBe('postgresql://app:pass%40word%2Ftest@postgres:5432/mydb');
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

describe('generateMinioEndpoint', () => {
	it('should generate valid minio endpoint URL', () => {
		const creds: ServiceCredentials = {
			host: 'localhost',
			port: 9000,
			username: 'app',
			password: 'secret123',
			bucket: 'my-bucket',
		};

		const url = generateMinioEndpoint(creds);
		expect(url).toBe('http://localhost:9000');
	});

	it('should use custom host and port', () => {
		const creds: ServiceCredentials = {
			host: 'minio.example.com',
			port: 9090,
			username: 'app',
			password: 'secret',
		};

		const url = generateMinioEndpoint(creds);
		expect(url).toBe('http://minio.example.com:9090');
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

		expect(urls.DATABASE_URL).toBe('postgresql://app:secret@postgres:5432/app');
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
			minio: {
				host: 'minio',
				port: 9000,
				username: 'app',
				password: 'minio-pass',
				bucket: 'app',
			},
		});

		expect(urls.DATABASE_URL).toBeDefined();
		expect(urls.REDIS_URL).toBeDefined();
		expect(urls.RABBITMQ_URL).toBeDefined();
		expect(urls.STORAGE_ENDPOINT).toBe('http://minio:9000');
	});

	it('should generate STORAGE_ENDPOINT for minio', () => {
		const urls = generateConnectionUrls({
			minio: {
				host: 'localhost',
				port: 9000,
				username: 'app',
				password: 'secret',
				bucket: 'my-bucket',
			},
		});

		expect(urls.STORAGE_ENDPOINT).toBe('http://localhost:9000');
		expect(urls.DATABASE_URL).toBeUndefined();
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

	it('should generate STORAGE_ENDPOINT for minio', () => {
		const secrets = createStageSecrets('production', ['minio']);

		expect(secrets.services.minio).toBeDefined();
		expect(secrets.urls.STORAGE_ENDPOINT).toBe('http://localhost:9000');
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

describe('generateLocalStackAccessKeyId', () => {
	it('should start with LSIA prefix', () => {
		const keyId = generateLocalStackAccessKeyId();
		expect(keyId).toMatch(/^LSIA/);
	});

	it('should be at least 20 characters', () => {
		const keyId = generateLocalStackAccessKeyId();
		expect(keyId.length).toBeGreaterThanOrEqual(20);
	});

	it('should generate unique keys', () => {
		const key1 = generateLocalStackAccessKeyId();
		const key2 = generateLocalStackAccessKeyId();
		expect(key1).not.toBe(key2);
	});
});

describe('generatePgBossUrl', () => {
	it('should generate pgboss connection URL', () => {
		const creds: ServiceCredentials = {
			host: 'localhost',
			port: 5432,
			username: 'pgboss',
			password: 'secret',
			database: 'myapp_dev',
		};

		const url = generatePgBossUrl(creds);
		expect(url).toBe(
			'pgboss://pgboss:secret@localhost:5432/myapp_dev?schema=pgboss',
		);
	});

	it('should encode special characters in password', () => {
		const creds: ServiceCredentials = {
			host: 'localhost',
			port: 5432,
			username: 'pgboss',
			password: 'p@ss/word',
			database: 'app',
		};

		const url = generatePgBossUrl(creds);
		expect(url).toContain('p%40ss%2Fword');
	});
});

describe('generateLocalStackCredentials', () => {
	it('should generate credentials with LSIA-prefixed access key', () => {
		const creds = generateLocalStackCredentials();
		expect(creds.accessKeyId).toMatch(/^LSIA/);
		expect(creds.host).toBe('localhost');
		expect(creds.port).toBe(4566);
		expect(creds.region).toBe('us-east-1');
		expect(creds.password).toHaveLength(32);
	});
});

describe('generateEventConnectionStrings', () => {
	it('should generate pgboss connection strings', () => {
		const services: StageSecrets['services'] = {
			pgboss: {
				host: 'localhost',
				port: 5432,
				username: 'pgboss',
				password: 'secret',
				database: 'myapp_dev',
			},
		};

		const result = generateEventConnectionStrings('pgboss', services);
		expect(result.publisher).toContain('pgboss://');
		expect(result.subscriber).toContain('pgboss://');
		expect(result.publisher).toBe(result.subscriber);
	});

	it('should generate sns/sqs connection strings', () => {
		const services: StageSecrets['services'] = {
			localstack: {
				host: 'localhost',
				port: 4566,
				username: 'localstack',
				password: 'secret',
				accessKeyId: 'LSIAtest1234567890xx',
				region: 'us-east-1',
			},
		};

		const result = generateEventConnectionStrings('sns', services);
		expect(result.publisher).toContain('sns://');
		expect(result.subscriber).toContain('sqs://');
		expect(result.publisher).toContain('LSIAtest1234567890xx');
	});

	it('should generate rabbitmq connection strings', () => {
		const services: StageSecrets['services'] = {
			rabbitmq: {
				host: 'localhost',
				port: 5672,
				username: 'app',
				password: 'secret',
				vhost: '/',
			},
		};

		const result = generateEventConnectionStrings('rabbitmq', services);
		expect(result.publisher).toContain('amqp://');
		expect(result.subscriber).toContain('amqp://');
		expect(result.publisher).toBe(result.subscriber);
	});

	it('should throw if pgboss credentials missing', () => {
		expect(() => generateEventConnectionStrings('pgboss', {})).toThrow(
			'pgboss credentials required',
		);
	});

	it('should throw if localstack credentials missing', () => {
		expect(() => generateEventConnectionStrings('sns', {})).toThrow(
			'localstack credentials required',
		);
	});
});

describe('createStageSecrets with events', () => {
	it('should create pgboss credentials when eventsBackend is pgboss', () => {
		const secrets = createStageSecrets('development', ['postgres'], {
			eventsBackend: 'pgboss',
		});

		expect(secrets.eventsBackend).toBe('pgboss');
		expect(secrets.services.pgboss).toBeDefined();
		expect(secrets.services.pgboss!.username).toBe('pgboss');
		expect(secrets.services.pgboss!.host).toBe(secrets.services.postgres!.host);
		expect(secrets.services.pgboss!.database).toBe(
			secrets.services.postgres!.database,
		);
		expect(secrets.urls.EVENT_PUBLISHER_CONNECTION_STRING).toContain(
			'pgboss://',
		);
		expect(secrets.urls.EVENT_SUBSCRIBER_CONNECTION_STRING).toContain(
			'pgboss://',
		);
	});

	it('should create localstack credentials when eventsBackend is sns', () => {
		const secrets = createStageSecrets('development', [], {
			eventsBackend: 'sns',
		});

		expect(secrets.eventsBackend).toBe('sns');
		expect(secrets.services.localstack).toBeDefined();
		expect(secrets.services.localstack!.accessKeyId).toMatch(/^LSIA/);
		expect(secrets.urls.EVENT_PUBLISHER_CONNECTION_STRING).toContain('sns://');
		expect(secrets.urls.EVENT_SUBSCRIBER_CONNECTION_STRING).toContain('sqs://');
	});

	it('should use rabbitmq credentials when eventsBackend is rabbitmq', () => {
		const secrets = createStageSecrets('development', ['rabbitmq'], {
			eventsBackend: 'rabbitmq',
		});

		expect(secrets.eventsBackend).toBe('rabbitmq');
		expect(secrets.urls.EVENT_PUBLISHER_CONNECTION_STRING).toContain('amqp://');
		expect(secrets.urls.EVENT_SUBSCRIBER_CONNECTION_STRING).toContain(
			'amqp://',
		);
	});

	it('should not create event URLs without eventsBackend', () => {
		const secrets = createStageSecrets('development', ['postgres']);

		expect(secrets.eventsBackend).toBeUndefined();
		expect(secrets.urls.EVENT_PUBLISHER_CONNECTION_STRING).toBeUndefined();
		expect(secrets.urls.EVENT_SUBSCRIBER_CONNECTION_STRING).toBeUndefined();
	});
});
