import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/primitives/index.ts',
    'src/layout/index.ts',
    'src/data-display/index.ts',
    'src/feedback/index.ts',
    'src/hooks/index.ts',
    'src/styles/theme.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  external: ['react', 'react-dom'],
});
