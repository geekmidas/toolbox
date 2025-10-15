import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { EnvironmentParser } from '../EnvironmentParser';

describe('EnvironmentParser', () => {
  describe('Basic parsing functionality', () => {
    it('should parse simple string values', () => {
      const env = { APP_NAME: 'Test App' };
      const parser = new EnvironmentParser(env);

      const config = parser
        .create((get) => ({
          appName: get('APP_NAME').string(),
        }))
        .parse();

      expect(config).toEqual({ appName: 'Test App' });
    });

    it('should parse with default values when env var is missing', () => {
      const env = {};
      const parser = new EnvironmentParser(env);

      const config = parser
        .create((get) => ({
          appName: get('APP_NAME').string().default('Default App'),
          port: get('PORT').string().transform(Number).default(3000),
        }))
        .parse();

      expect(config).toEqual({
        appName: 'Default App',
        port: 3000,
      });
    });

    it('should transform string to number', () => {
      const env = { PORT: '8080' };
      const parser = new EnvironmentParser(env);

      const config = parser
        .create((get) => ({
          port: get('PORT').string().transform(Number),
        }))
        .parse();

      expect(config).toEqual({ port: 8080 });
    });

    it('should transform string to boolean', () => {
      const env = {
        FEATURE_ENABLED: 'true',
        FEATURE_DISABLED: 'false',
        FEATURE_TRUTHY: 'yes',
      };
      const parser = new EnvironmentParser(env);

      const config = parser
        .create((get) => ({
          enabled: get('FEATURE_ENABLED')
            .string()
            .transform((v) => v === 'true'),
          disabled: get('FEATURE_DISABLED')
            .string()
            .transform((v) => v === 'true'),
          truthy: get('FEATURE_TRUTHY')
            .string()
            .transform((v) => v === 'true'),
        }))
        .parse();

      expect(config).toEqual({
        enabled: true,
        disabled: false,
        truthy: false,
      });
    });

    it('should handle optional values', () => {
      const env = { REQUIRED: 'value' };
      const parser = new EnvironmentParser(env);

      const config = parser
        .create((get) => ({
          required: get('REQUIRED').string(),
          optional: get('OPTIONAL').string().optional(),
        }))
        .parse();

      expect(config).toEqual({
        required: 'value',
        optional: undefined,
      });
    });

    it('should validate URLs', () => {
      const env = {
        VALID_URL: 'https://example.com',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      };
      const parser = new EnvironmentParser(env);

      const config = parser
        .create((get) => ({
          apiUrl: get('VALID_URL').string().url(),
          dbUrl: get('DATABASE_URL').string().url(),
        }))
        .parse();

      expect(config).toEqual({
        apiUrl: 'https://example.com',
        dbUrl: 'postgresql://user:pass@localhost:5432/db',
      });
    });

    it('should validate email addresses', () => {
      const env = { ADMIN_EMAIL: 'admin@example.com' };
      const parser = new EnvironmentParser(env);

      const config = parser
        .create((get) => ({
          adminEmail: get('ADMIN_EMAIL').string().email(),
        }))
        .parse();

      expect(config).toEqual({ adminEmail: 'admin@example.com' });
    });

    it('should validate enums', () => {
      const env = { NODE_ENV: 'production' };
      const parser = new EnvironmentParser(env);

      const config = parser
        .create((get) => ({
          env: get('NODE_ENV').enum(['development', 'staging', 'production']),
        }))
        .parse();

      expect(config).toEqual({ env: 'production' });
    });
  });

  describe('Nested configuration', () => {
    it('should handle nested objects', () => {
      const env = {
        DB_HOST: 'localhost',
        DB_PORT: '5432',
        DB_NAME: 'myapp',
        API_KEY: 'secret123',
        API_URL: 'https://api.example.com',
      };
      const parser = new EnvironmentParser(env);

      const config = parser
        .create((get) => ({
          database: {
            host: get('DB_HOST').string(),
            port: get('DB_PORT').string().transform(Number),
            name: get('DB_NAME').string(),
          },
          api: {
            key: get('API_KEY').string(),
            url: get('API_URL').string().url(),
          },
        }))
        .parse();

      expect(config).toEqual({
        database: {
          host: 'localhost',
          port: 5432,
          name: 'myapp',
        },
        api: {
          key: 'secret123',
          url: 'https://api.example.com',
        },
      });
    });

    it('should handle deeply nested objects', () => {
      const env = {
        FEATURE_AUTH_ENABLED: 'true',
        FEATURE_AUTH_PROVIDER: 'oauth',
        FEATURE_CACHE_ENABLED: 'false',
        FEATURE_CACHE_TTL: '3600',
      };
      const parser = new EnvironmentParser(env);

      const config = parser
        .create((get) => ({
          features: {
            authentication: {
              enabled: get('FEATURE_AUTH_ENABLED')
                .string()
                .transform((v) => v === 'true'),
              provider: get('FEATURE_AUTH_PROVIDER').string(),
            },
            cache: {
              enabled: get('FEATURE_CACHE_ENABLED')
                .string()
                .transform((v) => v === 'true'),
              ttl: get('FEATURE_CACHE_TTL').string().transform(Number),
            },
          },
        }))
        .parse();

      expect(config).toEqual({
        features: {
          authentication: {
            enabled: true,
            provider: 'oauth',
          },
          cache: {
            enabled: false,
            ttl: 3600,
          },
        },
      });
    });

    it('should handle mixed nested objects with defaults', () => {
      const env = {
        DB_HOST: 'custom-host',
        REDIS_TTL: '7200',
      };
      const parser = new EnvironmentParser(env);

      const config = parser
        .create((get) => ({
          database: {
            host: get('DB_HOST').string(),
            port: get('DB_PORT').string().transform(Number).default(5432),
            ssl: get('DB_SSL')
              .string()
              .transform((v) => v === 'true')
              .default(false),
          },
          cache: {
            redis: {
              host: get('REDIS_HOST').string().default('localhost'),
              port: get('REDIS_PORT').string().transform(Number).default(6379),
              ttl: get('REDIS_TTL').string().transform(Number),
            },
          },
        }))
        .parse();

      expect(config).toEqual({
        database: {
          host: 'custom-host',
          port: 5432,
          ssl: false,
        },
        cache: {
          redis: {
            host: 'localhost',
            port: 6379,
            ttl: 7200,
          },
        },
      });
    });
  });

  describe('Error handling and validation', () => {
    it('should throw ZodError for missing required values', () => {
      const env = {};
      const parser = new EnvironmentParser(env);

      expect(() => {
        parser
          .create((get) => ({
            required: get('REQUIRED_VAR').string(),
          }))
          .parse();
      }).toThrow(z.ZodError);
    });

    it('should throw ZodError with descriptive error messages', () => {
      const env = {};
      const parser = new EnvironmentParser(env);

      try {
        parser
          .create((get) => ({
            apiKey: get('API_KEY').string().min(32),
            dbUrl: get('DATABASE_URL').string().url(),
          }))
          .parse();
      } catch (error) {
        expect(error).toBeInstanceOf(z.ZodError);
        const zodError = error as z.ZodError;

        expect(zodError.issues).toHaveLength(2);
        expect(zodError.issues[0].message).toContain(
          'Environment variable "API_KEY"',
        );
        expect(zodError.issues[1].message).toContain(
          'Environment variable "DATABASE_URL"',
        );
      }
    });

    it('should validate minimum string length', () => {
      const env = { API_KEY: 'short' };
      const parser = new EnvironmentParser(env);

      expect(() => {
        parser
          .create((get) => ({
            apiKey: get('API_KEY').string().min(32),
          }))
          .parse();
      }).toThrow(z.ZodError);
    });

    it('should validate maximum string length', () => {
      const env = { SHORT_TEXT: 'a'.repeat(100) };
      const parser = new EnvironmentParser(env);

      expect(() => {
        parser
          .create((get) => ({
            shortText: get('SHORT_TEXT').string().max(50),
          }))
          .parse();
      }).toThrow(z.ZodError);
    });

    it('should validate exact string length', () => {
      const env = {
        VALID_KEY: 'a'.repeat(32),
        INVALID_KEY: 'short',
      };
      const parser = new EnvironmentParser(env);

      const validConfig = parser
        .create((get) => ({
          key: get('VALID_KEY').string().length(32),
        }))
        .parse();

      expect(validConfig).toEqual({ key: 'a'.repeat(32) });

      expect(() => {
        parser
          .create((get) => ({
            key: get('INVALID_KEY').string().length(32),
          }))
          .parse();
      }).toThrow(z.ZodError);
    });

    it('should validate invalid URLs', () => {
      const env = { INVALID_URL: 'not-a-url' };
      const parser = new EnvironmentParser(env);

      expect(() => {
        parser
          .create((get) => ({
            url: get('INVALID_URL').string().url(),
          }))
          .parse();
      }).toThrow(z.ZodError);
    });

    it('should validate invalid email addresses', () => {
      const env = { INVALID_EMAIL: 'not-an-email' };
      const parser = new EnvironmentParser(env);

      expect(() => {
        parser
          .create((get) => ({
            email: get('INVALID_EMAIL').string().email(),
          }))
          .parse();
      }).toThrow(z.ZodError);
    });

    it('should validate invalid enum values', () => {
      const env = { NODE_ENV: 'invalid' };
      const parser = new EnvironmentParser(env);

      expect(() => {
        parser
          .create((get) => ({
            env: get('NODE_ENV').enum(['development', 'staging', 'production']),
          }))
          .parse();
      }).toThrow(z.ZodError);
    });

    it('should validate number ranges', () => {
      const env = {
        VALID_PORT: '8080',
        INVALID_PORT_LOW: '0',
        INVALID_PORT_HIGH: '70000',
      };
      const parser = new EnvironmentParser(env);

      // Test valid port number
      const validConfig = parser
        .create((get) => ({
          port: get('VALID_PORT').coerce.number().min(1).max(65535),
        }))
        .parse();

      expect(validConfig).toEqual({ port: 8080 });

      // Test port number too low (0 < 1)
      expect(() => {
        parser
          .create((get) => ({
            port: get('INVALID_PORT_LOW').coerce.number().min(1).max(65535),
          }))
          .parse();
      }).toThrow(z.ZodError);

      // Test port number too high (70000 > 65535)
      expect(() => {
        parser
          .create((get) => ({
            port: get('INVALID_PORT_HIGH').coerce.number().min(1).max(65535),
          }))
          .parse();
      }).toThrow(z.ZodError);
    });

    it('should handle transformation errors', () => {
      const env = { INVALID_NUMBER: 'not-a-number' };
      const parser = new EnvironmentParser(env);

      expect(() => {
        parser
          .create((get) => ({
            number: get('INVALID_NUMBER')
              .string()
              .transform((v) => {
                const num = Number(v);
                if (isNaN(num)) throw new Error('Invalid number');
                return num;
              }),
          }))
          .parse();
      }).toThrow();
    });
  });

  describe('Complex scenarios', () => {
    it('should handle array transformations', () => {
      const env = {
        ALLOWED_ORIGINS:
          'http://localhost:3000,https://example.com,https://app.example.com',
        FEATURE_FLAGS: 'auth,cache,notifications',
      };
      const parser = new EnvironmentParser(env);

      const config = parser
        .create((get) => ({
          cors: {
            origins: get('ALLOWED_ORIGINS')
              .string()
              .transform((origins) => origins.split(',').map((o) => o.trim())),
          },
          features: get('FEATURE_FLAGS')
            .string()
            .transform((flags) => flags.split(',').map((f) => f.trim())),
        }))
        .parse();

      expect(config).toEqual({
        cors: {
          origins: [
            'http://localhost:3000',
            'https://example.com',
            'https://app.example.com',
          ],
        },
        features: ['auth', 'cache', 'notifications'],
      });
    });

    it('should handle JSON parsing', () => {
      const env = {
        FEATURE_CONFIG: '{"auth":true,"cache":false,"debug":true}',
        RATE_LIMITS: '{"requests":100,"window":60000}',
      };
      const parser = new EnvironmentParser(env);

      const config = parser
        .create((get) => ({
          features: get('FEATURE_CONFIG')
            .string()
            .transform((str) => JSON.parse(str))
            .pipe(z.record(z.string(), z.boolean())),
          rateLimits: get('RATE_LIMITS')
            .string()
            .transform((str) => JSON.parse(str))
            .pipe(z.object({ requests: z.number(), window: z.number() })),
        }))
        .parse();

      expect(config).toEqual({
        features: {
          auth: true,
          cache: false,
          debug: true,
        },
        rateLimits: {
          requests: 100,
          window: 60000,
        },
      });
    });

    it('should handle custom refinements', () => {
      const env = {
        CORS_ORIGINS: 'https://example.com,https://app.example.com',
        API_KEYS:
          'key1234567890123456789012345678901,key2345678901234567890123456789012',
      };
      const parser = new EnvironmentParser(env);

      const config = parser
        .create((get) => ({
          cors: {
            origins: get('CORS_ORIGINS')
              .string()
              .transform((origins) => origins.split(',').map((o) => o.trim()))
              .refine(
                (origins) => origins.every((o) => o.startsWith('https://')),
                { message: 'All CORS origins must use HTTPS' },
              ),
          },
          apiKeys: get('API_KEYS')
            .string()
            .transform((keys) => keys.split(',').map((k) => k.trim()))
            .pipe(z.array(z.string().min(32))),
        }))
        .parse();

      expect(config).toEqual({
        cors: {
          origins: ['https://example.com', 'https://app.example.com'],
        },
        apiKeys: [
          'key1234567890123456789012345678901',
          'key2345678901234567890123456789012',
        ],
      });
    });

    it('should fail refinements with descriptive errors', () => {
      const env = {
        CORS_ORIGINS: 'http://example.com,https://app.example.com',
      };
      const parser = new EnvironmentParser(env);

      expect(() => {
        parser
          .create((get) => ({
            cors: {
              origins: get('CORS_ORIGINS')
                .string()
                .transform((origins) => origins.split(',').map((o) => o.trim()))
                .refine(
                  (origins) => origins.every((o) => o.startsWith('https://')),
                  { message: 'All CORS origins must use HTTPS' },
                ),
            },
          }))
          .parse();
      }).toThrow(z.ZodError);
    });
  });

  describe('Type inference', () => {
    it('should correctly infer string types', () => {
      const env = { APP_NAME: 'Test App' };
      const parser = new EnvironmentParser(env);

      const config = parser
        .create((get) => ({
          appName: get('APP_NAME').string(),
        }))
        .parse();

      // TypeScript should infer this as { appName: string }
      type ConfigType = typeof config;
      type ExpectedType = { appName: string };

      // This will compile if types match correctly
      const _typeCheck: ConfigType extends ExpectedType ? true : false = true;
      const _typeCheck2: ExpectedType extends ConfigType ? true : false = true;

      expect(_typeCheck).toBe(true);
      expect(_typeCheck2).toBe(true);
    });

    it('should correctly infer number types after transformation', () => {
      const env = { PORT: '3000' };
      const parser = new EnvironmentParser(env);

      const config = parser
        .create((get) => ({
          port: get('PORT').string().transform(Number),
        }))
        .parse();

      // TypeScript should infer this as { port: number }
      type ConfigType = typeof config;
      type ExpectedType = { port: number };

      const _typeCheck: ConfigType extends ExpectedType ? true : false = true;
      const _typeCheck2: ExpectedType extends ConfigType ? true : false = true;

      expect(_typeCheck).toBe(true);
      expect(_typeCheck2).toBe(true);
    });

    it('should correctly infer boolean types after transformation', () => {
      const env = { FEATURE_ENABLED: 'true' };
      const parser = new EnvironmentParser(env);

      const config = parser
        .create((get) => ({
          enabled: get('FEATURE_ENABLED')
            .string()
            .transform((v) => v === 'true'),
        }))
        .parse();

      // TypeScript should infer this as { enabled: boolean }
      type ConfigType = typeof config;
      type ExpectedType = { enabled: boolean };

      const _typeCheck: ConfigType extends ExpectedType ? true : false = true;
      const _typeCheck2: ExpectedType extends ConfigType ? true : false = true;

      expect(_typeCheck).toBe(true);
      expect(_typeCheck2).toBe(true);
    });

    it('should correctly infer optional types', () => {
      const env = { REQUIRED: 'value' };
      const parser = new EnvironmentParser(env);

      const config = parser
        .create((get) => ({
          required: get('REQUIRED').string(),
          optional: get('OPTIONAL').string().optional(),
        }))
        .parse();
    });

    it('should correctly infer nested object types', () => {
      const env = {
        DB_HOST: 'localhost',
        DB_PORT: '5432',
        API_KEY: 'secret',
      };
      const parser = new EnvironmentParser(env);

      const config = parser
        .create((get) => ({
          database: {
            host: get('DB_HOST').string(),
            port: get('DB_PORT').string().transform(Number),
          },
          api: {
            key: get('API_KEY').string(),
          },
        }))
        .parse();

      // TypeScript should infer the correct nested structure
      type ConfigType = typeof config;
      type ExpectedType = {
        database: { host: string; port: number };
        api: { key: string };
      };

      const _typeCheck: ConfigType extends ExpectedType ? true : false = true;
      const _typeCheck2: ExpectedType extends ConfigType ? true : false = true;

      expect(_typeCheck).toBe(true);
      expect(_typeCheck2).toBe(true);
    });
  });

  describe('Environment variable tracking', () => {
    it('should track accessed environment variables', () => {
      const env = { APP_NAME: 'Test App', PORT: '3000' };
      const parser = new EnvironmentParser(env);

      const config = parser.create((get) => ({
        appName: get('APP_NAME').string(),
        port: get('PORT').string().transform(Number),
      }));

      const envVars = config.getEnvironmentVariables();

      expect(envVars).toEqual(['APP_NAME', 'PORT']);
    });

    it('should track variables even when not parsed', () => {
      const env = {};
      const parser = new EnvironmentParser(env);

      const config = parser.create((get) => ({
        database: get('DATABASE_URL').string().optional(),
        redis: get('REDIS_URL').string().optional(),
      }));

      // Should track even without calling parse()
      const envVars = config.getEnvironmentVariables();

      expect(envVars).toEqual(['DATABASE_URL', 'REDIS_URL']);
    });

    it('should track variables in nested configurations', () => {
      const env = {
        DB_HOST: 'localhost',
        DB_PORT: '5432',
        API_KEY: 'secret',
      };
      const parser = new EnvironmentParser(env);

      const config = parser.create((get) => ({
        database: {
          host: get('DB_HOST').string(),
          port: get('DB_PORT').string().transform(Number),
        },
        api: {
          key: get('API_KEY').string(),
        },
      }));

      const envVars = config.getEnvironmentVariables();

      expect(envVars).toEqual(['API_KEY', 'DB_HOST', 'DB_PORT']);
    });

    it('should return sorted environment variable names', () => {
      const env = {};
      const parser = new EnvironmentParser(env);

      const config = parser.create((get) => ({
        zValue: get('Z_VALUE').string().optional(),
        aValue: get('A_VALUE').string().optional(),
        mValue: get('M_VALUE').string().optional(),
      }));

      const envVars = config.getEnvironmentVariables();

      // Should be sorted alphabetically
      expect(envVars).toEqual(['A_VALUE', 'M_VALUE', 'Z_VALUE']);
    });

    it('should deduplicate environment variable names', () => {
      const env = { SHARED_VAR: 'value' };
      const parser = new EnvironmentParser(env);

      const config = parser.create((get) => ({
        value1: get('SHARED_VAR').string(),
        value2: get('SHARED_VAR').string(),
        value3: get('SHARED_VAR').string(),
      }));

      const envVars = config.getEnvironmentVariables();

      // Should only appear once despite being accessed 3 times
      expect(envVars).toEqual(['SHARED_VAR']);
    });

    it('should track variables with default values', () => {
      const env = {};
      const parser = new EnvironmentParser(env);

      const config = parser.create((get) => ({
        port: get('PORT').string().default('3000'),
        host: get('HOST').string().default('localhost'),
      }));

      const envVars = config.getEnvironmentVariables();

      // Should track even when defaults are used
      expect(envVars).toEqual(['HOST', 'PORT']);
    });

    it('should work with empty configuration', () => {
      const env = {};
      const parser = new EnvironmentParser(env);

      const config = parser.create(() => ({}));

      const envVars = config.getEnvironmentVariables();

      expect(envVars).toEqual([]);
    });

    it('should track variables accessed through coerce', () => {
      const env = { NUM_WORKERS: '4', TIMEOUT: '30000' };
      const parser = new EnvironmentParser(env);

      const config = parser.create((get) => ({
        workers: get('NUM_WORKERS').coerce.number(),
        timeout: get('TIMEOUT').coerce.number(),
      }));

      const envVars = config.getEnvironmentVariables();

      expect(envVars).toEqual(['NUM_WORKERS', 'TIMEOUT']);
    });

    it('should track variables with complex transformations', () => {
      const env = {
        ALLOWED_ORIGINS: 'http://localhost,https://example.com',
        FEATURE_FLAGS: 'auth,cache',
      };
      const parser = new EnvironmentParser(env);

      const config = parser.create((get) => ({
        origins: get('ALLOWED_ORIGINS')
          .string()
          .transform((v) => v.split(',')),
        features: get('FEATURE_FLAGS')
          .string()
          .transform((v) => v.split(',')),
      }));

      const envVars = config.getEnvironmentVariables();

      expect(envVars).toEqual(['ALLOWED_ORIGINS', 'FEATURE_FLAGS']);
    });
  });
});
