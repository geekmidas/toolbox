import { defineConfig } from 'tsdown';

export default defineConfig({
  external: ['@valibot/to-json-schema', 'zod', 'zod-to-json-schema'],
});
