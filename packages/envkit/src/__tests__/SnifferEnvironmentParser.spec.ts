import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import {
	SnifferEnvironmentParser,
	sniffWithFireAndForget,
} from '../SnifferEnvironmentParser';

describe('SnifferEnvironmentParser', () => {
	describe('Environment variable tracking', () => {
		it('should track accessed environment variables', () => {
			const sniffer = new SnifferEnvironmentParser();

			sniffer.create((get) => ({
				appName: get('APP_NAME').string(),
				port: get('PORT').string().transform(Number),
			}));

			const envVars = sniffer.getEnvironmentVariables();
			expect(envVars).toEqual(['APP_NAME', 'PORT']);
		});

		it('should track variables in nested configurations', () => {
			const sniffer = new SnifferEnvironmentParser();

			sniffer.create((get) => ({
				database: {
					host: get('DB_HOST').string(),
					port: get('DB_PORT').string().transform(Number),
				},
				api: {
					key: get('API_KEY').string(),
				},
			}));

			const envVars = sniffer.getEnvironmentVariables();
			expect(envVars).toEqual(['API_KEY', 'DB_HOST', 'DB_PORT']);
		});

		it('should return sorted environment variable names', () => {
			const sniffer = new SnifferEnvironmentParser();

			sniffer.create((get) => ({
				zValue: get('Z_VALUE').string(),
				aValue: get('A_VALUE').string(),
				mValue: get('M_VALUE').string(),
			}));

			const envVars = sniffer.getEnvironmentVariables();
			expect(envVars).toEqual(['A_VALUE', 'M_VALUE', 'Z_VALUE']);
		});

		it('should deduplicate environment variable names', () => {
			const sniffer = new SnifferEnvironmentParser();

			sniffer.create((get) => ({
				value1: get('SHARED_VAR').string(),
				value2: get('SHARED_VAR').string(),
				value3: get('SHARED_VAR').string(),
			}));

			const envVars = sniffer.getEnvironmentVariables();
			expect(envVars).toEqual(['SHARED_VAR']);
		});

		it('should track variables accessed through coerce', () => {
			const sniffer = new SnifferEnvironmentParser();

			sniffer.create((get) => ({
				workers: get('NUM_WORKERS').coerce.number(),
				timeout: get('TIMEOUT').coerce.number(),
			}));

			const envVars = sniffer.getEnvironmentVariables();
			expect(envVars).toEqual(['NUM_WORKERS', 'TIMEOUT']);
		});
	});

	describe('Mock value parsing', () => {
		it('should never throw when parsing - returns mock values', () => {
			const sniffer = new SnifferEnvironmentParser();

			const config = sniffer.create((get) => ({
				required: get('REQUIRED_VAR').string(),
				alsoRequired: get('ALSO_REQUIRED').string(),
			}));

			// Should not throw even though env vars are not set
			expect(() => config.parse()).not.toThrow();
		});

		it('should return empty string for string schemas', () => {
			const sniffer = new SnifferEnvironmentParser();

			const config = sniffer
				.create((get) => ({
					value: get('STRING_VAR').string(),
				}))
				.parse();

			expect(config.value).toBe('');
		});

		it('should return 0 for number schemas', () => {
			const sniffer = new SnifferEnvironmentParser();

			const config = sniffer
				.create((get) => ({
					value: get('NUMBER_VAR').coerce.number(),
				}))
				.parse();

			expect(config.value).toBe(0);
		});

		it('should return false for boolean schemas', () => {
			const sniffer = new SnifferEnvironmentParser();

			const config = sniffer
				.create((get) => ({
					value: get('BOOL_VAR').coerce.boolean(),
				}))
				.parse();

			expect(config.value).toBe(false);
		});

		it('should return empty array for array schemas', () => {
			const sniffer = new SnifferEnvironmentParser();

			const config = sniffer
				.create((get) => ({
					value: get('ARRAY_VAR').array(z.string()),
				}))
				.parse();

			expect(config.value).toEqual([]);
		});

		it('should return undefined for optional schemas', () => {
			const sniffer = new SnifferEnvironmentParser();

			const config = sniffer
				.create((get) => ({
					value: get('OPTIONAL_VAR').string().optional(),
				}))
				.parse();

			expect(config.value).toBeUndefined();
		});

		it('should return null for nullable schemas', () => {
			const sniffer = new SnifferEnvironmentParser();

			const config = sniffer
				.create((get) => ({
					value: get('NULLABLE_VAR').string().nullable(),
				}))
				.parse();

			expect(config.value).toBeNull();
		});

		it('should handle object schemas with default values', () => {
			const sniffer = new SnifferEnvironmentParser();

			const objectSchema = z.object({
				name: z.string(),
				count: z.number(),
			});

			const config = sniffer
				.create((_get) => ({
					value: objectSchema,
				}))
				.parse();

			expect(config.value).toEqual({
				name: '',
				count: 0,
			});
		});

		it('should handle nested object schemas', () => {
			const sniffer = new SnifferEnvironmentParser();

			const nestedSchema = z.object({
				outer: z.object({
					inner: z.string(),
				}),
			});

			const config = sniffer
				.create((_get) => ({
					nested: nestedSchema,
				}))
				.parse();

			expect(config.nested).toEqual({
				outer: {
					inner: '',
				},
			});
		});

		it('should handle nested configurations', () => {
			const sniffer = new SnifferEnvironmentParser();

			const config = sniffer
				.create((get) => ({
					database: {
						host: get('DB_HOST').string(),
						port: get('DB_PORT').coerce.number(),
					},
					cache: {
						enabled: get('CACHE_ENABLED').coerce.boolean(),
					},
				}))
				.parse();

			expect(config).toEqual({
				database: {
					host: '',
					port: 0,
				},
				cache: {
					enabled: false,
				},
			});
		});

		it('should track variables with transforms', () => {
			const sniffer = new SnifferEnvironmentParser();

			sniffer.create((get) => ({
				origins: get('ALLOWED_ORIGINS')
					.string()
					.transform((v) => v.split(',')),
				port: get('PORT').string().transform(Number),
			}));

			// Should track the env vars even with transforms
			expect(sniffer.getEnvironmentVariables()).toEqual([
				'ALLOWED_ORIGINS',
				'PORT',
			]);
		});
	});

	describe('Service registration simulation', () => {
		it('should allow simulated service registration to succeed', () => {
			const sniffer = new SnifferEnvironmentParser();

			// Simulate a service that would normally fail without env vars
			const mockService = {
				serviceName: 'database' as const,
				register(envParser: SnifferEnvironmentParser) {
					const config = envParser
						.create((get) => ({
							url: get('DATABASE_URL').string(),
							poolSize: get('DB_POOL_SIZE').coerce.number(),
						}))
						.parse();

					// Service uses parsed values to create connection
					return { url: config.url, poolSize: config.poolSize };
				},
			};

			// Should not throw
			expect(() => mockService.register(sniffer)).not.toThrow();

			// Should have tracked the env vars
			expect(sniffer.getEnvironmentVariables()).toEqual([
				'DATABASE_URL',
				'DB_POOL_SIZE',
			]);
		});

		it('should work with multiple services', () => {
			const sniffer = new SnifferEnvironmentParser();

			const databaseService = {
				serviceName: 'db' as const,
				register(envParser: SnifferEnvironmentParser) {
					return envParser
						.create((get) => ({
							host: get('DB_HOST').string(),
							port: get('DB_PORT').coerce.number(),
						}))
						.parse();
				},
			};

			const cacheService = {
				serviceName: 'cache' as const,
				register(envParser: SnifferEnvironmentParser) {
					return envParser
						.create((get) => ({
							url: get('REDIS_URL').string(),
							ttl: get('CACHE_TTL').coerce.number(),
						}))
						.parse();
				},
			};

			// Register both services
			databaseService.register(sniffer);
			cacheService.register(sniffer);

			// Should have tracked all env vars from both services
			expect(sniffer.getEnvironmentVariables()).toEqual([
				'CACHE_TTL',
				'DB_HOST',
				'DB_PORT',
				'REDIS_URL',
			]);
		});

		it('should handle async service registration', async () => {
			const sniffer = new SnifferEnvironmentParser();

			const asyncService = {
				serviceName: 'async' as const,
				async register(envParser: SnifferEnvironmentParser) {
					const config = envParser
						.create((get) => ({
							apiKey: get('API_KEY').string(),
							endpoint: get('API_ENDPOINT').string(),
						}))
						.parse();

					// Simulate async initialization
					await Promise.resolve();
					return config;
				},
			};

			await expect(asyncService.register(sniffer)).resolves.not.toThrow();
			expect(sniffer.getEnvironmentVariables()).toEqual([
				'API_ENDPOINT',
				'API_KEY',
			]);
		});
	});

	describe('Edge cases', () => {
		it('should return empty array when no variables accessed', () => {
			const sniffer = new SnifferEnvironmentParser();

			sniffer.create(() => ({}));

			expect(sniffer.getEnvironmentVariables()).toEqual([]);
		});

		it('should handle deeply nested objects', () => {
			const sniffer = new SnifferEnvironmentParser();

			sniffer.create((get) => ({
				level1: {
					level2: {
						level3: {
							value: get('DEEP_VALUE').string(),
						},
					},
				},
			}));

			expect(sniffer.getEnvironmentVariables()).toEqual(['DEEP_VALUE']);
		});

		it('should handle multiple create calls', () => {
			const sniffer = new SnifferEnvironmentParser();

			sniffer.create((get) => ({
				first: get('FIRST_VAR').string(),
			}));

			sniffer.create((get) => ({
				second: get('SECOND_VAR').string(),
			}));

			// Should accumulate vars from both create calls
			expect(sniffer.getEnvironmentVariables()).toEqual([
				'FIRST_VAR',
				'SECOND_VAR',
			]);
		});
	});
});

