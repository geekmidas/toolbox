export default {
  routes: './src/endpoints/**/*.ts',
  subscribers: './src/subscribers/**/*.ts',
  envParser: './src/config/env',
  logger: './src/config/logger',
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
};
