import { defineConfig } from 'tsdown';

export default defineConfig({
  workspace: ['packages/*'],
  clean: true,
  outDir: 'dist',
  entry: ['src/'],
  format: ['cjs', 'esm'],
  external: ['vitest'],
  dts: false,
  outExtensions: (ctx) => ({
    js: ctx.format === 'es' ? '.mjs' : '.cjs',
  }),
});