describe('sniffWithFireAndForget', () => {
	it('should capture environment variables from synchronous operations', async () => {
		const sniffer = new SnifferEnvironmentParser();

		const result = await sniffWithFireAndForget(sniffer, () => {
			sniffer.create((get) => ({
				dbUrl: get('DATABASE_URL').string(),
				apiKey: get('API_KEY').string(),
			}));
		});

		expect(result.envVars).toEqual(['API_KEY', 'DATABASE_URL']);
		expect(result.error).toBeUndefined();
		expect(result.unhandledRejections).toEqual([]);
	});

	it('should capture environment variables from async operations', async () => {
		const sniffer = new SnifferEnvironmentParser();

		const result = await sniffWithFireAndForget(sniffer, async () => {
			await Promise.resolve();
			sniffer.create((get) => ({
				redisUrl: get('REDIS_URL').string(),
			}));
		});

		expect(result.envVars).toEqual(['REDIS_URL']);
		expect(result.error).toBeUndefined();
	});

	it('should capture error when operation throws synchronously', async () => {
		const sniffer = new SnifferEnvironmentParser();

		const result = await sniffWithFireAndForget(sniffer, () => {
			sniffer.create((get) => ({
				value: get('CAPTURED_BEFORE_ERROR').string(),
			}));
			throw new Error('Sync error');
		});

		// Should still capture env vars accessed before the error
		expect(result.envVars).toEqual(['CAPTURED_BEFORE_ERROR']);
		expect(result.error).toBeInstanceOf(Error);
		expect(result.error?.message).toBe('Sync error');
	});

	it('should capture error when async operation rejects', async () => {
		const sniffer = new SnifferEnvironmentParser();

		const result = await sniffWithFireAndForget(sniffer, async () => {
			sniffer.create((get) => ({
				value: get('CAPTURED_BEFORE_REJECT').string(),
			}));
			throw new Error('Async rejection');
		});

		expect(result.envVars).toEqual(['CAPTURED_BEFORE_REJECT']);
		expect(result.error).toBeInstanceOf(Error);
		expect(result.error?.message).toBe('Async rejection');
	});

	it('should convert non-Error throws to Error objects', async () => {
		const sniffer = new SnifferEnvironmentParser();

		const result = await sniffWithFireAndForget(sniffer, () => {
			throw 'string error';
		});

		expect(result.error).toBeInstanceOf(Error);
		expect(result.error?.message).toBe('string error');
	});

	it('should use custom settle time', async () => {
		const sniffer = new SnifferEnvironmentParser();
		const startTime = Date.now();

		await sniffWithFireAndForget(sniffer, () => {}, { settleTimeMs: 50 });

		const elapsed = Date.now() - startTime;
		// Should wait approximately 50ms (allow small timing variance)
		expect(elapsed).toBeGreaterThanOrEqual(45);
		expect(elapsed).toBeLessThan(200);
	});

	it('should return empty arrays when no vars accessed and no errors', async () => {
		const sniffer = new SnifferEnvironmentParser();

		const result = await sniffWithFireAndForget(sniffer, () => {
			// Do nothing
		});

		expect(result.envVars).toEqual([]);
		expect(result.error).toBeUndefined();
		expect(result.unhandledRejections).toEqual([]);
	});
});
