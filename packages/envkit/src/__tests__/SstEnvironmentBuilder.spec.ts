import { describe, expect, it, vi } from 'vitest';

import {
	type Bucket,
	type Postgres,
	ResourceType,
	type Secret,
	type SnsTopic,
	SstEnvironmentBuilder,
	sstResolvers,
} from '../SstEnvironmentBuilder';

describe('SstEnvironmentBuilder', () => {
	describe('basic functionality', () => {
		it('should pass through plain string values with key transformation', () => {
			const env = new SstEnvironmentBuilder({
				appName: 'my-app',
				nodeEnv: 'production',
			}).build();

			expect(env).toEqual({
				APP_NAME: 'my-app',
				NODE_ENV: 'production',
			});
		});

		it('should handle empty input', () => {
			const env = new SstEnvironmentBuilder({}).build();
			expect(env).toEqual({});
		});
	});

	describe('Secret resource', () => {
		it('should process Secret resource correctly', () => {
			const secret: Secret = {
				type: ResourceType.Secret,
				value: 'super-secret-value',
			};

			const env = new SstEnvironmentBuilder({
				mySecret: secret,
			}).build();

			expect(env).toEqual({
				MY_SECRET: 'super-secret-value',
			});
		});

		it('should process SSTSecret resource correctly', () => {
			const secret: Secret = {
				type: ResourceType.SSTSecret,
				value: 'another-secret',
			};

			const env = new SstEnvironmentBuilder({
				appSecret: secret,
			}).build();

			expect(env).toEqual({
				APP_SECRET: 'another-secret',
			});
		});
	});

	describe('Postgres resource', () => {
		it('should process Postgres resource correctly', () => {
			const postgres: Postgres = {
				type: ResourceType.Postgres,
				database: 'myapp',
				host: 'localhost',
				password: 'password123',
				port: 5432,
				username: 'postgres',
			};

			const env = new SstEnvironmentBuilder({
				database: postgres,
			}).build();

			expect(env).toEqual({
				DATABASE_NAME: 'myapp',
				DATABASE_HOST: 'localhost',
				DATABASE_PASSWORD: 'password123',
				DATABASE_PORT: 5432,
				DATABASE_USERNAME: 'postgres',
			});
		});

		it('should process SSTPostgres resource correctly', () => {
			const postgres: Postgres = {
				type: ResourceType.SSTPostgres,
				database: 'prod_db',
				host: 'prod.example.com',
				password: 'prod-password',
				port: 5433,
				username: 'prod_user',
			};

			const env = new SstEnvironmentBuilder({
				mainDb: postgres,
			}).build();

			expect(env).toEqual({
				MAIN_DB_NAME: 'prod_db',
				MAIN_DB_HOST: 'prod.example.com',
				MAIN_DB_PASSWORD: 'prod-password',
				MAIN_DB_PORT: 5433,
				MAIN_DB_USERNAME: 'prod_user',
			});
		});
	});

	describe('Bucket resource', () => {
		it('should process Bucket resource correctly', () => {
			const bucket: Bucket = {
				type: ResourceType.Bucket,
				name: 'my-s3-bucket',
			};

			const env = new SstEnvironmentBuilder({
				uploadBucket: bucket,
			}).build();

			expect(env).toEqual({
				UPLOAD_BUCKET_NAME: 'my-s3-bucket',
			});
		});

		it('should process SSTBucket resource correctly', () => {
			const bucket: Bucket = {
				type: ResourceType.SSTBucket,
				name: 'assets-bucket-prod',
			};

			const env = new SstEnvironmentBuilder({
				assetStorage: bucket,
			}).build();

			expect(env).toEqual({
				ASSET_STORAGE_NAME: 'assets-bucket-prod',
			});
		});
	});

	describe('SnsTopic resource', () => {
		it('should process SnsTopic resource correctly', () => {
			const topic: SnsTopic = {
				type: ResourceType.SnsTopic,
				arn: 'arn:aws:sns:us-east-1:123456789:my-topic',
			};

			const env = new SstEnvironmentBuilder({
				eventsTopic: topic,
			}).build();

			expect(env).toEqual({
				EVENTS_TOPIC_ARN: 'arn:aws:sns:us-east-1:123456789:my-topic',
			});
		});
	});

	describe('noop resources', () => {
		it('should not add environment variables for ApiGatewayV2', () => {
			const env = new SstEnvironmentBuilder({
				api: {
					type: ResourceType.ApiGatewayV2,
					url: 'https://api.example.com',
				},
			}).build();

			expect(env).toEqual({});
		});

		it('should not add environment variables for Function', () => {
			const env = new SstEnvironmentBuilder({
				handler: {
					type: ResourceType.Function,
					name: 'my-lambda',
				},
			}).build();

			expect(env).toEqual({});
		});

		it('should not add environment variables for Vpc', () => {
			const env = new SstEnvironmentBuilder({
				network: {
					type: ResourceType.Vpc,
					bastion: 'bastion-host',
				},
			}).build();

			expect(env).toEqual({});
		});
	});

	describe('mixed resources', () => {
		it('should handle mix of strings and resources', () => {
			const postgres: Postgres = {
				type: ResourceType.Postgres,
				database: 'app_db',
				host: 'db.example.com',
				password: 'db-pass',
				port: 5432,
				username: 'app_user',
			};

			const secret: Secret = {
				type: ResourceType.Secret,
				value: 'jwt-secret',
			};

			const bucket: Bucket = {
				type: ResourceType.Bucket,
				name: 'uploads-bucket',
			};

			const topic: SnsTopic = {
				type: ResourceType.SnsTopic,
				arn: 'arn:aws:sns:us-east-1:123456789:events',
			};

			const env = new SstEnvironmentBuilder({
				nodeEnv: 'production',
				appName: 'My App',
				database: postgres,
				jwtSecret: secret,
				uploads: bucket,
				events: topic,
				apiVersion: 'v2',
			}).build();

			expect(env).toEqual({
				NODE_ENV: 'production',
				APP_NAME: 'My App',
				DATABASE_NAME: 'app_db',
				DATABASE_HOST: 'db.example.com',
				DATABASE_PASSWORD: 'db-pass',
				DATABASE_PORT: 5432,
				DATABASE_USERNAME: 'app_user',
				JWT_SECRET: 'jwt-secret',
				UPLOADS_NAME: 'uploads-bucket',
				EVENTS_ARN: 'arn:aws:sns:us-east-1:123456789:events',
				API_VERSION: 'v2',
			});
		});
	});

	describe('additional resolvers', () => {
		it('should allow custom resolvers', () => {
			const env = new SstEnvironmentBuilder(
				{
					custom: { type: 'my-custom-type' as const, data: 'custom-data' },
					secret: { type: ResourceType.Secret, value: 'secret-value' },
				},
				{
					'my-custom-type': (key: string, value: { data: string }) => ({
						[`${key}Data`]: value.data,
					}),
				},
			).build();

			expect(env).toEqual({
				CUSTOM_DATA: 'custom-data',
				SECRET: 'secret-value',
			});
		});

		it('should allow custom resolvers to override built-in resolvers', () => {
			const env = new SstEnvironmentBuilder(
				{
					mySecret: { type: ResourceType.Secret, value: 'original-value' },
				},
				{
					[ResourceType.Secret]: (
						key: string,
						value: { type: string; value: string },
					) => ({
						[`${key}Custom`]: `modified-${value.value}`,
					}),
				},
			).build();

			expect(env).toEqual({
				MY_SECRET_CUSTOM: 'modified-original-value',
			});
		});
	});

	describe('edge cases', () => {
		it('should handle resources with special characters in keys', () => {
			const secret: Secret = {
				type: ResourceType.Secret,
				value: 'value',
			};

			const env = new SstEnvironmentBuilder({
				'my-secret-key': secret,
				'another.secret': secret,
			}).build();

			expect(env).toEqual({
				MY_SECRET_KEY: 'value',
				ANOTHER_SECRET: 'value',
			});
		});

		it('should preserve numeric values for postgres port', () => {
			const postgres: Postgres = {
				type: ResourceType.Postgres,
				database: 'test',
				host: 'localhost',
				password: 'pass',
				port: 5432,
				username: 'user',
			};

			const env = new SstEnvironmentBuilder({
				db: postgres,
			}).build();

			expect(env.DB_PORT).toBe(5432);
			expect(typeof env.DB_PORT).toBe('number');
		});
	});

	describe('sstResolvers export', () => {
		it('should export pre-configured SST resolvers', () => {
			expect(sstResolvers).toBeDefined();
			expect(typeof sstResolvers[ResourceType.Secret]).toBe('function');
			expect(typeof sstResolvers[ResourceType.Postgres]).toBe('function');
			expect(typeof sstResolvers[ResourceType.Bucket]).toBe('function');
			expect(typeof sstResolvers[ResourceType.SnsTopic]).toBe('function');
		});
	});

	describe('ResourceType enum', () => {
		it('should have all expected resource types', () => {
			expect(ResourceType.ApiGatewayV2).toBe('sst.aws.ApiGatewayV2');
			expect(ResourceType.Postgres).toBe('sst.aws.Postgres');
			expect(ResourceType.Function).toBe('sst.aws.Function');
			expect(ResourceType.Bucket).toBe('sst.aws.Bucket');
			expect(ResourceType.Vpc).toBe('sst.aws.Vpc');
			expect(ResourceType.Secret).toBe('sst.sst.Secret');
			expect(ResourceType.SSTSecret).toBe('sst:sst:Secret');
			expect(ResourceType.SSTFunction).toBe('sst:sst:Function');
			expect(ResourceType.SSTApiGatewayV2).toBe('sst:aws:ApiGatewayV2');
			expect(ResourceType.SSTPostgres).toBe('sst:aws:Postgres');
			expect(ResourceType.SSTBucket).toBe('sst:aws:Bucket');
			expect(ResourceType.SnsTopic).toBe('sst:aws:SnsTopic');
		});
	});
});
