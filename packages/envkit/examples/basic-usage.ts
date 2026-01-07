import { EnvironmentParser } from '@geekmidas/envkit';
import { z } from 'zod';

const parser = new EnvironmentParser(process.env as {});
// Example 1: Basic configuration
export function basicExample() {
  const config = parser.create((get) => ({
    appName: get('APP_NAME').string().default('My App'),
    port: get('PORT').string().transform(Number).default(3000),
    isDevelopment: get('NODE_ENV')
      .string()
      .transform((env) => env === 'development'),
  }));

  const result = config.parse();

  return result;
}

// Example 2: Database configuration
export function databaseExample() {
  const config = parser.create((get) => ({
    database: {
      host: get('DB_HOST').string().default('localhost'),
      port: get('DB_PORT').string().transform(Number).default(5432),
      name: get('DB_NAME').string(),
      user: get('DB_USER').string(),
      password: get('DB_PASSWORD').string(),
      ssl: get('DB_SSL')
        .string()
        .transform((v) => v === 'true')
        .default(false),
      poolSize: get('DB_POOL_SIZE')
        .string()
        .transform(Number)
        .int()
        .min(1)
        .max(100)
        .default(10),
    },
  }));

  return config.parse();
}

// Example 3: API configuration with validation
export function apiConfigExample() {
  const config = parser.create((get) => ({
    api: {
      baseUrl: get('API_BASE_URL').url(),
      key: get('API_KEY').string().min(32),
      secret: get('API_SECRET').string().min(64),
      timeout: get('API_TIMEOUT').string().transform(Number).default(5000),
      retries: get('API_RETRIES').string().transform(Number).default(3),
      endpoints: {
        users: get('API_ENDPOINT_USERS').string().default('/api/v1/users'),
        auth: get('API_ENDPOINT_AUTH').string().default('/api/v1/auth'),
        products: get('API_ENDPOINT_PRODUCTS')
          .string()
          .default('/api/v1/products'),
      },
    },
  }));

  return config.parse();
}

// Example 4: Feature flags and complex validation
export function featureFlagsExample() {
  const config = parser.create((get) => ({
    features: {
      authentication: get('FEATURE_AUTH')
        .string()
        .transform((v) => v === 'true')
        .default(true),
      rateLimit: get('FEATURE_RATE_LIMIT')
        .string()
        .transform((v) => v === 'true')
        .default(true),
      cache: get('FEATURE_CACHE')
        .string()
        .transform((v) => v === 'true')
        .default(false),
      beta: {
        enabled: get('FEATURE_BETA')
          .string()
          .transform((v) => v === 'true')
          .default(false),
        allowedUsers: get('FEATURE_BETA_USERS')
          .string()
          .transform((users) =>
            users ? users.split(',').map((u) => u.trim()) : [],
          )
          .default([]),
      },
    },
    rateLimit: {
      windowMs: get('RATE_LIMIT_WINDOW_MS')
        .string()
        .transform(Number)
        .default(60000),
      maxRequests: get('RATE_LIMIT_MAX_REQUESTS')
        .string()
        .transform(Number)
        .default(100),
    },
  }));

  return config.parse();
}

// Example 5: Email configuration with refinements
export function emailConfigExample() {
  const config = parser.create((get) => ({
    email: {
      provider: get('EMAIL_PROVIDER').enum(['sendgrid', 'mailgun', 'ses']),
      apiKey: get('EMAIL_API_KEY').string().min(20),
      from: {
        name: get('EMAIL_FROM_NAME').string().default('Support Team'),
        address: get('EMAIL_FROM_ADDRESS').string().email(),
      },
      replyTo: get('EMAIL_REPLY_TO').string().email().optional(),
      templates: {
        welcome: get('EMAIL_TEMPLATE_WELCOME').string().uuid(),
        resetPassword: get('EMAIL_TEMPLATE_RESET_PASSWORD').string().uuid(),
        invoice: get('EMAIL_TEMPLATE_INVOICE').string().uuid().optional(),
      },
      smtp: {
        host: get('SMTP_HOST').string().optional(),
        port: get('SMTP_PORT').string().transform(Number).optional(),
        secure: get('SMTP_SECURE')
          .string()
          .transform((v) => v === 'true')
          .default(true),
      },
    },
  }));

  return config.parse();
}

// Example 6: Multi-environment configuration
export function multiEnvironmentExample() {
  const env = process.env.NODE_ENV || 'development';

  // Different config sources based on environment
  const configSource = {
    ...process.env,
    // Override with environment-specific values
    ...(env === 'production'
      ? {
          LOG_LEVEL: 'error',
          DEBUG: 'false',
        }
      : {
          LOG_LEVEL: 'debug',
          DEBUG: 'true',
        }),
  };

  const parser = new EnvironmentParser(configSource);

  const config = parser.create((get) => ({
    env: get('NODE_ENV')
      .enum(['development', 'staging', 'production'])
      .default('development'),
    logging: {
      level: get('LOG_LEVEL').enum([
        'trace',
        'debug',
        'info',
        'warn',
        'error',
        'fatal',
      ]),
      pretty: get('LOG_PRETTY')
        .string()
        .transform((v) => v === 'true')
        .default(env !== 'production'),
      debug: get('DEBUG')
        .string()
        .transform((v) => v === 'true'),
    },
    server: {
      host: get('HOST').string().default('0.0.0.0'),
      port: get('PORT')
        .string()
        .transform(Number)
        .default(env === 'production' ? 80 : 3000),
      cors: {
        enabled: get('CORS_ENABLED')
          .string()
          .transform((v) => v === 'true')
          .default(true),
        origins: get('CORS_ORIGINS')
          .string()
          .transform((origins) => origins.split(',').map((o) => o.trim()))
          .refine((origins) => origins.every((o) => o.startsWith('http')), {
            message: 'All CORS origins must be valid URLs',
          })
          .default(['http://localhost:3000']),
      },
    },
  }));

  return config.parse();
}

