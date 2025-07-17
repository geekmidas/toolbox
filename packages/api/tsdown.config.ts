import { defineConfig } from 'tsdown';

export default defineConfig({
  external: ['@middy/core', '@valibot/to-json-schema', 'zod'],
});
