import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	getSecretsDir,
	getSecretsPath,
	maskPassword,
	readStageSecrets,
	secretsExist,
	setCustomSecret,
	toEmbeddableSecrets,
	validateEnvironmentVariables,
	writeStageSecrets,
} from '../storage';
import type { StageSecrets } from '../types';

describe('path utilities', () => {
	describe('getSecretsDir', () => {
		it('should return .gkm/secrets relative to cwd', () => {
			const dir = getSecretsDir('/project');
			expect(dir).toBe('/project/.gkm/secrets');
		});
	});

	describe('getSecretsPath', () => {
		it('should return path for stage file', () => {
			const path = getSecretsPath('production', '/project');
			expect(path).toBe('/project/.gkm/secrets/production.json');
		});

		it('should handle stage names with special characters', () => {
			const path = getSecretsPath('dev-local', '/project');
			expect(path).toBe('/project/.gkm/secrets/dev-local.json');
		});
	});

	describe('secretsExist', () => {
		it('should return false for non-existent secrets', () => {
			const exists = secretsExist('nonexistent', '/nonexistent-path');
			expect(exists).toBe(false);
		});
	});
});

describe('file operations', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `gkm-test-${Date.now()}`);
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		if (existsSync(tempDir)) {
			await rm(tempDir, { recursive: true });
		}
	});

	describe('writeStageSecrets / readStageSecrets', () => {
		it('should write and read secrets', async () => {
			const secrets: StageSecrets = {
				stage: 'production',
				createdAt: '2024-01-01T00:00:00.000Z',
				updatedAt: '2024-01-01T00:00:00.000Z',
				services: {
					postgres: {
						host: 'postgres',
						port: 5432,
						username: 'app',
						password: 'secret123',
						database: 'app',
					},
				},
				urls: {
					DATABASE_URL: 'postgresql://app:secret123@postgres:5432/app',
				},
				custom: {},
			};

			await writeStageSecrets(secrets, tempDir);
			const read = await readStageSecrets('production', tempDir);

			expect(read).toEqual(secrets);
		});

		it('should create directory if it does not exist', async () => {
			const secrets: StageSecrets = {
				stage: 'staging',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				services: {},
				urls: {},
				custom: {},
			};

			await writeStageSecrets(secrets, tempDir);

			expect(existsSync(join(tempDir, '.gkm/secrets'))).toBe(true);
			expect(existsSync(join(tempDir, '.gkm/secrets/staging.json'))).toBe(true);
		});

		it('should return null for non-existent stage', async () => {
			const read = await readStageSecrets('nonexistent', tempDir);
			expect(read).toBeNull();
		});
	});

	describe('secretsExist', () => {
		it('should return true when secrets file exists', async () => {
			const secrets: StageSecrets = {
				stage: 'test',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				services: {},
				urls: {},
				custom: {},
			};

			await writeStageSecrets(secrets, tempDir);
			expect(secretsExist('test', tempDir)).toBe(true);
		});

		it('should return false when secrets file does not exist', () => {
			expect(secretsExist('nonexistent', tempDir)).toBe(false);
		});
	});

	describe('setCustomSecret', () => {
		it('should add custom secret to existing secrets', async () => {
			const secrets: StageSecrets = {
				stage: 'production',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				services: {},
				urls: {},
				custom: {},
			};

			await writeStageSecrets(secrets, tempDir);
			const updated = await setCustomSecret(
				'production',
				'API_KEY',
				'sk_test_123',
				tempDir,
			);

			expect(updated.custom.API_KEY).toBe('sk_test_123');
		});

		it('should update existing custom secret', async () => {
			const secrets: StageSecrets = {
				stage: 'production',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				services: {},
				urls: {},
				custom: { API_KEY: 'old-value' },
			};

			await writeStageSecrets(secrets, tempDir);
			const updated = await setCustomSecret(
				'production',
				'API_KEY',
				'new-value',
				tempDir,
			);

			expect(updated.custom.API_KEY).toBe('new-value');
		});

		it('should update updatedAt timestamp', async () => {
			const originalTime = '2024-01-01T00:00:00.000Z';
			const secrets: StageSecrets = {
				stage: 'production',
				createdAt: originalTime,
				updatedAt: originalTime,
				services: {},
				urls: {},
				custom: {},
			};

			await writeStageSecrets(secrets, tempDir);
			const updated = await setCustomSecret(
				'production',
				'KEY',
				'value',
				tempDir,
			);

			expect(updated.updatedAt).not.toBe(originalTime);
		});

		it('should throw if secrets do not exist for stage', async () => {
			await expect(
				setCustomSecret('nonexistent', 'KEY', 'value', tempDir),
			).rejects.toThrow('Secrets not found for stage "nonexistent"');
		});

		it('should persist changes to disk', async () => {
			const secrets: StageSecrets = {
				stage: 'production',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				services: {},
				urls: {},
				custom: {},
			};

			await writeStageSecrets(secrets, tempDir);
			await setCustomSecret('production', 'NEW_KEY', 'new-value', tempDir);

			const read = await readStageSecrets('production', tempDir);
			expect(read!.custom.NEW_KEY).toBe('new-value');
		});
	});
});

