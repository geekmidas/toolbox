import { EnvironmentParser } from '@geekmidas/envkit';

export const envParser = new EnvironmentParser(process.env)
  .create((get) => ({
    database: {
      url: get('DATABASE_URL').string().default('postgresql://localhost/test'),
    },
    api: {
      port: get('PORT').string().transform(Number).default('3000'),
    },
  }))
  .parse();