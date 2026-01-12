import { describe, expect, it } from 'vitest';
import {
	buildResourceEnv,
	environmentCase,
	getLocalIpAddress,
	ResourceType,
} from '../utils';

describe('getLocalIpAddress', () => {
	it('should return a valid IPv4 address or null', () => {
		const ip = getLocalIpAddress();

		if (ip !== null) {
			// Should be a valid IPv4 format
			const parts = ip.split('.');
			expect(parts).toHaveLength(4);
			for (const part of parts) {
				const num = Number.parseInt(part, 10);
				expect(num).toBeGreaterThanOrEqual(0);
				expect(num).toBeLessThanOrEqual(255);
			}
		} else {
			expect(ip).toBeNull();
		}
	});

	it('should not return loopback address', () => {
		const ip = getLocalIpAddress();

		if (ip !== null) {
			expect(ip).not.toBe('127.0.0.1');
		}
	});
});

describe('environmentCase', () => {
	it('should convert camelCase to SNAKE_CASE', () => {
		expect(environmentCase('databaseUrl')).toBe('DATABASE_URL');
	});

	it('should convert PascalCase to SNAKE_CASE', () => {
		expect(environmentCase('DatabaseUrl')).toBe('DATABASE_URL');
	});

	it('should convert kebab-case to SNAKE_CASE', () => {
		expect(environmentCase('database-url')).toBe('DATABASE_URL');
	});

	it('should handle single word', () => {
		expect(environmentCase('database')).toBe('DATABASE');
	});

	it('should handle numbers without underscore prefix', () => {
		expect(environmentCase('api2Endpoint')).toBe('API2_ENDPOINT');
	});

	it('should handle multiple numbers', () => {
		expect(environmentCase('value1And2')).toBe('VALUE1_AND2');
	});

	it('should handle already uppercase', () => {
		expect(environmentCase('DATABASE')).toBe('DATABASE');
	});
});

describe('buildResourceEnv', () => {
	it('should handle string values', () => {
		const result = buildResourceEnv({
			databaseUrl: 'postgres://localhost/db',
			apiKey: 'secret-key',
		});

		expect(result).toEqual({
			DATABASE_URL: 'postgres://localhost/db',
			API_KEY: 'secret-key',
		});
	});

	it('should handle Secret resource type', () => {
		const result = buildResourceEnv({
			mySecret: {
				type: ResourceType.Secret,
				value: 'secret-value',
			},
		});

		expect(result).toEqual({
			MY_SECRET: 'secret-value',
		});
	});

	it('should handle SSTSecret resource type', () => {
		const result = buildResourceEnv({
			apiToken: {
				type: ResourceType.SSTSecret,
				value: 'token-value',
			},
		});

		expect(result).toEqual({
			API_TOKEN: 'token-value',
		});
	});

	it('should handle Postgres resource type', () => {
		const result = buildResourceEnv({
			database: {
				type: ResourceType.Postgres,
				database: 'mydb',
				host: 'localhost',
				password: 'secret',
				port: 5432,
				username: 'user',
			},
		});

		expect(result).toEqual({
			DATABASE_NAME: 'mydb',
			DATABASE_HOST: 'localhost',
			DATABASE_PASSWORD: 'secret',
			DATABASE_PORT: 5432,
			DATABASE_USERNAME: 'user',
		});
	});

	it('should handle SSTPostgres resource type', () => {
		const result = buildResourceEnv({
			db: {
				type: ResourceType.SSTPostgres,
				database: 'testdb',
				host: 'db.example.com',
				password: 'pass123',
				port: 5432,
				username: 'admin',
			},
		});

		expect(result).toEqual({
			DB_NAME: 'testdb',
			DB_HOST: 'db.example.com',
			DB_PASSWORD: 'pass123',
			DB_PORT: 5432,
			DB_USERNAME: 'admin',
		});
	});

	it('should handle Bucket resource type', () => {
		const result = buildResourceEnv({
			uploads: {
				type: ResourceType.Bucket,
				name: 'my-uploads-bucket',
			},
		});

		expect(result).toEqual({
			UPLOADS_NAME: 'my-uploads-bucket',
		});
	});

	it('should handle SSTBucket resource type', () => {
		const result = buildResourceEnv({
			assets: {
				type: ResourceType.SSTBucket,
				name: 'assets-bucket',
			},
		});

		expect(result).toEqual({
			ASSETS_NAME: 'assets-bucket',
		});
	});

	it('should handle SnsTopic resource type', () => {
		const result = buildResourceEnv({
			notifications: {
				type: ResourceType.SnsTopic,
				arn: 'arn:aws:sns:us-east-1:123456789:my-topic',
			},
		});

		expect(result).toEqual({
			NOTIFICATIONS_ARN: 'arn:aws:sns:us-east-1:123456789:my-topic',
		});
	});

	it('should ignore ApiGatewayV2 resource type', () => {
		const result = buildResourceEnv({
			api: {
				type: ResourceType.ApiGatewayV2,
				url: 'https://api.example.com',
			},
		});

		expect(result).toEqual({});
	});

	it('should ignore Function resource type', () => {
		const result = buildResourceEnv({
			handler: {
				type: ResourceType.Function,
				name: 'my-function',
			},
		});

		expect(result).toEqual({});
	});

	it('should ignore Vpc resource type', () => {
		const result = buildResourceEnv({
			network: {
				type: ResourceType.Vpc,
				bastion: 'bastion-host',
			},
		});

		expect(result).toEqual({});
	});

	it('should handle mixed resources', () => {
		const result = buildResourceEnv({
			directValue: 'direct-string',
			secret: {
				type: ResourceType.Secret,
				value: 'secret-val',
			},
			database: {
				type: ResourceType.Postgres,
				database: 'app',
				host: 'localhost',
				password: 'pass',
				port: 5432,
				username: 'user',
			},
			bucket: {
				type: ResourceType.Bucket,
				name: 'my-bucket',
			},
		});

		expect(result).toEqual({
			DIRECT_VALUE: 'direct-string',
			SECRET: 'secret-val',
			DATABASE_NAME: 'app',
			DATABASE_HOST: 'localhost',
			DATABASE_PASSWORD: 'pass',
			DATABASE_PORT: 5432,
			DATABASE_USERNAME: 'user',
			BUCKET_NAME: 'my-bucket',
		});
	});

	it('should return empty object for empty input', () => {
		const result = buildResourceEnv({});
		expect(result).toEqual({});
	});
});