describe('toEmbeddableSecrets', () => {
	it('should include URLs', () => {
		const secrets: StageSecrets = {
			stage: 'production',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			services: {},
			urls: {
				DATABASE_URL: 'postgresql://...',
				REDIS_URL: 'redis://...',
			},
			custom: {},
		};

		const embeddable = toEmbeddableSecrets(secrets);

		expect(embeddable.DATABASE_URL).toBe('postgresql://...');
		expect(embeddable.REDIS_URL).toBe('redis://...');
	});

	it('should include custom secrets', () => {
		const secrets: StageSecrets = {
			stage: 'production',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			services: {},
			urls: {},
			custom: {
				API_KEY: 'sk_test_123',
				WEBHOOK_SECRET: 'whsec_abc',
			},
		};

		const embeddable = toEmbeddableSecrets(secrets);

		expect(embeddable.API_KEY).toBe('sk_test_123');
		expect(embeddable.WEBHOOK_SECRET).toBe('whsec_abc');
	});

	it('should include postgres service credentials', () => {
		const secrets: StageSecrets = {
			stage: 'production',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			services: {
				postgres: {
					host: 'postgres',
					port: 5432,
					username: 'app',
					password: 'secret123',
					database: 'mydb',
				},
			},
			urls: {},
			custom: {},
		};

		const embeddable = toEmbeddableSecrets(secrets);

		expect(embeddable.POSTGRES_USER).toBe('app');
		expect(embeddable.POSTGRES_PASSWORD).toBe('secret123');
		expect(embeddable.POSTGRES_DB).toBe('mydb');
		expect(embeddable.POSTGRES_HOST).toBe('postgres');
		expect(embeddable.POSTGRES_PORT).toBe('5432');
	});

	it('should include redis service credentials', () => {
		const secrets: StageSecrets = {
			stage: 'production',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			services: {
				redis: {
					host: 'redis',
					port: 6379,
					username: 'default',
					password: 'redis-pass',
				},
			},
			urls: {},
			custom: {},
		};

		const embeddable = toEmbeddableSecrets(secrets);

		expect(embeddable.REDIS_PASSWORD).toBe('redis-pass');
		expect(embeddable.REDIS_HOST).toBe('redis');
		expect(embeddable.REDIS_PORT).toBe('6379');
	});

	it('should include rabbitmq service credentials', () => {
		const secrets: StageSecrets = {
			stage: 'production',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			services: {
				rabbitmq: {
					host: 'rabbitmq',
					port: 5672,
					username: 'app',
					password: 'rmq-pass',
					vhost: '/myapp',
				},
			},
			urls: {},
			custom: {},
		};

		const embeddable = toEmbeddableSecrets(secrets);

		expect(embeddable.RABBITMQ_USER).toBe('app');
		expect(embeddable.RABBITMQ_PASSWORD).toBe('rmq-pass');
		expect(embeddable.RABBITMQ_HOST).toBe('rabbitmq');
		expect(embeddable.RABBITMQ_PORT).toBe('5672');
		expect(embeddable.RABBITMQ_VHOST).toBe('/myapp');
	});

	it('should handle all services and custom secrets together', () => {
		const secrets: StageSecrets = {
			stage: 'production',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			services: {
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
			},
			urls: {
				DATABASE_URL: 'postgresql://...',
				REDIS_URL: 'redis://...',
			},
			custom: {
				API_KEY: 'key123',
			},
		};

		const embeddable = toEmbeddableSecrets(secrets);

		// URLs
		expect(embeddable.DATABASE_URL).toBe('postgresql://...');
		expect(embeddable.REDIS_URL).toBe('redis://...');

		// Custom
		expect(embeddable.API_KEY).toBe('key123');

		// Postgres
		expect(embeddable.POSTGRES_PASSWORD).toBe('pg-pass');

		// Redis
		expect(embeddable.REDIS_PASSWORD).toBe('redis-pass');
	});
});

