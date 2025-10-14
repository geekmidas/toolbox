import { defineConfig } from 'tsdown';

export default defineConfig({
  workspace: ['packages/*'],
  clean: true,
  outDir: 'dist',
  entry: ['src/', '!**/__tests__/**', '!**/*.spec.*'],
  format: ['cjs', 'esm'],
  external: ['vitest'],
  sourcemap: true,
  dts: true,
  outExtensions: (ctx) => ({
    js: ctx.format === 'es' ? '.mjs' : '.cjs',
  }),
});
