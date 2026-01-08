import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { ConfigParser } from '../EnvironmentParser';

describe('ConfigParser', () => {
	describe('Basic functionality', () => {
		it('should parse simple Zod schemas', () => {
			const config = {
				name: z.string().default('Test'),
				age: z.number().default(25),
				active: z.boolean().default(true),
			};

			const parser = new ConfigParser(config);
			const result = parser.parse();

			expect(result).toEqual({
				name: 'Test',
				age: 25,
				active: true,
			});
		});

		it('should handle optional values', () => {
			const config = {
				required: z.string().default('value'),
				optional: z.string().optional(),
			};

			const parser = new ConfigParser(config);
			const result = parser.parse();

			expect(result).toEqual({
				required: 'value',
				optional: undefined,
			});
		});

		it('should validate and use provided default values', () => {
			const config = {
				port: z.number().default(3000),
				host: z.string().default('localhost'),
				debug: z.boolean().default(false),
			};

			const parser = new ConfigParser(config);
			const result = parser.parse();

			expect(result).toEqual({
				port: 3000,
				host: 'localhost',
				debug: false,
			});
		});
	});

	describe('Nested objects', () => {
		it('should parse nested configuration objects', () => {
			const config = {
				database: {
					host: z.string().default('localhost'),
					port: z.number().default(5432),
					ssl: z.boolean().default(false),
				},
				api: {
					key: z.string().default('default-key'),
					timeout: z.number().default(5000),
				},
			};

			const parser = new ConfigParser(config);
			const result = parser.parse();

			expect(result).toEqual({
				database: {
					host: 'localhost',
					port: 5432,
					ssl: false,
				},
				api: {
					key: 'default-key',
					timeout: 5000,
				},
			});
		});

		it('should handle deeply nested objects', () => {
			const config = {
				app: {
					name: z.string().default('MyApp'),
					version: z.string().default('1.0.0'),
					features: {
						auth: {
							enabled: z.boolean().default(true),
							provider: z.string().default('local'),
						},
						cache: {
							enabled: z.boolean().default(false),
							ttl: z.number().default(3600),
						},
					},
				},
			};

			const parser = new ConfigParser(config);
			const result = parser.parse();

			expect(result).toEqual({
				app: {
					name: 'MyApp',
					version: '1.0.0',
					features: {
						auth: {
							enabled: true,
							provider: 'local',
						},
						cache: {
							enabled: false,
							ttl: 3600,
						},
					},
				},
			});
		});

		it('should handle mixed nested and flat configuration', () => {
			const config = {
				appName: z.string().default('Test App'),
				database: {
					url: z.string().default('postgres://localhost/test'),
					poolSize: z.number().default(10),
				},
				port: z.number().default(3000),
				features: {
					logging: {
						level: z.string().default('info'),
						pretty: z.boolean().default(true),
					},
				},
			};

			const parser = new ConfigParser(config);
			const result = parser.parse();

			expect(result).toEqual({
				appName: 'Test App',
				database: {
					url: 'postgres://localhost/test',
					poolSize: 10,
				},
				port: 3000,
				features: {
					logging: {
						level: 'info',
						pretty: true,
					},
				},
			});
		});
	});

	describe('Error handling', () => {
		it('should throw ZodError for schemas without defaults', () => {
			const config = {
				required: z.string(),
				alsoRequired: z.number(),
			};

			const parser = new ConfigParser(config);

			expect(() => parser.parse()).toThrow(z.ZodError);
		});

		it('should collect multiple validation errors', () => {
			const config = {
				field1: z.string(),
				field2: z.number(),
				field3: z.boolean(),
			};

			const parser = new ConfigParser(config);

			try {
				parser.parse();
				// Should not reach here
				expect(true).toBe(false);
			} catch (error) {
				expect(error).toBeInstanceOf(z.ZodError);
				const zodError = error as z.ZodError;
				expect(zodError.issues).toHaveLength(3);
			}
		});

		it('should include correct paths in nested validation errors', () => {
			const config = {
				database: {
					host: z.string(),
					port: z.number(),
				},
				api: {
					key: z.string(),
				},
			};

			const parser = new ConfigParser(config);

			try {
				parser.parse();
				// Should not reach here
				expect(true).toBe(false);
			} catch (error) {
				expect(error).toBeInstanceOf(z.ZodError);
				const zodError = error as z.ZodError;

				const paths = zodError.issues.map((err) => err.path.join('.'));
				expect(paths).toContain('database.host');
				expect(paths).toContain('database.port');
				expect(paths).toContain('api.key');
			}
		});

		it('should use default values that pass validation', () => {
			const config = {
				port: z.number().min(1000).max(65535).default(3000),
				email: z.string().email().default('admin@example.com'),
			};

			const parser = new ConfigParser(config);
			const result = parser.parse();

			expect(result).toEqual({
				port: 3000,
				email: 'admin@example.com',
			});
		});
	});

	describe('Type safety', () => {
		it('should infer correct types for simple configuration', () => {
			const config = {
				name: z.string().default('test'),
				count: z.number().default(42),
				enabled: z.boolean().default(true),
			};

			const parser = new ConfigParser(config);
			const result = parser.parse();

			// TypeScript should infer the correct types
			type ResultType = typeof result;
			type ExpectedType = {
				name: string;
				count: number;
				enabled: boolean;
			};

			const _typeCheck: ResultType extends ExpectedType ? true : false = true;
			const _typeCheck2: ExpectedType extends ResultType ? true : false = true;

			expect(_typeCheck).toBe(true);
			expect(_typeCheck2).toBe(true);
		});

		it('should infer correct types for nested configuration', () => {
			const config = {
				database: {
					host: z.string().default('localhost'),
					port: z.number().default(5432),
				},
				features: {
					auth: z.boolean().default(true),
				},
			};

			const parser = new ConfigParser(config);
			const result = parser.parse();

			// TypeScript should infer the correct nested structure
			type ResultType = typeof result;
			type ExpectedType = {
				database: { host: string; port: number };
				features: { auth: boolean };
			};

			const _typeCheck: ResultType extends ExpectedType ? true : false = true;
			const _typeCheck2: ExpectedType extends ResultType ? true : false = true;

			expect(_typeCheck).toBe(true);
			expect(_typeCheck2).toBe(true);
		});

		it('should handle optional types correctly', () => {
			const config = {
				required: z.string().default('value'),
				optional: z.string().optional(),
				nullable: z.string().nullable().default(null),
			};

			const parser = new ConfigParser(config);
			const result = parser.parse();
		});
	});

	describe('Complex schemas', () => {
		it('should handle enum schemas', () => {
			const config = {
				environment: z
					.enum(['development', 'staging', 'production'])
					.default('development'),
				logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
			};

			const parser = new ConfigParser(config);
			const result = parser.parse();

			expect(result).toEqual({
				environment: 'development',
				logLevel: 'info',
			});
		});

		it('should handle union schemas', () => {
			const config = {
				port: z.union([z.string(), z.number()]).default(3000),
				timeout: z.union([z.number(), z.null()]).default(null),
			};

			const parser = new ConfigParser(config);
			const result = parser.parse();

			expect(result).toEqual({
				port: 3000,
				timeout: null,
			});
		});

		it('should handle array schemas', () => {
			const config = {
				tags: z.array(z.string()).default(['tag1', 'tag2']),
				ports: z.array(z.number()).default([3000, 3001]),
			};

			const parser = new ConfigParser(config);
			const result = parser.parse();

			expect(result).toEqual({
				tags: ['tag1', 'tag2'],
				ports: [3000, 3001],
			});
		});

		it('should handle record schemas', () => {
			const config = {
				metadata: z
					.record(z.string(), z.string())
					.default({ key1: 'value1', key2: 'value2' }),
				counters: z
					.record(z.string(), z.number())
					.default({ count1: 1, count2: 2 }),
			};

			const parser = new ConfigParser(config);
			const result = parser.parse();

			expect(result).toEqual({
				metadata: { key1: 'value1', key2: 'value2' },
				counters: { count1: 1, count2: 2 },
			});
		});

		it('should handle transformed schemas', () => {
			const config = {
				portString: z.string().transform(Number).default(8080),
				booleanString: z
					.string()
					.transform((v) => v === 'true')
					.default(false),
				jsonString: z
					.string()
					.transform((v) => JSON.parse(v))
					.default({ key: 'value' }),
			};

			const parser = new ConfigParser(config);
			const result = parser.parse();

			expect(result).toEqual({
				portString: 8080,
				booleanString: false,
				jsonString: { key: 'value' },
			});
		});
	});
});
