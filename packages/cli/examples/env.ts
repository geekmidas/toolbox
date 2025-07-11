import { EnvironmentParser } from '@geekmidas/envkit';

export const envParser = new EnvironmentParser(process.env)
  .create((get) => ({
    // Database configuration
    database: {
      url: get('DATABASE_URL').string().url(),
      maxConnections: get('DB_MAX_CONNECTIONS')
        .string()
        .transform(Number)
        .default('10'),
    },

    // API configuration
    api: {
      port: get('PORT').string().transform(Number).default('3000'),
      cors: {
        origin: get('CORS_ORIGIN').string().default('*'),
      },
    },

    // AWS configuration (for Lambda deployments)
    aws: {
      region: get('AWS_REGION').string().default('us-east-1'),
    },

    // Application settings
    app: {
      environment: get('NODE_ENV').string().default('development'),
      logLevel: get('LOG_LEVEL').string().default('info'),
    },
  }))
  .parse();
