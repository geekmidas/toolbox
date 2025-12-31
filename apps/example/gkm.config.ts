import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  routes: './src/endpoints/**/*.ts',
  subscribers: './src/subscribers/**/*.ts',
  envParser: './src/config/env#envParser',
  logger: './src/config/logger',
  telescope: './src/config/telescope#telescope',
  runtime: 'node',
  env: ['.env', '.env.example'],
  openapi: true,
  providers: {
    aws: {
      apiGateway: {
        v2: true,
      },
      lambda: {
        functions: true,
        crons: true,
      },
    },
    server: true,
  },
});
