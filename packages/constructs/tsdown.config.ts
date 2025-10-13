import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/Endpoint.ts',
    'src/Function.ts',
    'src/Cron.ts',
    'src/Subscriber.ts',
    'src/builders/index.ts',
    'src/types.ts',
  ],
});