describe('maskPassword', () => {
	it('should mask middle characters', () => {
		const masked = maskPassword('abcdefghijklmnop');
		expect(masked).toBe('abcd**********op');
	});

	it('should show first 4 and last 2 characters', () => {
		const masked = maskPassword('1234567890');
		expect(masked.slice(0, 4)).toBe('1234');
		expect(masked.slice(-2)).toBe('90');
	});

	it('should return all asterisks for short passwords', () => {
		expect(maskPassword('short')).toBe('********');
		expect(maskPassword('12345678')).toBe('********');
	});

	it('should handle exactly 9 character password', () => {
		const masked = maskPassword('123456789');
		expect(masked).toBe('1234***89');
	});
});

describe('validateEnvironmentVariables', () => {
	const baseSecrets: StageSecrets = {
		stage: 'production',
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		services: {},
		urls: {},
		custom: {},
	};

	it('should return valid when no variables are required', () => {
		const result = validateEnvironmentVariables([], baseSecrets);

		expect(result.valid).toBe(true);
		expect(result.missing).toEqual([]);
		expect(result.provided).toEqual([]);
		expect(result.required).toEqual([]);
	});

	it('should return valid when all required variables are present', () => {
		const secrets: StageSecrets = {
			...baseSecrets,
			urls: {
				DATABASE_URL: 'postgresql://...',
			},
			custom: {
				API_KEY: 'sk_test_123',
			},
		};

		const result = validateEnvironmentVariables(
			['DATABASE_URL', 'API_KEY'],
			secrets,
		);

		expect(result.valid).toBe(true);
		expect(result.missing).toEqual([]);
		expect(result.provided).toEqual(['API_KEY', 'DATABASE_URL']);
		expect(result.required).toEqual(['API_KEY', 'DATABASE_URL']);
	});

	it('should return invalid when some variables are missing', () => {
		const secrets: StageSecrets = {
			...baseSecrets,
			urls: {
				DATABASE_URL: 'postgresql://...',
			},
			custom: {},
		};

		const result = validateEnvironmentVariables(
			['DATABASE_URL', 'API_KEY', 'JWT_SECRET'],
			secrets,
		);

		expect(result.valid).toBe(false);
		expect(result.missing).toEqual(['API_KEY', 'JWT_SECRET']);
		expect(result.provided).toEqual(['DATABASE_URL']);
		expect(result.required).toEqual(['API_KEY', 'DATABASE_URL', 'JWT_SECRET']);
	});

	it('should return invalid when all variables are missing', () => {
		const result = validateEnvironmentVariables(
			['API_KEY', 'JWT_SECRET'],
			baseSecrets,
		);

		expect(result.valid).toBe(false);
		expect(result.missing).toEqual(['API_KEY', 'JWT_SECRET']);
		expect(result.provided).toEqual([]);
	});

	it('should recognize service credentials as provided', () => {
		const secrets: StageSecrets = {
			...baseSecrets,
			services: {
				postgres: {
					host: 'postgres',
					port: 5432,
					username: 'app',
					password: 'secret',
					database: 'app',
				},
				redis: {
					host: 'redis',
					port: 6379,
					username: 'default',
					password: 'redis-pass',
				},
			},
			urls: {},
			custom: {},
		};

		const result = validateEnvironmentVariables(
			['POSTGRES_PASSWORD', 'REDIS_HOST', 'POSTGRES_DB'],
			secrets,
		);

		expect(result.valid).toBe(true);
		expect(result.missing).toEqual([]);
		expect(result.provided).toEqual([
			'POSTGRES_DB',
			'POSTGRES_PASSWORD',
			'REDIS_HOST',
		]);
	});

	it('should sort missing and provided arrays alphabetically', () => {
		const secrets: StageSecrets = {
			...baseSecrets,
			custom: {
				ZEBRA: 'value',
				ALPHA: 'value',
			},
		};

		const result = validateEnvironmentVariables(
			['ZEBRA', 'ALPHA', 'YELLOW', 'BETA'],
			secrets,
		);

		expect(result.missing).toEqual(['BETA', 'YELLOW']);
		expect(result.provided).toEqual(['ALPHA', 'ZEBRA']);
		expect(result.required).toEqual(['ALPHA', 'BETA', 'YELLOW', 'ZEBRA']);
	});

	it('should handle duplicate required variables', () => {
		const secrets: StageSecrets = {
			...baseSecrets,
			custom: {
				API_KEY: 'value',
			},
		};

		const result = validateEnvironmentVariables(
			['API_KEY', 'API_KEY', 'MISSING'],
			secrets,
		);

		expect(result.valid).toBe(false);
		expect(result.missing).toEqual(['MISSING']);
		// Note: duplicates in input are preserved in required list
		expect(result.required).toEqual(['API_KEY', 'API_KEY', 'MISSING']);
	});

	it('should work with complex service configurations', () => {
		const secrets: StageSecrets = {
			...baseSecrets,
			services: {
				postgres: {
					host: 'postgres',
					port: 5432,
					username: 'app',
					password: 'pg-secret',
					database: 'mydb',
				},
				redis: {
					host: 'redis',
					port: 6379,
					username: 'default',
					password: 'redis-secret',
				},
				rabbitmq: {
					host: 'rabbitmq',
					port: 5672,
					username: 'guest',
					password: 'guest',
					vhost: '/',
				},
			},
			urls: {
				DATABASE_URL: 'postgresql://...',
				REDIS_URL: 'redis://...',
				RABBITMQ_URL: 'amqp://...',
			},
			custom: {
				JWT_SECRET: 'jwt-secret-value',
			},
		};

		const result = validateEnvironmentVariables(
			[
				'DATABASE_URL',
				'REDIS_URL',
				'RABBITMQ_URL',
				'JWT_SECRET',
				'POSTGRES_PASSWORD',
				'REDIS_PASSWORD',
				'RABBITMQ_USER',
				'MISSING_VAR',
			],
			secrets,
		);

		expect(result.valid).toBe(false);
		expect(result.missing).toEqual(['MISSING_VAR']);
		expect(result.provided).toContain('DATABASE_URL');
		expect(result.provided).toContain('REDIS_URL');
		expect(result.provided).toContain('RABBITMQ_URL');
		expect(result.provided).toContain('JWT_SECRET');
		expect(result.provided).toContain('POSTGRES_PASSWORD');
		expect(result.provided).toContain('REDIS_PASSWORD');
		expect(result.provided).toContain('RABBITMQ_USER');
	});
});