// Example 7: Error handling
export function errorHandlingExample() {
  try {
    const config = parser
      .create((get) => ({
        required: {
          apiKey: get('API_KEY').string().min(32),
          databaseUrl: get('DATABASE_URL').string().url(),
          adminEmail: get('ADMIN_EMAIL').string().email(),
        },
        optional: {
          sentryDsn: get('SENTRY_DSN').string().url().optional(),
          slackWebhook: get('SLACK_WEBHOOK').string().url().optional(),
        },
      }))
      .parse();

    return config;
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.errors.forEach((err) => {
        const path = err.path.join('.');
      });

      // In a real app, you might want to exit
      process.exit(1);
    }
    throw error;
  }
}

// Example 8: Using with dotenv
export function dotenvExample() {
  // Load .env file
  require('dotenv').config();

  const config = parser.create((get) => ({
    app: {
      name: get('APP_NAME').string(),
      version: get('APP_VERSION')
        .string()
        .regex(/^\d+\.\d+\.\d+$/),
      description: get('APP_DESCRIPTION').string().optional(),
    },
    secrets: {
      jwtSecret: get('JWT_SECRET').string().min(64),
      encryptionKey: get('ENCRYPTION_KEY').string().length(32),
      apiKeys: get('API_KEYS')
        .string()
        .transform((keys) => keys.split(',').map((k) => k.trim()))
        .pipe(z.array(z.string().min(32))),
    },
  }));

  return config.parse();
}

// Example 9: Custom transformations
export function customTransformationsExample() {
  const config = parser.create((get) => ({
    // Parse JSON
    features: get('FEATURES_JSON')
      .string()
      .transform((str) => JSON.parse(str))
      .pipe(z.record(z.boolean())),

    // Parse duration strings
    timeouts: {
      request: get('TIMEOUT_REQUEST')
        .string()
        .transform(parseDuration)
        .default('30s'),
      idle: get('TIMEOUT_IDLE').string().transform(parseDuration).default('5m'),
    },

    // Parse memory sizes
    limits: {
      memory: get('MEMORY_LIMIT')
        .string()
        .transform(parseMemorySize)
        .default('512MB'),
      upload: get('UPLOAD_LIMIT')
        .string()
        .transform(parseMemorySize)
        .default('10MB'),
    },

    // Complex array parsing
    allowedDomains: get('ALLOWED_DOMAINS')
      .string()
      .transform((domains) =>
        domains
          .split(',')
          .map((d) => d.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().regex(/^[a-z0-9.-]+$/i))),
  }));

  return config.parse();
}

// Helper functions for custom transformations
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(ms|s|m|h)$/);
  if (!match) throw new Error(`Invalid duration: ${duration}`);

  const [, value, unit] = match;
  const multipliers = { ms: 1, s: 1000, m: 60000, h: 3600000 };
  return parseInt(value) * multipliers[unit as keyof typeof multipliers];
}

function parseMemorySize(size: string): number {
  const match = size.match(/^(\d+)(B|KB|MB|GB)$/i);
  if (!match) throw new Error(`Invalid memory size: ${size}`);

  const [, value, unit] = match;
  const multipliers = { B: 1, KB: 1024, MB: 1048576, GB: 1073741824 };
  return (
    parseInt(value) *
    multipliers[unit.toUpperCase() as keyof typeof multipliers]
  );
}

// Example 10: Type-safe configuration module
// config.ts - This is how you'd typically use it in a real app
export const loadConfig = () => {
  const parser = new EnvironmentParser(process.env as any);

  return parser
    .create((get) => ({
      app: {
        name: get('APP_NAME').string().default('My Application'),
        env: get('NODE_ENV')
          .enum(['development', 'staging', 'production'])
          .default('development'),
        port: get('PORT').string().transform(Number).default(3000),
        host: get('HOST').string().default('localhost'),
      },
      database: {
        url: get('DATABASE_URL').string().url(),
        maxConnections: get('DB_MAX_CONNECTIONS')
          .string()
          .transform(Number)
          .default(10),
        ssl: get('DB_SSL')
          .string()
          .transform((v) => v === 'true')
          .default(false),
      },
      redis: {
        url: get('REDIS_URL').string().url().optional(),
        ttl: get('REDIS_TTL').string().transform(Number).default(3600),
      },
      auth: {
        jwtSecret: get('JWT_SECRET').string().min(32),
        jwtExpiry: get('JWT_EXPIRY').string().default('7d'),
        bcryptRounds: get('BCRYPT_ROUNDS')
          .string()
          .transform(Number)
          .default(10),
      },
      features: {
        signups: get('FEATURE_SIGNUPS')
          .string()
          .transform((v) => v === 'true')
          .default(true),
        subscriptions: get('FEATURE_SUBSCRIPTIONS')
          .string()
          .transform((v) => v === 'true')
          .default(false),
      },
    }))
    .parse();
};

// Export the config for use throughout the app
export const config = loadConfig();
