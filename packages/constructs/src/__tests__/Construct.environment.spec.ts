import type { EventPublisher, PublishableMessage } from '@geekmidas/events';
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { sniffService } from '../Construct';
import { c } from '../crons';
import { e } from '../endpoints';
import { f } from '../functions';
import { s } from '../subscribers';

describe('Construct environment getter', () => {
	describe('Function', () => {
		it('should return empty array when no services are provided', async () => {
			const fn = f.handle(async () => ({ success: true }));

			expect(await fn.getEnvironment()).toEqual([]);
		});

		it('should detect environment variables from a single service', async () => {
			const databaseService = {
				serviceName: 'database' as const,
				register({ envParser }) {
					return envParser.create((get) => ({
						url: get('DATABASE_URL').string(),
						port: get('DATABASE_PORT').string().transform(Number).default(5432),
					}));
				},
			} satisfies Service<'database', any>;

			const fn = f
				.services([databaseService])
				.handle(async () => ({ success: true }));

			const envVars = await fn.getEnvironment();

			expect(envVars).toEqual(['DATABASE_PORT', 'DATABASE_URL']);
		});

		it('should detect environment variables from multiple services', async () => {
			const databaseService = {
				serviceName: 'database' as const,
				register({ envParser }) {
					return envParser.create((get) => ({
						url: get('DATABASE_URL').string(),
					}));
				},
			} satisfies Service<'database', any>;

			const redisService = {
				serviceName: 'redis' as const,
				register({ envParser }) {
					return envParser.create((get) => ({
						url: get('REDIS_URL').string(),
						ttl: get('REDIS_TTL').string().transform(Number).default(3600),
					}));
				},
			} satisfies Service<'redis', any>;

			const fn = f
				.services([databaseService, redisService])
				.handle(async () => ({ success: true }));

			const envVars = await fn.getEnvironment();

			expect(envVars).toEqual(['DATABASE_URL', 'REDIS_TTL', 'REDIS_URL']);
		});

		it('should deduplicate environment variables across services', async () => {
			const service1 = {
				serviceName: 'service1' as const,
				register({ envParser }) {
					return envParser.create((get) => ({
						apiKey: get('SHARED_API_KEY').string(),
					}));
				},
			} satisfies Service<'service1', any>;

			const service2 = {
				serviceName: 'service2' as const,
				register({ envParser }) {
					return envParser.create((get) => ({
						apiKey: get('SHARED_API_KEY').string(),
					}));
				},
			} satisfies Service<'service2', any>;

			const fn = f
				.services([service1, service2])
				.handle(async () => ({ success: true }));

			const envVars = await fn.getEnvironment();

			// Should only appear once despite being used in both services
			expect(envVars).toEqual(['SHARED_API_KEY']);
		});

		it('should handle services with nested configuration', async () => {
			const configService = {
				serviceName: 'config' as const,
				register({ envParser }) {
					return envParser.create((get) => ({
						database: {
							host: get('DB_HOST').string(),
							port: get('DB_PORT').string().transform(Number),
						},
						api: {
							key: get('API_KEY').string(),
							url: get('API_URL').string().url(),
						},
					}));
				},
			} satisfies Service<'config', any>;

			const fn = f
				.services([configService])
				.handle(async () => ({ success: true }));

			const envVars = await fn.getEnvironment();

			expect(envVars).toEqual(['API_KEY', 'API_URL', 'DB_HOST', 'DB_PORT']);
		});

		it('should handle services that return non-ConfigParser values', async () => {
			const simpleService = {
				serviceName: 'simple' as const,
				register(_options: ServiceRegisterOptions) {
					// This service doesn't use envParser - just returns a plain object
					return { value: 'test' };
				},
			} satisfies Service<'simple', any>;

			const databaseService = {
				serviceName: 'database' as const,
				register({ envParser }) {
					return envParser.create((get) => ({
						url: get('DATABASE_URL').string(),
					}));
				},
			} satisfies Service<'database', any>;

			const fn = f
				.services([simpleService, databaseService])
				.handle(async () => ({ success: true }));

			const envVars = await fn.getEnvironment();

			// Should only include env vars from databaseService
			expect(envVars).toEqual(['DATABASE_URL']);
		});
	});

	describe('Endpoint', () => {
		it('should detect environment variables from endpoint services', async () => {
			const authService = {
				serviceName: 'auth' as const,
				register({ envParser }) {
					return envParser.create((get) => ({
						secret: get('JWT_SECRET').string(),
						expiresIn: get('JWT_EXPIRES_IN').string().default('15m'),
					}));
				},
			} satisfies Service<'auth', any>;

			const endpoint = e
				.services([authService])
				.get('/users')
				.handle(async () => []);

			const envVars = await endpoint.getEnvironment();

			expect(envVars).toEqual(['JWT_EXPIRES_IN', 'JWT_SECRET']);
		});

		it('should work with different HTTP methods', async () => {
			const storageService = {
				serviceName: 'storage' as const,
				register({ envParser }) {
					return envParser.create((get) => ({
						bucket: get('S3_BUCKET').string(),
						region: get('AWS_REGION').string().default('us-east-1'),
					}));
				},
			} satisfies Service<'storage', any>;

			const postEndpoint = e
				.services([storageService])
				.post('/upload')
				.handle(async () => ({ success: true }));

			const getEndpoint = e
				.services([storageService])
				.get('/files')
				.handle(async () => []);

			expect(await postEndpoint.getEnvironment()).toEqual([
				'AWS_REGION',
				'S3_BUCKET',
			]);
			expect(await getEndpoint.getEnvironment()).toEqual([
				'AWS_REGION',
				'S3_BUCKET',
			]);
		});
	});

	describe('Cron', () => {
		it('should detect environment variables from cron services', async () => {
			const emailService = {
				serviceName: 'email' as const,
				register({ envParser }) {
					return envParser.create((get) => ({
						smtpHost: get('SMTP_HOST').string(),
						smtpPort: get('SMTP_PORT').string().transform(Number).default(587),
						smtpUser: get('SMTP_USER').string(),
						smtpPass: get('SMTP_PASS').string(),
					}));
				},
			} satisfies Service<'email', any>;

			const cronJob = c
				.services([emailService])
				.schedule('rate(1 hour)')
				.handle(async () => {
					// Send daily report email
				});

			const envVars = await cronJob.getEnvironment();

			expect(envVars).toEqual([
				'SMTP_HOST',
				'SMTP_PASS',
				'SMTP_PORT',
				'SMTP_USER',
			]);
		});
	});

	describe('Subscriber', () => {
		it('should detect environment variables from subscriber services', async () => {
			type UserEvents =
				| PublishableMessage<'user.created', { userId: string }>
				| PublishableMessage<'user.updated', { userId: string }>;

			class UserEventPublisher implements EventPublisher<UserEvents> {
				async publish(_events: UserEvents[]): Promise<void> {}
			}

			const eventPublisherService: Service<'events', UserEventPublisher> = {
				serviceName: 'events' as const,
				register() {
					return new UserEventPublisher();
				},
			};

			const notificationService = {
				serviceName: 'notification' as const,
				register({ envParser }) {
					return envParser
						.create((get) => ({
							apiKey: get('NOTIFICATION_API_KEY').string(),
							endpoint: get('NOTIFICATION_ENDPOINT')
								.string()
								.url()
								.default('https://api.example.com/notify'),
						}))
						.parse();
				},
			} satisfies Service<'notification', any>;

			const subscriber = s
				.publisher(eventPublisherService)
				.services([notificationService])
				.subscribe('user.created')
				.handle(async () => {
					// Handle user created events
				});

			const envVars = await subscriber.getEnvironment();

			expect(envVars).toEqual([
				'NOTIFICATION_API_KEY',
				'NOTIFICATION_ENDPOINT',
			]);
		});
	});

	describe('Edge cases', () => {
		it('should return empty array when services array is empty', async () => {
			const fn = f.services([]).handle(async () => ({ success: true }));

			expect(await fn.getEnvironment()).toEqual([]);
		});

		it('should handle service with optional environment variables', async () => {
			const optionalConfigService = {
				serviceName: 'optionalConfig' as const,
				register({ envParser }) {
					return envParser.create((get) => ({
						required: get('REQUIRED_VAR').string(),
						optional1: get('OPTIONAL_VAR_1').string().optional(),
						optional2: get('OPTIONAL_VAR_2').string().optional(),
					}));
				},
			} satisfies Service<'optionalConfig', any>;

			const fn = f
				.services([optionalConfigService])
				.handle(async () => ({ success: true }));

			const envVars = await fn.getEnvironment();

			// Should include both required and optional variables
			expect(envVars).toEqual([
				'OPTIONAL_VAR_1',
				'OPTIONAL_VAR_2',
				'REQUIRED_VAR',
			]);
		});

		it('should be callable multiple times with consistent results', async () => {
			const service = {
				serviceName: 'testService' as const,
				register({ envParser }) {
					return envParser.create((get) => ({
						var1: get('VAR_1').string(),
						var2: get('VAR_2').string(),
					}));
				},
			} satisfies Service<'testService', any>;

			const fn = f.services([service]).handle(async () => ({ success: true }));

			const firstCall = await fn.getEnvironment();
			const secondCall = await fn.getEnvironment();
			const thirdCall = await fn.getEnvironment();

			expect(firstCall).toEqual(['VAR_1', 'VAR_2']);
			expect(secondCall).toEqual(['VAR_1', 'VAR_2']);
			expect(thirdCall).toEqual(['VAR_1', 'VAR_2']);
		});

		it('should handle services with complex transformations', async () => {
			const complexService = {
				serviceName: 'complex' as const,
				register({ envParser }) {
					return envParser.create((get) => ({
						origins: get('ALLOWED_ORIGINS')
							.string()
							.transform((v) => v.split(',')),
						flags: get('FEATURE_FLAGS')
							.string()
							.transform((v) => v.split(',').map((f) => f.trim())),
						config: get('JSON_CONFIG')
							.string()
							.transform((v) => JSON.parse(v))
							.pipe(z.record(z.string(), z.boolean())),
					}));
				},
			} satisfies Service<'complex', any>;

			const fn = f
				.services([complexService])
				.handle(async () => ({ success: true }));

			const envVars = await fn.getEnvironment();

			expect(envVars).toEqual([
				'ALLOWED_ORIGINS',
				'FEATURE_FLAGS',
				'JSON_CONFIG',
			]);
		});

		it('should capture env vars from services that parse config', async () => {
			const service = {
				serviceName: 'example' as const,
				register({ envParser }) {
					const config = envParser
						.create((get) => ({
							url: get('SERVICE_URL').string(),
						}))
						.parse();

					return { url: config.url };
				},
			} satisfies Service<'example', any>;

			// Verify env vars are captured using sniffService
			const result = await sniffService(service);
			expect(result.envVars).toEqual(['SERVICE_URL']);
			// Sniffer returns mock values, so no error expected
			expect(result.error).toBeUndefined();

			// Also verify it works with multiple services
			const anotherService = {
				serviceName: 'another' as const,
				register({ envParser }) {
					return envParser
						.create((get) => ({
							key: get('API_KEY').string(),
						}))
						.parse();
				},
			} satisfies Service<'another', any>;

			const fn = f
				.services([service, anotherService])
				.handle(async () => ({ success: true }));

			const envVars = await fn.getEnvironment();
			expect(envVars).toEqual(['API_KEY', 'SERVICE_URL']);
		});

		it('should capture env vars from async services', async () => {
			const asyncService = {
				serviceName: 'asyncService' as const,
				async register({ envParser }) {
					const config = envParser
						.create((get) => ({
							secret: get('AUTH_SECRET').string(),
							frontendUrl: get('FRONTEND_URL').string(),
						}))
						.parse();

					// Simulate an async operation
					await Promise.resolve();

					return { config };
				},
			} satisfies Service<'asyncService', any>;

			// Verify env vars are captured using sniffService
			const result = await sniffService(asyncService);
			expect(result.envVars).toEqual(['AUTH_SECRET', 'FRONTEND_URL']);
			expect(result.error).toBeUndefined();

			// Also verify via construct
			const fn = f
				.services([asyncService])
				.handle(async () => ({ success: true }));

			const envVars = await fn.getEnvironment();
			expect(envVars).toEqual(['AUTH_SECRET', 'FRONTEND_URL']);
		});

		it('should capture env vars from services with multiple config fields', async () => {
			const authService = {
				serviceName: 'auth' as const,
				register({ envParser }) {
					const config = envParser
						.create((get) => ({
							secret: get('AUTH_SECRET').string(),
							frontendUrl: get('FRONTEND_URL').string(),
							trustedOrigins: get('TRUSTED_ORIGINS').string(),
						}))
						.parse();

					return {
						secret: config.secret,
						verify: () => true,
					};
				},
			} satisfies Service<'auth', any>;

			// Verify env vars are captured
			const result = await sniffService(authService);
			expect(result.envVars).toEqual([
				'AUTH_SECRET',
				'FRONTEND_URL',
				'TRUSTED_ORIGINS',
			]);
			expect(result.error).toBeUndefined();

			// Verify via construct
			const fn = f
				.services([authService])
				.handle(async () => ({ success: true }));

			const envVars = await fn.getEnvironment();
			expect(envVars).toEqual([
				'AUTH_SECRET',
				'FRONTEND_URL',
				'TRUSTED_ORIGINS',
			]);
		});

		it('should handle multiple problematic services without crashing', async () => {
			const service1 = {
				serviceName: 'service1' as const,
				register({ envParser }) {
					envParser.create((get) => ({
						var1: get('VAR_1').string(),
					}));
					throw new Error('Service 1 failed');
				},
			} satisfies Service<'service1', any>;

			const service2 = {
				serviceName: 'service2' as const,
				register({ envParser }) {
					const config = envParser.create((get) => ({
						var2: get('VAR_2').string(),
					}));

					// Fire-and-forget rejection
					Promise.reject(new Error('Service 2 async error'));

					return config;
				},
			} satisfies Service<'service2', any>;

			const service3 = {
				serviceName: 'service3' as const,
				register({ envParser }) {
					return envParser.create((get) => ({
						var3: get('VAR_3').string(),
					}));
				},
			} satisfies Service<'service3', any>;

			// Verify individual services
			const result1 = await sniffService(service1);
			expect(result1.envVars).toEqual(['VAR_1']);
			expect(result1.error?.message).toBe('Service 1 failed');

			const result2 = await sniffService(service2);
			expect(result2.envVars).toEqual(['VAR_2']);
			// Fire-and-forget - no error captured
			expect(result2.error).toBeUndefined();

			const result3 = await sniffService(service3);
			expect(result3.envVars).toEqual(['VAR_3']);
			expect(result3.error).toBeUndefined();

			// Verify all work together in construct
			const fn = f
				.services([service1, service2, service3])
				.handle(async () => ({ success: true }));

			const envVars = await fn.getEnvironment();
			expect(envVars).toEqual(['VAR_1', 'VAR_2', 'VAR_3']);
		});
	});
});
