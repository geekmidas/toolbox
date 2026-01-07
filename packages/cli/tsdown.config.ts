import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/config.ts',
    'src/openapi.ts',
    'src/openapi-react-query.ts',
  ],
  dts: true,
  format: ['cjs', 'esm'],
  outExtensions: (ctx) => ({
    js: ctx.format === 'es' ? '.mjs' : '.cjs',
  }),
});
